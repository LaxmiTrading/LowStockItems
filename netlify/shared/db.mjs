/**
 * Database access.
 *
 * Written against plain `pg` rather than a provider-specific driver, so
 * Netlify DB (Neon) can be swapped for any other Postgres by changing the
 * connection string alone. Every query in the application goes through here,
 * and every one is parameterized — no user input is ever interpolated into
 * SQL.
 */

import pg from 'pg';
import { DatabaseUnavailableError } from './errors.mjs';

// node-postgres returns BIGINT as a string to avoid precision loss. The only
// bigints here are row counts, comfortably inside the safe integer range.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

// DATE (oid 1082) arrives as a JS Date at *local* midnight, which JSON then
// serializes as UTC. East of Greenwich that moves the day backwards: a vendor
// promising 2026-09-18 reaches the browser as 2026-09-17T18:30:00Z and is read
// as the 17th. A bare calendar date has no time and no zone, so it is kept as
// the 'YYYY-MM-DD' string Postgres already sent.
pg.types.setTypeParser(1082, (value) => value);

function connectionString() {
	const url =
		process.env.DATABASE_URL ??
		process.env.NETLIFY_DATABASE_URL ??
		process.env.NETLIFY_DATABASE_URL_UNPOOLED;
	if (!url) {
		throw new DatabaseUnavailableError(
			'No database connection string is configured on the server.',
		);
	}
	return url;
}

const isLocal = (url) => /localhost|127\.0\.0\.1/.test(url);

/**
 * Which connection string is in play, for diagnostics — never the string
 * itself. DATABASE_URL deliberately wins over NETLIFY_DATABASE_URL so a
 * developer can point at their own Postgres, but that precedence also means a
 * stale or placeholder value silently beats a perfectly good Netlify DB. That
 * is a hard failure to see from the outside, so /api/health reports it.
 */
export function connectionInfo() {
	const source = process.env.DATABASE_URL
		? 'DATABASE_URL'
		: process.env.NETLIFY_DATABASE_URL
			? 'NETLIFY_DATABASE_URL'
			: process.env.NETLIFY_DATABASE_URL_UNPOOLED
				? 'NETLIFY_DATABASE_URL_UNPOOLED'
				: null;

	const url = source ? process.env[source] : '';
	return {
		source,
		// A connection pointing at localhost cannot work from a Netlify
		// function, and is the signature of a pasted example value.
		pointsAtLocalhost: Boolean(url) && isLocal(url),
	};
}

/**
 * One module-scoped pool, reused across warm invocations. `max` is small on
 * purpose: serverless scales by adding instances, so a large per-instance pool
 * exhausts the database's connection limit.
 */
let pool = null;

export function getPool() {
	if (pool !== null) return pool;

	const url = connectionString();
	pool = new pg.Pool({
		connectionString: url,
		ssl: isLocal(url) ? false : { rejectUnauthorized: true },
		max: 3,
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 8_000,
		statement_timeout: 20_000,
		query_timeout: 20_000,
	});

	// An idle client erroring must not take the process down.
	pool.on('error', (error) =>
		console.error('[db] idle client error', { message: error.message }),
	);

	return pool;
}

const CONNECTION_CODES = new Set([
	'ECONNREFUSED',
	'ETIMEDOUT',
	'ENOTFOUND',
	'EHOSTUNREACH',
	'57P01',
	'57P03',
	'08006',
	'08001',
]);

export async function query(text, parameters = []) {
	try {
		return await getPool().query(text, parameters);
	} catch (error) {
		if (error instanceof DatabaseUnavailableError) throw error;
		if (CONNECTION_CODES.has(String(error?.code))) {
			throw new DatabaseUnavailableError();
		}
		console.error('[db] query failed', { message: error?.message });
		throw error;
	}
}

export async function queryOne(text, parameters = []) {
	const result = await query(text, parameters);
	return result.rows[0] ?? null;
}

export async function queryMany(text, parameters = []) {
	const result = await query(text, parameters);
	return result.rows;
}

/**
 * Run `fn` inside a transaction, on one client held for its duration.
 *
 * Needed wherever a write is only correct as a whole — logging a vendor call
 * inserts the event, may move the order's status, and recomputes the order's
 * next reminder, and an order left with a reminder that no surviving call
 * asked for would notify forever.
 *
 * `fn` is handed a `run(text, params)` rather than the raw client, so callers
 * cannot accidentally reach for the pool's `query` mid-transaction and have
 * that statement land on a different connection, outside the transaction.
 *
 * Keep the work inside short and free of network calls: the pool is `max: 3`
 * per instance, so a client held across an HTTP request starves the others.
 */
export async function withTransaction(fn) {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await fn((text, parameters = []) =>
			client.query(text, parameters),
		);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		// A rollback can itself fail on a broken connection. The original error
		// is the one worth reporting, so this must not replace it.
		try {
			await client.query('ROLLBACK');
		} catch (rollbackError) {
			console.error('[db] rollback failed', {
				message: rollbackError?.message,
			});
		}
		if (CONNECTION_CODES.has(String(error?.code))) {
			throw new DatabaseUnavailableError();
		}
		throw error;
	} finally {
		client.release();
	}
}
