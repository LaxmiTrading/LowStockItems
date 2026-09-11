/**
 * The application's own API.
 *
 * Every call carries the session cookie (`credentials: 'include'`) and nothing
 * else — there is no token for this module to attach, because the browser no
 * longer holds one.
 */

export class ApiError extends Error {
	constructor(code, message, status, details) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
		this.details = details ?? null;
	}
}

export const isAuthError = (error) =>
	error instanceof ApiError &&
	(error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED');

async function request(path, { method = 'GET', body } = {}) {
	let response;
	try {
		response = await fetch(path, {
			method,
			credentials: 'include',
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch {
		throw new ApiError('NETWORK', 'Could not reach the server.', 0);
	}

	let payload = null;
	try {
		payload = await response.json();
	} catch {
		// A non-JSON body from an error page is still an error.
	}

	if (!response.ok || payload?.ok === false) {
		const error = payload?.error ?? {};
		throw new ApiError(
			error.code ?? 'INTERNAL',
			error.message ?? 'Something went wrong.',
			response.status,
			error.details,
		);
	}

	return payload?.data ?? null;
}

export const api = {
	get: (path) => request(path),
	post: (path, body) => request(path, { method: 'POST', body }),
};

/* ------------------------------------------------------------------ auth */

export const login = (email, password) =>
	api.post('/api/auth/login', { email, password });

export const logoutRequest = () => api.post('/api/auth/logout', {});

export const fetchMe = () => api.get('/api/me');

export const acceptInvite = (token, password) =>
	api.post('/api/auth/accept-invite', { token, password });

export const changePassword = (currentPassword, newPassword) =>
	api.post('/api/auth/change-password', { currentPassword, newPassword });

/* ------------------------------------------------------------------ users */

export const listUsers = () => api.get('/api/auth/users');

export const inviteUser = (payload) => api.post('/api/auth/invite', payload);

export const setUserStatus = (userId, status) =>
	api.post('/api/auth/set-user-status', { userId, status });

/* --------------------------------------------------------------- security */

export const loginActivity = (limit = 50) =>
	api.get(`/api/auth/login-activity?limit=${limit}`);

/** Omit userId to end your own sessions everywhere. */
export const endSessions = (userId) =>
	api.post('/api/auth/end-sessions', userId ? { userId } : {});

/* ------------------------------------------------------------------ zoho */

export const zohoStatus = () => api.get('/api/zoho/status');

export const zohoDisconnect = () => api.post('/api/zoho/disconnect', {});
