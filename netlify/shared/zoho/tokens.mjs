/**
 * Zoho OAuth token management — the server side of the migration.
 *
 * The refresh token never leaves the server. Access tokens are refreshed
 * slightly before expiry and shared: first this instance's memory, then an
 * encrypted row every invocation can read, and only then Zoho itself, with one
 * caller refreshing while the rest wait for its result.
 *
 * The access token used to be kept out of the database on purpose: it is
 * short-lived and re-obtainable, so persisting it looked like adding a secret
 * at rest to save one HTTP call per cold start. It saved far less than that.
 * `netlify dev` loads every invocation into a fresh worker, so memory never
 * survived a request and every Zoho call minted its own token; production does
 * the same on each cold start and parallel instance. Zoho allows only a
 * handful of token requests per refresh token in a window, then answers
 * "Access Denied — too many requests" and locks the app out of Books for
 * minutes. So it is stored now — encrypted with the refresh token's key, so a
 * database dump alone yields nothing, and valid for under an hour regardless.
 *
 * This replaces the browser's implicit grant, under which the frontend held a
 * ZohoBooks.fullaccess.all access token in localStorage — readable by any
 * script on the page, with no way to revoke a single session.
 */

import { createHash } from 'node:crypto';
import { queryOne, query } from '../db.mjs';
import { decryptSecret, encryptSecret } from '../crypto.mjs';
import {
	DatabaseUnavailableError,
	ZohoAuthenticationError,
	ZohoNotConfiguredError,
	ZohoRateLimitedError,
} from '../errors.mjs';

/**
 * This app creates purchase orders, so unlike a read-only integration it needs
 * write scope. Stated in one place so what we ask for can be narrowed later
 * without hunting through call sites.
 */
export const REQUIRED_SCOPES = ['ZohoBooks.fullaccess.all'];
export const scopeString = () => REQUIRED_SCOPES.join(',');

/** Data centre → API domain. Never hardcode the US domain. */
const API_DOMAIN_BY_HOST = {
	'accounts.zoho.in': 'https://www.zohoapis.in',
	'accounts.zoho.com': 'https://www.zohoapis.com',
	'accounts.zoho.eu': 'https://www.zohoapis.eu',
	'accounts.zoho.com.au': 'https://www.zohoapis.com.au',
	'accounts.zoho.jp': 'https://www.zohoapis.jp',
	'accounts.zohocloud.ca': 'https://www.zohoapis.ca',
	'accounts.zoho.sa': 'https://www.zohoapis.sa',
};

const trim = (value) => String(value ?? '').replace(/\/+$/, '');

export function inferApiDomain(domain) {
	try {
		return (
			API_DOMAIN_BY_HOST[new URL(domain).hostname.toLowerCase()] ??
			'https://www.zohoapis.in'
		);
	} catch {
		return 'https://www.zohoapis.in';
	}
}

export const defaultAccountsDomain = () =>
	trim(process.env.ZOHO_ACCOUNTS_DOMAIN) || 'https://accounts.zoho.in';

/* --------------------------------------------------------- stored connection */

/** Reads and decrypts the stored connection. Server-only. */
async function loadStoredConnection() {
	const row = await queryOne(
		`SELECT refresh_token_encrypted, organization_id, accounts_domain, api_domain
		   FROM zoho_connection WHERE id = 1`,
	);
	if (row === null) return null;

	let refreshToken = null;
	if (row.refresh_token_encrypted) {
		try {
			refreshToken = decryptSecret(row.refresh_token_encrypted);
		} catch {
			// A rotated key makes the stored token unreadable. Say so plainly
			// rather than failing later inside an opaque Zoho error.
			throw new ZohoNotConfiguredError(
				'The stored Zoho token could not be decrypted. Reconnect Zoho.',
			);
		}
	}

	return {
		refreshToken,
		organizationId: row.organization_id,
		accountsDomain: row.accounts_domain,
		apiDomain: row.api_domain,
	};
}

/**
 * Everything needed to talk to Zoho, or null when not configured.
 *
 * ZOHO_REFRESH_TOKEN always wins when present: an environment variable is the
 * easier thing to rotate in an incident. Otherwise the connection captured by
 * the in-app OAuth flow is used, including the organization and domains Zoho
 * itself reported — so an in-app connection does not also require someone to
 * set matching environment variables.
 */
export async function resolveCredentials() {
	const clientId = process.env.ZOHO_CLIENT_ID;
	const clientSecret = process.env.ZOHO_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;

	const envRefreshToken = process.env.ZOHO_REFRESH_TOKEN;
	const stored = envRefreshToken ? null : await loadStoredConnection();

	const refreshToken = envRefreshToken || stored?.refreshToken;
	if (!refreshToken) return null;

	const organizationId =
		process.env.ZOHO_ORGANIZATION_ID || stored?.organizationId || null;
	if (!organizationId) return null;

	const accountsDomain =
		trim(process.env.ZOHO_ACCOUNTS_DOMAIN) ||
		trim(stored?.accountsDomain) ||
		'https://accounts.zoho.in';

	return {
		clientId,
		clientSecret,
		refreshToken,
		accountsDomain,
		apiDomain:
			trim(process.env.ZOHO_API_DOMAIN) ||
			trim(stored?.apiDomain) ||
			inferApiDomain(accountsDomain),
		organizationId,
	};
}

export async function requireResolvedCredentials() {
	const credentials = await resolveCredentials();
	if (credentials === null) throw new ZohoNotConfiguredError();
	return credentials;
}

export const isZohoUsable = async () => (await resolveCredentials()) !== null;

/* ------------------------------------------------------- refresh token IO */

export async function storeRefreshToken({
	refreshToken,
	organizationId,
	accountsDomain,
	apiDomain,
	connectedBy,
}) {
	await query(
		`INSERT INTO zoho_connection
		   (id, refresh_token_encrypted, refresh_token_updated_at,
		    organization_id, accounts_domain, api_domain, connected_by, connected_at)
		 VALUES (1, $1, NOW(), $2, $3, $4, $5, NOW())
		 ON CONFLICT (id) DO UPDATE
		   SET refresh_token_encrypted  = EXCLUDED.refresh_token_encrypted,
		       refresh_token_updated_at = NOW(),
		       organization_id = COALESCE(EXCLUDED.organization_id, zoho_connection.organization_id),
		       accounts_domain = EXCLUDED.accounts_domain,
		       api_domain      = EXCLUDED.api_domain,
		       connected_by    = EXCLUDED.connected_by,
		       connected_at    = NOW()`,
		[
			encryptSecret(refreshToken),
			organizationId ?? null,
			accountsDomain ?? null,
			apiDomain ?? null,
			connectedBy ?? null,
		],
	);
	await invalidateAccessToken();
}

export async function clearRefreshToken() {
	await query(
		`UPDATE zoho_connection
		    SET refresh_token_encrypted = NULL, refresh_token_updated_at = NULL
		  WHERE id = 1`,
	);
	await invalidateAccessToken();
}

/* ------------------------------------------------------------ token cache */

/**
 * Three layers, cheapest first: this instance's memory, the shared row in
 * zoho_token_cache, and only then Zoho — behind a lease, so that when the token
 * does expire one caller refreshes it and every other caller waits for that
 * result instead of asking Zoho itself.
 *
 * The shared row is what matters. `netlify dev` runs each invocation in a
 * fresh worker, and production runs many instances, so memory alone meant a
 * token request per Zoho call — and Zoho locks a refresh token out for minutes
 * once it sees too many.
 */

let cachedToken = null; // { accessToken, expiresAt, apiDomain, fingerprint }

/** In-flight refresh shared by concurrent callers in this instance. */
let refreshInFlight = null;

/** Refresh this far ahead of the real expiry. */
const EXPIRY_SAFETY_MARGIN_MS = 120_000;

/** How long a refresher holds the lease before others may take over. */
const LEASE_SECONDS = 15;

/** How long a caller waits for someone else's refresh before giving up. */
const LEASE_WAIT_MS = 8_000;
const LEASE_POLL_MS = 250;

/**
 * How long to stop asking once Zoho throttles. Zoho does not say how long its
 * block lasts, and every request during one only extends it.
 */
const THROTTLE_BACKOFF_SECONDS = 300;

const sha256 = (value) =>
	createHash('sha256').update(String(value)).digest('base64url');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pick = (token) => ({
	accessToken: token.accessToken,
	apiDomain: token.apiDomain,
});

// Ties a token to the credential that minted it, so replacing the refresh
// token or the client never serves a token issued to the old one.
const fingerprintOf = (credentials) =>
	sha256(`${credentials.clientId}:${credentials.refreshToken}`);

/**
 * No database here, or the migration that creates the table has not run. The
 * app must still reach Zoho in that case — it just loses the protection.
 */
function cacheUnavailable(error) {
	return (
		error instanceof DatabaseUnavailableError ||
		String(error?.code) === '42P01' // undefined_table
	);
}

function readShared() {
	return queryOne(
		`SELECT credential_fingerprint, access_token_encrypted, api_domain,
		        expires_at, throttled_until
		   FROM zoho_token_cache WHERE id = 1`,
	);
}

function tokenFromRow(row, fingerprint) {
	if (!row?.access_token_encrypted || !row.expires_at) return null;
	if (row.credential_fingerprint !== fingerprint) return null;

	const expiresAt = new Date(row.expires_at).getTime();
	if (!(expiresAt > Date.now())) return null;

	try {
		return {
			accessToken: decryptSecret(row.access_token_encrypted),
			expiresAt,
			apiDomain: row.api_domain,
		};
	} catch {
		// Written under a key that has since rotated. Treat it as absent; the
		// next refresh overwrites it.
		return null;
	}
}

/**
 * Take the refresh lease if nobody holds a live one. A single statement, so
 * two callers cannot both win it.
 */
async function acquireLease() {
	const row = await queryOne(
		`INSERT INTO zoho_token_cache (id, refresh_lease_until)
		 VALUES (1, NOW() + make_interval(secs => $1::double precision))
		 ON CONFLICT (id) DO UPDATE
		   SET refresh_lease_until = EXCLUDED.refresh_lease_until
		 WHERE zoho_token_cache.refresh_lease_until IS NULL
		    OR zoho_token_cache.refresh_lease_until < NOW()
		 RETURNING id`,
		[LEASE_SECONDS],
	);
	return row !== null;
}

async function releaseLease({ throttled = false } = {}) {
	await query(
		`UPDATE zoho_token_cache
		    SET refresh_lease_until = NULL,
		        throttled_until = CASE
		          WHEN $1::boolean
		          THEN NOW() + make_interval(secs => $2::double precision)
		          ELSE throttled_until END,
		        updated_at = NOW()
		  WHERE id = 1`,
		[throttled, THROTTLE_BACKOFF_SECONDS],
	);
}

async function storeShared(fingerprint, token) {
	await query(
		`UPDATE zoho_token_cache
		    SET credential_fingerprint = $1,
		        access_token_encrypted = $2,
		        access_token_hash = $3,
		        api_domain = $4,
		        expires_at = to_timestamp($5::double precision / 1000),
		        refresh_lease_until = NULL,
		        throttled_until = NULL,
		        updated_at = NOW()
		  WHERE id = 1`,
		[
			fingerprint,
			encryptSecret(token.accessToken),
			sha256(token.accessToken),
			token.apiDomain,
			token.expiresAt,
		],
	);
}

/**
 * Forget the current token.
 *
 * Given the token that Zoho just refused, the shared row is cleared only if it
 * still holds that token — another request may already have replaced it with a
 * good one, and throwing that away would cost a refresh for nothing.
 */
export async function invalidateAccessToken(rejectedToken) {
	cachedToken = null;
	try {
		if (rejectedToken) {
			await query(
				`UPDATE zoho_token_cache SET expires_at = NULL, updated_at = NOW()
				  WHERE id = 1 AND access_token_hash = $1`,
				[sha256(rejectedToken)],
			);
		} else {
			await query(
				`UPDATE zoho_token_cache
				    SET access_token_encrypted = NULL, access_token_hash = NULL,
				        expires_at = NULL, updated_at = NOW()
				  WHERE id = 1`,
			);
		}
	} catch (error) {
		if (!cacheUnavailable(error)) throw error;
	}
}

async function refreshAccessToken(credentials) {
	const response = await fetch(`${credentials.accountsDomain}/oauth/v2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token: credentials.refreshToken,
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			grant_type: 'refresh_token',
		}),
	});

	const body = await response.json().catch(() => ({}));

	// Zoho reports OAuth failures with HTTP 200 and an `error` field, so the
	// status alone cannot tell success from failure. The error body is never
	// echoed into the thrown message: it can quote the credentials back.
	if (body.error !== undefined || typeof body.access_token !== 'string') {
		// Throttling arrives as a bare "Access Denied", the same word as a real
		// refusal, and only the description tells them apart. Reported as
		// rejected credentials it sends people off to regenerate tokens that
		// were fine all along.
		const throttled =
			body.error === 'Access Denied' &&
			/too many requests/i.test(String(body.error_description ?? ''));

		console.error('[zoho] token refresh failed', {
			reason: body.error ?? 'no_token',
			status: response.status,
			throttled,
		});

		if (throttled) throw new ZohoRateLimitedError(THROTTLE_BACKOFF_SECONDS);
		throw new ZohoAuthenticationError();
	}

	const lifetimeSeconds =
		typeof body.expires_in === 'number' ? body.expires_in : 3600;

	return {
		accessToken: body.access_token,
		expiresAt: Date.now() + lifetimeSeconds * 1000 - EXPIRY_SAFETY_MARGIN_MS,
		// Prefer the domain Zoho reports over anything we inferred.
		apiDomain: trim(body.api_domain) || credentials.apiDomain,
	};
}

/** A usable token from the shared row, or a fresh one — exactly one refresher. */
async function obtainShared(credentials, fingerprint) {
	const deadline = Date.now() + LEASE_WAIT_MS;

	for (;;) {
		const row = await readShared();

		const shared = tokenFromRow(row, fingerprint);
		if (shared) return shared;

		if (row?.throttled_until) {
			const waitMs = new Date(row.throttled_until).getTime() - Date.now();
			if (waitMs > 0) throw new ZohoRateLimitedError(Math.ceil(waitMs / 1000));
		}

		if (await acquireLease()) {
			// Someone may have stored a token and released the lease between
			// the read above and winning it. Look once more before asking Zoho.
			const late = tokenFromRow(await readShared(), fingerprint);
			if (late) {
				await releaseLease().catch(() => {});
				return late;
			}

			let token;
			try {
				token = await refreshAccessToken(credentials);
			} catch (error) {
				await releaseLease({
					throttled: error instanceof ZohoRateLimitedError,
				}).catch(() => {});
				throw error;
			}

			// A token in hand is worth returning even if it cannot be shared —
			// failing here would throw away a refresh that already counted
			// against Zoho's limit.
			try {
				await storeShared(fingerprint, token);
			} catch (error) {
				console.warn('[zoho] could not share the new access token', {
					message: error?.message,
				});
				await releaseLease().catch(() => {});
			}
			return token;
		}

		if (Date.now() > deadline) {
			throw new ZohoAuthenticationError(
				'Another request is refreshing the Zoho token and has not finished. Try again in a moment.',
			);
		}
		await sleep(LEASE_POLL_MS);
	}
}

/**
 * A valid access token and the API domain to use it against.
 *
 * `forceRefresh` skips this instance's memory only. After a 401 the proxy has
 * already cleared the refused token from the shared row, so the next read
 * either finds a newer token another request stored or refreshes.
 *
 * `credentials` lets a caller that has already resolved them pass them in:
 * resolving reads the zoho_connection row, and the proxy does that once per
 * request already.
 */
export async function getAccessToken({ forceRefresh = false, credentials: resolved } = {}) {
	const credentials = resolved ?? (await requireResolvedCredentials());
	const fingerprint = fingerprintOf(credentials);

	if (
		!forceRefresh &&
		cachedToken !== null &&
		cachedToken.fingerprint === fingerprint &&
		cachedToken.expiresAt > Date.now()
	) {
		return pick(cachedToken);
	}

	if (refreshInFlight === null) {
		refreshInFlight = (async () => {
			let token;
			try {
				token = await obtainShared(credentials, fingerprint);
			} catch (error) {
				if (!cacheUnavailable(error)) throw error;
				console.warn('[zoho] shared token cache unavailable; refreshing directly', {
					message: error?.message,
				});
				token = await refreshAccessToken(credentials);
			}
			cachedToken = { ...token, fingerprint };
			return cachedToken;
		})().finally(() => {
			refreshInFlight = null;
		});
	}

	return pick(await refreshInFlight);
}

/** Whether a usable token exists anywhere in the app, for the status check. */
async function tokenIsCached(credentials) {
	if (credentials === null) return false;
	const fingerprint = fingerprintOf(credentials);
	if (cachedToken?.fingerprint === fingerprint && cachedToken.expiresAt > Date.now()) {
		return true;
	}
	try {
		const row = await readShared();
		return Boolean(
			row?.access_token_encrypted &&
				row.credential_fingerprint === fingerprint &&
				row.expires_at &&
				new Date(row.expires_at).getTime() > Date.now(),
		);
	} catch {
		return false;
	}
}

/* ------------------------------------------------------------ OAuth flow */

export function buildAuthorizationUrl({ redirectUri, state }) {
	const clientId = process.env.ZOHO_CLIENT_ID;
	if (!clientId) throw new ZohoNotConfiguredError('ZOHO_CLIENT_ID is not set.');

	const params = new URLSearchParams({
		scope: scopeString(),
		client_id: clientId,
		response_type: 'code',
		redirect_uri: redirectUri,
		// Both are required for Zoho to return a refresh token at all.
		access_type: 'offline',
		prompt: 'consent',
		state,
	});
	return `${defaultAccountsDomain()}/oauth/v2/auth?${params.toString()}`;
}

export async function exchangeAuthorizationCode({ code, redirectUri }) {
	const clientId = process.env.ZOHO_CLIENT_ID;
	const clientSecret = process.env.ZOHO_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new ZohoNotConfiguredError(
			'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET are not set on the server.',
		);
	}

	const accountsDomain = defaultAccountsDomain();
	const response = await fetch(`${accountsDomain}/oauth/v2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
		}),
	});

	const body = await response.json().catch(() => ({}));
	if (body.error !== undefined || typeof body.refresh_token !== 'string') {
		console.error('[zoho] authorization code exchange failed', {
			reason: body.error ?? 'no_refresh_token',
			status: response.status,
		});
		throw new ZohoAuthenticationError(
			body.error === 'invalid_code'
				? 'That authorization code was already used or has expired. Try connecting again.'
				: 'Zoho did not return a refresh token. The client must be a Server-based Application, and the redirect URI must match exactly.',
		);
	}

	return {
		refreshToken: body.refresh_token,
		accountsDomain,
		apiDomain: trim(body.api_domain) || inferApiDomain(accountsDomain),
	};
}

/** Connection health, with nothing secret in it. */
export async function connectionStatus() {
	const clientConfigured = Boolean(
		process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET,
	);
	const fromEnv = Boolean(process.env.ZOHO_REFRESH_TOKEN);
	const stored = fromEnv ? null : await loadStoredConnection().catch(() => null);
	const credentials = await resolveCredentials().catch(() => null);

	return {
		clientConfigured,
		connected: credentials !== null,
		source: fromEnv ? 'environment' : stored?.refreshToken ? 'in-app' : null,
		connectedAt: stored?.refreshToken ? (stored.connectedAt ?? null) : null,
		organizationId: credentials?.organizationId ?? null,
		apiDomain: credentials?.apiDomain ?? null,
		// True once a usable token exists anywhere in the app — a cheap way to
		// tell "configured" from "actually working".
		tokenCached: await tokenIsCached(credentials),
	};
}
