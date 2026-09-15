/**
 * Zoho credentials for local development.
 *
 *   npm run zoho:token                      print a fresh access token
 *   npm run -s zoho:token -- --raw          just the token, for $(...) in a shell
 *   npm run zoho:token -- --code 1000.abc   trade a Self Client grant code for a
 *                                           refresh token and save it to .env
 *
 * The app itself never needs this: under `netlify dev` the Zoho proxy mints
 * access tokens from ZOHO_REFRESH_TOKEN on its own, caches them, and refreshes
 * before they expire. This is for the other cases — getting the refresh token
 * in the first place, and poking Books by hand with curl.
 *
 * Nothing here stores an access token. They last an hour, so keeping one in
 * .env only guarantees a confusing failure an hour later.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ENV_FILE = '.env';

// A minimal .env reader — enough for KEY=value and quoted values. Loaded
// before the token module is imported, because that module reads process.env.
function loadEnv() {
	let text = '';
	try {
		text = readFileSync(ENV_FILE, 'utf8');
	} catch {
		return;
	}
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
		if (!m || process.env[m[1]] !== undefined) continue;
		let value = m[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[m[1]] = value;
	}
}

// Writes KEY=value into .env, replacing an existing line rather than adding a
// second one, and keeping whatever line endings the file already uses.
function saveEnv(key, value) {
	let text = '';
	try {
		text = readFileSync(ENV_FILE, 'utf8');
	} catch {
		/* a new file */
	}
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const line = `${key}=${value}`;
	const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
	text = pattern.test(text)
		? text.replace(pattern, line)
		: `${text.replace(/\s*$/, '')}${eol}${line}${eol}`;
	writeFileSync(ENV_FILE, text);
}

const mask = (s) => (s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : '…');

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const codeIndex = args.indexOf('--code');
const code = codeIndex >= 0 ? args[codeIndex + 1] : null;

loadEnv();

const accountsDomain = (
	process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.in'
).replace(/\/+$/, '');

function requireVars(names) {
	const missing = names.filter((n) => !process.env[n]);
	if (missing.length > 0) {
		console.error(`Missing from ${ENV_FILE}: ${missing.join(', ')}`);
		console.error('See the "Zoho Books" section of .env.example.');
		process.exit(1);
	}
}

/* --------------------------------------------- grant code → refresh token */

if (codeIndex >= 0) {
	if (!code) {
		console.error('Usage: npm run zoho:token -- --code <grant code>');
		process.exit(1);
	}
	requireVars(['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET']);

	const response = await fetch(`${accountsDomain}/oauth/v2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: process.env.ZOHO_CLIENT_ID,
			client_secret: process.env.ZOHO_CLIENT_SECRET,
			code,
		}),
	});
	const body = await response.json().catch(() => ({}));

	// Zoho answers OAuth failures with HTTP 200 and an `error` field.
	if (body.error || typeof body.refresh_token !== 'string') {
		console.error(`Zoho refused the code: ${body.error ?? `HTTP ${response.status}`}`);
		if (body.error === 'invalid_code') {
			console.error(
				'Grant codes are single-use and expire within minutes — generate a fresh one.',
			);
		}
		if (body.access_token && !body.refresh_token) {
			console.error(
				'Zoho issued an access token but no refresh token. The code was not generated for offline access — use a Self Client code.',
			);
		}
		process.exit(1);
	}

	saveEnv('ZOHO_REFRESH_TOKEN', body.refresh_token);
	if (body.api_domain && !process.env.ZOHO_API_DOMAIN) {
		saveEnv('ZOHO_API_DOMAIN', body.api_domain);
	}

	console.log(`Saved ZOHO_REFRESH_TOKEN (${mask(body.refresh_token)}) to ${ENV_FILE}.`);
	console.log('It does not expire on its own; revoke it in the Zoho API console if it leaks.');
	process.exit(0);
}

/* --------------------------------------------- refresh token → access token */

requireVars([
	'ZOHO_CLIENT_ID',
	'ZOHO_CLIENT_SECRET',
	'ZOHO_REFRESH_TOKEN',
	'ZOHO_ORGANIZATION_ID',
]);

// The same code path the proxy uses, so a token that works here is proof the
// app's credentials work too.
const { getAccessToken } = await import('../netlify/shared/zoho/tokens.mjs');

try {
	const { accessToken, apiDomain } = await getAccessToken();

	if (raw) {
		process.stdout.write(accessToken);
		process.exit(0);
	}

	console.log(`access token : ${accessToken}`);
	console.log(`api domain   : ${apiDomain}`);
	console.log('valid for    : about an hour');
	console.log('');
	console.log('Try it:');
	console.log(
		`  curl -H "Authorization: Zoho-oauthtoken ${mask(accessToken)}" \\`,
	);
	console.log(
		`    "${apiDomain}/books/v3/purchaseorders?organization_id=${process.env.ZOHO_ORGANIZATION_ID}&filter_by=Status.Open&per_page=5"`,
	);
} catch (error) {
	console.error(`Could not get an access token: ${error.message}`);
	console.error(
		'Usually a revoked refresh token, or a client id/secret that does not match the one the token was issued to.',
	);
	process.exit(1);
}
