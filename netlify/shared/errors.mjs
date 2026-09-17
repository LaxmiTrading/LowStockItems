/**
 * Typed application errors.
 *
 * Every error that reaches a client goes through one of these, so the HTTP
 * status and the machine-readable code are decided here rather than at each
 * throw site. Anything that is *not* an AppError is reported as a generic 500
 * with its detail kept server-side — an unexpected failure must never leak a
 * stack trace, a connection string or a Zoho token to the browser.
 */

export class AppError extends Error {
	constructor(code, message, status = 400, details = null) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export class ValidationError extends AppError {
	constructor(message, details = null) {
		super('VALIDATION', message, 400, details);
	}
}

/** Deliberately identical wording for "no such account" and "wrong password". */
export class InvalidCredentialsError extends AppError {
	constructor() {
		super('INVALID_CREDENTIALS', 'That email and password do not match.', 401);
	}
}

export class UnauthenticatedError extends AppError {
	constructor(message = 'Sign in to continue.') {
		super('UNAUTHENTICATED', message, 401);
	}
}

export class SessionExpiredError extends AppError {
	constructor() {
		super('SESSION_EXPIRED', 'Your session has expired. Sign in again.', 401);
	}
}

export class AccountDisabledError extends AppError {
	constructor() {
		super('ACCOUNT_DISABLED', 'This account has been disabled.', 403);
	}
}

export class ForbiddenError extends AppError {
	constructor(message = 'You do not have access to that.') {
		super('FORBIDDEN', message, 403);
	}
}

export class DatabaseUnavailableError extends AppError {
	constructor(message = 'The database is not reachable right now.') {
		super('DATABASE_UNAVAILABLE', message, 503);
	}
}

export class ZohoNotConfiguredError extends AppError {
	constructor(
		message = 'Zoho is not connected yet. An administrator needs to connect it.',
	) {
		super('ZOHO_NOT_CONFIGURED', message, 503);
	}
}

export class ZohoAuthenticationError extends AppError {
	constructor(message = 'Zoho rejected the stored credentials.') {
		super('ZOHO_AUTH_FAILED', message, 502);
	}
}

/**
 * Zoho is throttling token requests for this refresh token. Distinct from
 * ZohoAuthenticationError on purpose: the credentials are fine, and saying
 * otherwise sends people off to regenerate them — which does not lift a block.
 */
export class ZohoRateLimitedError extends AppError {
	constructor(retryAfterSeconds = 300) {
		super(
			'ZOHO_RATE_LIMITED',
			'Zoho is limiting how often a new access token can be requested. Try again in a few minutes.',
			429,
			{ retryAfterSeconds },
		);
	}
}
