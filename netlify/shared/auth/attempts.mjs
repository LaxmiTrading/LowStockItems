/**
 * Sign-in rate limiting and the attempt log.
 *
 * The limiter this replaces was a Map in module scope, which on Netlify means
 * one counter per warm instance. Requests are spread across instances that
 * share no memory, so a burst of guesses from a single address was counted as
 * one attempt here, one there, and the limit never fired — twelve consecutive
 * wrong passwords against production were all answered 401 and none 429.
 *
 * Counting in the database is slower by one round trip and correct, which is
 * the right trade for the one endpoint in the application where being wrong
 * means unlimited password guesses.
 *
 * Two limits, because they stop different attacks:
 *
 *   · per address — one host working through a password list
 *   · per account — a botnet spreading the same guesses over many addresses,
 *     which no per-address limit can see
 *
 * Both are rolling windows rather than sticky lockouts. A sticky lockout on an
 * account hands any stranger a way to keep the real owner out by failing to
 * log in as them on purpose.
 */

import { AppError } from '../errors.mjs';
import { query, queryMany, queryOne } from '../db.mjs';

const WINDOW_MINUTES = 15;

// The per-account limit is the one that actually protects an account: it
// applies however many addresses the guessing is spread across. The per-address
// limit only adds the ability to cut off one host spraying many accounts, which
// in an application with a handful of accounts is a small extra win.
//
// It is set well above the per-account limit because everyone in one office
// shares a public address, and a threshold low enough to catch a sprayer is
// also low enough to lock out the whole building. Ten was too low: a burst of
// fourteen attempts against an address that does not exist locked out a real
// user behind the same connection.
const MAX_FAILURES_PER_IP = 30;
const MAX_FAILURES_PER_EMAIL = 12;

export const OUTCOMES = {
	success: 'success',
	badPassword: 'bad_password',
	noAccount: 'no_account',
	disabled: 'disabled',
	notActivated: 'not_activated',
	blocked: 'blocked',
};

const FAILURES = [
	OUTCOMES.badPassword,
	OUTCOMES.noAccount,
	OUTCOMES.disabled,
	OUTCOMES.notActivated,
];

/**
 * Where the request came from, as far as the edge will tell us.
 *
 * `context.geo` is Netlify's own lookup, so it cannot be spoofed by a header
 * the way an X-Forwarded-For can. It is recorded for the activity list, never
 * used to allow or deny anything — geography is evidence, not a credential.
 */
export function requestOrigin(request, context) {
	const forwarded = request.headers.get('x-forwarded-for');
	return {
		ip:
			context?.ip ??
			request.headers.get('x-nf-client-connection-ip') ??
			forwarded?.split(',')[0]?.trim() ??
			null,
		country: context?.geo?.country?.name ?? context?.geo?.country?.code ?? null,
		city: context?.geo?.city ?? null,
		// Capped: this is attacker-controlled text on its way into a table.
		userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
	};
}

/** Never let logging an attempt be the reason a sign-in fails. */
export async function recordAttempt({ email, outcome, origin }) {
	try {
		await query(
			`INSERT INTO login_attempts (email, ip, country, city, user_agent, outcome)
			 VALUES (lower($1), $2, $3, $4, $5, $6)`,
			[
				email ?? null,
				origin.ip,
				origin.country,
				origin.city,
				origin.userAgent,
				outcome,
			],
		);
	} catch (error) {
		console.error('[auth] could not record login attempt', {
			code: error?.code,
			outcome,
		});
	}
}

/**
 * Throws 429 when this address or this account has failed too often lately.
 *
 * Called before the password is checked, so a blocked caller is turned away
 * without the server doing the expensive scrypt work — which also means the
 * limit protects the CPU budget, not just the account.
 */
export async function enforceLoginLimit({ email, origin }) {
	let counts;
	try {
		// Every parameter is cast explicitly. Left to inference, `$3 || ' minutes'`
		// and a bare ANY($4) are the kind of thing that parses here and fails on
		// the server, and this query is on the critical path of every sign-in.
		// Failures are only counted since the last time the same address, or the
		// same account, actually signed in. Getting your password right is the
		// clearest possible evidence that the attempts before it were yours and
		// were honest mistakes, so they stop being held against you.
		//
		// The rows themselves are left alone — this changes what the limiter
		// counts, not what the audit trail remembers.
		counts = await queryOne(
			`WITH window_start AS (
			   SELECT NOW() - make_interval(mins => $3::int) AS floor
			 ),
			 last_success AS (
			   SELECT
			     (SELECT max(at) FROM login_attempts
			       WHERE ip = $1::text AND outcome = 'success')           AS by_ip,
			     (SELECT max(at) FROM login_attempts
			       WHERE email = lower($2::text) AND outcome = 'success') AS by_email
			 )
			 SELECT
			   count(*) FILTER (
			     WHERE a.ip = $1::text
			       AND a.at > GREATEST(w.floor, COALESCE(s.by_ip, w.floor))
			   ) AS ip_failures,
			   count(*) FILTER (
			     WHERE a.email = lower($2::text)
			       AND a.at > GREATEST(w.floor, COALESCE(s.by_email, w.floor))
			   ) AS email_failures
			 FROM login_attempts a, window_start w, last_success s
			 WHERE a.at > w.floor
			   AND a.outcome = ANY($4::text[])`,
			[origin.ip, email ?? '', WINDOW_MINUTES, FAILURES],
		);
	} catch (error) {
		// A limiter that fails closed would turn a database blip into a total
		// sign-in outage. Fail open, but say so loudly in the logs.
		console.error('[auth] rate limit check failed, allowing attempt', {
			code: error?.code,
		});
		return;
	}

	// With no address the FILTER matches nothing, so the per-address limit is
	// simply absent and the per-account one carries the load. Netlify always
	// supplies one, so this is a belt-and-braces path rather than a real mode.
	const ipFailures = Number(counts?.ip_failures ?? 0);
	const emailFailures = Number(counts?.email_failures ?? 0);

	if (ipFailures >= MAX_FAILURES_PER_IP || emailFailures >= MAX_FAILURES_PER_EMAIL) {
		await recordAttempt({ email, outcome: OUTCOMES.blocked, origin });
		throw new AppError(
			'RATE_LIMITED',
			`Too many sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.`,
			429,
		);
	}
}

/* ------------------------------------------------------------- reporting */

/** The administrator's view: what has been tried lately, and from where. */
export async function recentAttempts(limit = 50) {
	return queryMany(
		`SELECT at, email, ip, country, city, outcome
		   FROM login_attempts
		  ORDER BY at DESC
		  LIMIT $1`,
		[Math.min(Math.max(Number(limit) || 50, 1), 200)],
	);
}

/**
 * Housekeeping, run on the rare successful sign-in rather than on a schedule:
 * there is no cron here, and the table only needs to stay small enough that the
 * windowed count remains cheap.
 */
export async function pruneOldAttempts() {
	try {
		await query("DELETE FROM login_attempts WHERE at < NOW() - INTERVAL '90 days'");
	} catch {
		// Housekeeping is never worth failing a sign-in over.
	}
}
