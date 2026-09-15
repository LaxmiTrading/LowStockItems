/**
 * Firebase Cloud Messaging, over the HTTP v1 API.
 *
 * Deliberately not firebase-admin. That package would be bundled into every
 * function in this directory for what amounts to one signed JWT and one fetch,
 * and this repo already signs its own tokens in ../auth/jwt.mjs — so the house
 * style is to do it here too, with no new dependency.
 *
 * Silent when unconfigured: push is an addition to the email reminder, not the
 * thing itself, so a site with no Firebase credentials must still send its
 * reminders rather than fail the run.
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export function pushConfigured() {
	return Boolean(
		process.env.FIREBASE_PROJECT_ID &&
			process.env.FIREBASE_CLIENT_EMAIL &&
			process.env.FIREBASE_PRIVATE_KEY,
	);
}

/**
 * Netlify's UI stores a multi-line value with the newlines escaped, so the key
 * arrives as the literal characters \n and openssl rejects it. Both spellings
 * are accepted because which one you get depends on how the variable was set.
 */
function privateKey() {
	return String(process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

const base64url = (input) =>
	Buffer.from(input)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

// Cached across warm invocations: a token lasts an hour and minting one costs
// a round trip on every send otherwise.
let cachedToken = null;

async function accessToken() {
	if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
		return cachedToken.value;
	}

	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = base64url(
		JSON.stringify({
			iss: process.env.FIREBASE_CLIENT_EMAIL,
			scope: SCOPE,
			aud: TOKEN_URL,
			iat: now,
			exp: now + 3600,
		}),
	);

	const signer = createSign('RSA-SHA256');
	signer.update(`${header}.${claims}`);
	const signature = signer
		.sign(privateKey(), 'base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${header}.${claims}.${signature}`,
		}),
	});

	if (!res.ok) {
		throw new Error(
			`Could not get a Firebase access token (${res.status}). Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.`,
		);
	}

	const body = await res.json();
	cachedToken = {
		value: body.access_token,
		expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
	};
	return cachedToken.value;
}

/**
 * Send one notification to many device tokens.
 *
 * FCM v1 takes one message per request, so this walks the list. Returns the
 * tokens Firebase reported as dead, for the caller to delete — a stale token
 * is not an error, it is a device that has since cleared its site data.
 */
export async function sendPush({ tokens, title, body, url }) {
	if (!pushConfigured() || tokens.length === 0) {
		return { sent: 0, dead: [] };
	}

	const bearer = await accessToken();
	const endpoint = `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`;

	let sent = 0;
	const dead = [];

	for (const token of tokens) {
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${bearer}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					message: {
						token,
						notification: { title, body },
						// The service worker reads this to decide where a click goes.
						data: url ? { url } : undefined,
						webpush: {
							fcmOptions: url ? { link: url } : undefined,
							notification: { icon: '/logo192.png', badge: '/logo192.png' },
						},
					},
				}),
			});

			if (res.ok) {
				sent++;
				continue;
			}

			const problem = await res.json().catch(() => ({}));
			const status = problem?.error?.status;
			// The device is gone, or the token was never valid. Either way it
			// will never deliver again, so the caller should stop keeping it.
			if (
				status === 'UNREGISTERED' ||
				status === 'NOT_FOUND' ||
				status === 'INVALID_ARGUMENT'
			) {
				dead.push(token);
			} else {
				console.error('[fcm] send failed', { status, code: res.status });
			}
		} catch (error) {
			// One unreachable device must not stop the rest of the run.
			console.error('[fcm] send threw', { message: error?.message });
		}
	}

	return { sent, dead };
}
