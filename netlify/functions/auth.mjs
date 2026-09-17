/**
 * Authentication endpoints.
 *
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   POST /api/auth/bootstrap        first administrator, once, token-gated
 *   POST /api/auth/accept-invite
 *   POST /api/auth/change-password
 *   GET  /api/me
 *   GET  /api/auth/users            administrator
 *   POST /api/auth/invite           administrator
 *   POST /api/auth/set-user-status  administrator
 *
 * There is no self-registration: accounts exist because an administrator
 * created them.
 */

import { queryMany, queryOne, query } from '../shared/db.mjs';
import {
	buildClearSessionCookie,
	createSessionCookie,
	requireAdministrator,
	requireUser,
} from '../shared/auth/session.mjs';
import {
	INVITE_LIFETIME_SECONDS,
	hashPassword,
	hashToken,
	issueToken,
	passwordValidationMessage,
	verifyPassword,
} from '../shared/auth/password.mjs';
import {
	AccountDisabledError,
	AppError,
	ForbiddenError,
	InvalidCredentialsError,
	ValidationError,
} from '../shared/errors.mjs';
import {
	appBaseUrl,
	jsonSuccess,
	matchRoute,
	readJson,
	requireString,
	withErrorHandling,
} from '../shared/http.mjs';
import {
	OUTCOMES,
	enforceLoginLimit,
	pruneOldAttempts,
	recentAttempts,
	recordAttempt,
	requestOrigin,
} from '../shared/auth/attempts.mjs';

const publicProfile = (p) => ({
	id: p.id,
	email: p.email,
	displayName: p.display_name,
	role: p.role,
	status: p.status,
	lastLoginAt: p.last_login_at ?? null,
});

const findByEmail = (email) =>
	queryOne('SELECT * FROM profiles WHERE lower(email) = lower($1)', [email]);

/* ----------------------------------------------------------------- login */

async function login(request, context) {
	const body = await readJson(request);
	const email = requireString(body, 'email');
	const password = typeof body.password === 'string' ? body.password : '';
	const origin = requestOrigin(request, context);

	// Before the password is checked, so a blocked caller never reaches the
	// deliberately expensive hash comparison.
	await enforceLoginLimit({ email, origin });

	const profile = await findByEmail(email);

	// The comparison runs even with no profile, so response timing does not
	// disclose whether the email is registered.
	const matches = await verifyPassword(password, {
		hash: profile?.password_hash ?? null,
		salt: profile?.password_salt ?? null,
	});

	// Every refusal is recorded before it is thrown. The client is told the
	// same thing whichever branch it was — the distinction lives in the log,
	// where only an administrator can read it.
	//
	// `refuse` returns the error for the caller to throw rather than throwing
	// it itself: at a call site that reads `throw await refuse(...)` it is
	// plain that control leaves here, which matters below where the checks
	// after the null test would otherwise look like they could dereference it.
	const refuse = async (outcome, error) => {
		await recordAttempt({ email, outcome, origin });
		return error;
	};

	if (profile === null) {
		throw await refuse(OUTCOMES.noAccount, new InvalidCredentialsError());
	}
	if (!matches) {
		throw await refuse(OUTCOMES.badPassword, new InvalidCredentialsError());
	}
	if (profile.status === 'disabled') {
		throw await refuse(OUTCOMES.disabled, new AccountDisabledError());
	}
	if (profile.status === 'invited') {
		throw await refuse(OUTCOMES.notActivated, new InvalidCredentialsError());
	}

	const session = createSessionCookie(profile);
	await query('UPDATE profiles SET last_login_at = NOW() WHERE id = $1', [
		profile.id,
	]);
	await recordAttempt({ email, outcome: OUTCOMES.success, origin });
	await pruneOldAttempts();

	return jsonSuccess({ user: publicProfile(profile) }, request, {
		headers: { 'set-cookie': session.cookie },
	});
}

const logout = async (request) =>
	jsonSuccess({ signedOut: true }, request, {
		headers: { 'set-cookie': buildClearSessionCookie() },
	});

const me = async (request) => {
	const actor = await requireUser(request);
	return jsonSuccess({ user: actor }, request);
};

/* --------------------------------------------------------------- invites */

async function invite(request) {
	const actor = await requireAdministrator(request);
	const body = await readJson(request);
	const email = requireString(body, 'email');
	const displayName = requireString(body, 'displayName');
	const role = body.role === 'administrator' ? 'administrator' : 'buyer';

	if (await findByEmail(email)) {
		throw new ValidationError('That email already has an account.', {
			field: 'email',
		});
	}

	const token = issueToken(INVITE_LIFETIME_SECONDS);
	const profile = await queryOne(
		`INSERT INTO profiles (email, display_name, role, status, invite_token_hash, invite_expires_at)
		 VALUES ($1, $2, $3, 'invited', $4, $5)
		 RETURNING *`,
		[email, displayName, role, token.tokenHash, token.expiresAt],
	);

	// There is no mail transport in this project, so the link is returned to
	// the administrator to pass on. Only its hash is stored, so this response
	// is the single moment the raw token exists.
	return jsonSuccess(
		{
			user: publicProfile(profile),
			inviteLink: `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(token.token)}`,
			expiresAt: token.expiresAt,
			invitedBy: actor.email,
		},
		request,
		{ status: 201 },
	);
}

async function acceptInvite(request) {
	const body = await readJson(request);
	const token = requireString(body, 'token', { max: 200 });
	const password = typeof body.password === 'string' ? body.password : '';

	const issue = passwordValidationMessage(password);
	if (issue) throw new ValidationError(issue, { field: 'password' });

	const profile = await queryOne(
		'SELECT * FROM profiles WHERE invite_token_hash = $1',
		[hashToken(token)],
	);
	if (profile === null) {
		throw new AppError('INVITE_INVALID', 'This invitation link is not valid.', 400);
	}
	if (profile.invite_expires_at && new Date(profile.invite_expires_at) <= new Date()) {
		throw new AppError(
			'INVITE_EXPIRED',
			'This invitation has expired. Ask an administrator for a new one.',
			400,
		);
	}

	const { hash, salt } = await hashPassword(password);
	const activated = await queryOne(
		`UPDATE profiles
		    SET password_hash = $2, password_salt = $3, status = 'active',
		        invite_token_hash = NULL, invite_expires_at = NULL, updated_at = NOW()
		  WHERE id = $1
		  RETURNING *`,
		[profile.id, hash, salt],
	);

	const session = createSessionCookie(activated);
	return jsonSuccess({ user: publicProfile(activated) }, request, {
		headers: { 'set-cookie': session.cookie },
	});
}

/* ------------------------------------------------------- change password */

async function changePassword(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
	const next = typeof body.newPassword === 'string' ? body.newPassword : '';

	const issue = passwordValidationMessage(next);
	if (issue) throw new ValidationError(issue, { field: 'newPassword' });

	const profile = await queryOne('SELECT * FROM profiles WHERE id = $1', [actor.id]);
	const matches = await verifyPassword(current, {
		hash: profile?.password_hash ?? null,
		salt: profile?.password_salt ?? null,
	});
	if (!matches) {
		throw new ValidationError('Your current password is incorrect.', {
			field: 'currentPassword',
		});
	}

	const { hash, salt } = await hashPassword(next);
	// sessions_valid_from is what makes this more than a password change: every
	// token issued before now stops verifying, so anyone else holding a live
	// session for this account is signed out by the change rather than keeping
	// their access until the token happens to expire.
	const updated = await queryOne(
		`UPDATE profiles
		    SET password_hash = $2, password_salt = $3,
		        sessions_valid_from = NOW(), updated_at = NOW()
		  WHERE id = $1
		  RETURNING *`,
		[actor.id, hash, salt],
	);

	// Which would include the person doing it, so they get a new cookie in the
	// same response.
	const session = createSessionCookie(updated);
	return jsonSuccess({ changed: true }, request, {
		headers: { 'set-cookie': session.cookie },
	});
}

/* ------------------------------------------------------------ security */

/**
 * Who has tried to sign in, from where, and whether it worked.
 *
 * Administrators only: it lists the addresses attempts came from, and for a
 * failed attempt the email that was tried, which is not something every signed
 * in user should be able to read.
 */
async function loginActivity(request) {
	await requireAdministrator(request);
	const url = new URL(request.url);
	return jsonSuccess(
		await recentAttempts(
			url.searchParams.get('limit') ?? 50,
			url.searchParams.get('offset') ?? 0,
		),
		request,
	);
}

/**
 * Sign an account out everywhere, without changing its password or disabling
 * it. The blunt version of this is disabling the account; this is the one you
 * want when you only suspect a session has been taken.
 */
async function endSessions(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	const userId =
		typeof body.userId === 'string' && body.userId ? body.userId : actor.id;

	// Ending your own sessions needs no privilege. Ending someone else's does.
	if (userId !== actor.id && actor.role !== 'administrator') {
		throw new ForbiddenError();
	}

	const updated = await queryOne(
		'UPDATE profiles SET sessions_valid_from = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
		[userId],
	);
	if (updated === null) throw new AppError('NOT_FOUND', 'No such account.', 404);

	// If you ended your own, you are still here — take a fresh cookie.
	const headers =
		userId === actor.id ? { 'set-cookie': createSessionCookie(updated).cookie } : {};
	return jsonSuccess({ user: publicProfile(updated) }, request, { headers });
}

/* ----------------------------------------------------------- user admin */

async function listUsers(request) {
	await requireAdministrator(request);
	const rows = await queryMany(
		'SELECT * FROM profiles ORDER BY lower(display_name)',
	);
	return jsonSuccess({ users: rows.map(publicProfile) }, request);
}

async function setUserStatus(request) {
	const actor = await requireAdministrator(request);
	const body = await readJson(request);
	const userId = requireString(body, 'userId', { max: 64 });
	const status = body.status === 'disabled' ? 'disabled' : 'active';

	// Locking yourself out is not a recoverable mistake without database access.
	if (userId === actor.id && status === 'disabled') {
		throw new ValidationError('You cannot disable your own account.');
	}

	const updated = await queryOne(
		`UPDATE profiles SET status = $2, updated_at = NOW()
		  WHERE id = $1 AND status <> 'invited'
		  RETURNING *`,
		[userId, status],
	);
	if (updated === null) {
		throw new AppError('NOT_FOUND', 'No such active account.', 404);
	}
	return jsonSuccess({ user: publicProfile(updated) }, request);
}

/* ------------------------------------------------------------------ route */

const routes = [
	{ method: 'POST', pattern: '/api/auth/login', handler: login },
	{ method: 'POST', pattern: '/api/auth/logout', handler: logout },
	{ method: 'POST', pattern: '/api/auth/invite', handler: invite },
	{ method: 'POST', pattern: '/api/auth/accept-invite', handler: acceptInvite },
	{ method: 'POST', pattern: '/api/auth/change-password', handler: changePassword },
	{ method: 'POST', pattern: '/api/auth/set-user-status', handler: setUserStatus },
	{ method: 'GET', pattern: '/api/auth/users', handler: listUsers },
	{ method: 'GET', pattern: '/api/auth/login-activity', handler: loginActivity },
	{ method: 'POST', pattern: '/api/auth/end-sessions', handler: endSessions },
	{ method: 'GET', pattern: '/api/me', handler: me },
];

export default withErrorHandling(async (request, context) => {
	const match = matchRoute(routes, request);
	if (match === null) {
		throw new AppError('NOT_FOUND', 'No such endpoint.', 404);
	}
	return match.handler(request, context);
});

export const config = {
	path: [
		'/api/auth/login',
		'/api/auth/logout',
		'/api/auth/invite',
		'/api/auth/accept-invite',
		'/api/auth/change-password',
		'/api/auth/set-user-status',
		'/api/auth/users',
		'/api/auth/login-activity',
		'/api/auth/end-sessions',
		'/api/me',
	],
};
