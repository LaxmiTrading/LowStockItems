/**
 * HTTP plumbing shared by every function: JSON responses, a small router, and
 * one error boundary.
 *
 * These are Netlify Functions v2 (ESM, `export default`, Request/Response) —
 * the same format the lost-sale endpoints already use.
 */

import { AppError } from './errors.mjs';

/* ------------------------------------------------------------------ CORS */

// Unlike the lost-sale endpoints, these carry a session cookie, so the
// origin cannot be `*`: a wildcard is rejected by browsers whenever
// credentials are involved. Same-origin is the only caller in production.
function corsHeaders(request) {
	const origin = request?.headers?.get('origin') ?? '';
	const allowed = isAllowedOrigin(origin) ? origin : appBaseUrl();
	return {
		'Access-Control-Allow-Origin': allowed,
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
		Vary: 'Origin',
	};
}

export function appBaseUrl() {
	return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(
		/\/+$/,
		'',
	);
}

function isAppOrigin(origin) {
	try {
		return new URL(origin).origin === new URL(appBaseUrl()).origin;
	} catch {
		return false;
	}
}

// Exact origins, never a prefix. This was `origin.startsWith('http://localhost')`,
// which is a different and much wider test than it reads as: a domain called
// localhost.example.com starts with those characters. Production was
// reflecting exactly that back with Access-Control-Allow-Credentials: true, so
// anyone who registered such a name held a credentialed cross-origin grant
// against this API. SameSite=Lax kept it from being usable — the browser will
// not attach the session cookie to a cross-site fetch — but that is one cookie
// attribute standing between a typo and account takeover.
const DEVELOPMENT_ORIGINS = new Set([
	'http://localhost:3000',
	'http://localhost:8888',
	'http://127.0.0.1:3000',
	'http://127.0.0.1:8888',
]);

function isAllowedOrigin(origin) {
	if (!origin) return false;
	if (isAppOrigin(origin)) return true;
	// A deployment served over https is production; it has no business
	// answering to a developer's machine.
	if (appBaseUrl().startsWith('https://')) return false;
	return DEVELOPMENT_ORIGINS.has(origin);
}

export function preflight(request) {
	return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/* -------------------------------------------------------------- responses */

export function jsonSuccess(data, request, { status = 200, headers = {} } = {}) {
	return Response.json(
		{ ok: true, data },
		{
			status,
			headers: {
				...corsHeaders(request),
				// Every one of these responses is either account-specific or a
				// mutation's result. Neither belongs in a proxy or in the
				// browser's back-forward cache.
				'Cache-Control': 'no-store',
				...headers,
			},
		},
	);
}

export function jsonError(error, request) {
	const isApp = error instanceof AppError;

	if (!isApp) {
		// Log the detail, return none of it.
		console.error('[api] unhandled error', {
			message: error?.message,
			stack: error?.stack,
		});
	}

	return Response.json(
		{
			ok: false,
			error: {
				code: isApp ? error.code : 'INTERNAL',
				message: isApp
					? error.message
					: 'Something went wrong. Please try again.',
				...(isApp && error.details ? { details: error.details } : {}),
			},
		},
		{ status: isApp ? error.status : 500, headers: corsHeaders(request) },
	);
}

/* ----------------------------------------------------------------- bodies */

export async function readJson(request) {
	try {
		const body = await request.json();
		if (body === null || typeof body !== 'object' || Array.isArray(body)) {
			throw new Error('not an object');
		}
		return body;
	} catch {
		throw new AppError('BAD_JSON', 'Expected a JSON object in the body.', 400);
	}
}

/** Trims and rejects blanks; `field` names the offender for the client. */
export function requireString(body, field, { max = 400 } = {}) {
	const value = body?.[field];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new AppError('VALIDATION', `${field} is required.`, 400, { field });
	}
	if (value.length > max) {
		throw new AppError('VALIDATION', `${field} is too long.`, 400, { field });
	}
	return value.trim();
}

/* ----------------------------------------------------------------- router */

/**
 * Matches `routes` against the request. Patterns are literal paths — no
 * parameters are needed by any endpoint here, and a literal comparison cannot
 * be tricked by a crafted path the way a loose regex can.
 */
export function matchRoute(routes, request) {
	const { pathname } = new URL(request.url);
	return (
		routes.find(
			(route) => route.method === request.method && route.pattern === pathname,
		) ?? null
	);
}

/** Wraps a handler so every throw becomes a well-formed JSON error. */
export function withErrorHandling(handler) {
	return async (request, context) => {
		if (request.method === 'OPTIONS') return preflight(request);
		try {
			return await handler(request, context);
		} catch (error) {
			return jsonError(error, request);
		}
	};
}
