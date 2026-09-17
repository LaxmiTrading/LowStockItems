/**
 * Create, or reset, an administrator account in a local database.
 *
 *   npm run admin:local -- --email you@example.com --name "Your Name"
 *
 * The API has no way to make the first account — /api/auth/bootstrap is
 * described at the top of auth.mjs but never routed — so a fresh local
 * database has nobody who can sign in, and nothing behind the session check
 * (the Zoho proxy included) can be tried. This fills that gap for development.
 *
 * It refuses any database that is not on this machine unless given
 * --allow-remote. An administrator created by accident in production is an
 * account nobody invited, and nothing would show that it happened.
 *
 * The password is generated and printed once. Set LSI_ADMIN_PASSWORD to choose
 * your own instead; it is read from the environment rather than a flag so it
 * does not land in your shell history.
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import {
	hashPassword,
	MIN_PASSWORD_LENGTH,
} from '../netlify/shared/auth/password.mjs';

function loadEnv() {
	let text = '';
	try {
		text = readFileSync('.env', 'utf8');
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

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set in .env.');
	process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
if (!isLocal && !process.argv.includes('--allow-remote')) {
	console.error(
		'DATABASE_URL does not point at this machine, so nothing was changed.',
	);
	console.error(
		'This script is for local development. Pass --allow-remote only if you are certain.',
	);
	process.exit(1);
}

const email = arg('email');
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
	console.error(
		'Usage: npm run admin:local -- --email you@example.com [--name "Your Name"]',
	);
	process.exit(1);
}
const displayName = (arg('name') || email.split('@')[0]).trim();

const password =
	process.env.LSI_ADMIN_PASSWORD || randomBytes(15).toString('base64url');
if (password.length < MIN_PASSWORD_LENGTH) {
	console.error(
		`LSI_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
	);
	process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : undefined });

try {
	await client.connect();
} catch (error) {
	console.error(`Could not connect to the database: ${error.message}`);
	console.error('Is the local Postgres container running?');
	process.exit(1);
}

try {
	const ready = await client.query(
		`SELECT to_regclass('public.profiles') IS NOT NULL AS ok`,
	);
	if (!ready.rows[0].ok) {
		console.error('The profiles table does not exist yet. Run: npm run migrate');
		process.exit(1);
	}

	const { hash, salt } = await hashPassword(password);

	// Update first, insert only if nobody matched. Reusing an address resets it
	// to a working administrator rather than failing on the unique index, and
	// moving sessions_valid_from signs out anything issued under the old
	// password.
	const updated = await client.query(
		`UPDATE profiles
		    SET display_name = $2, role = 'administrator', status = 'active',
		        password_hash = $3, password_salt = $4,
		        invite_token_hash = NULL, invite_expires_at = NULL,
		        reset_token_hash = NULL, reset_expires_at = NULL,
		        sessions_valid_from = NOW(), updated_at = NOW()
		  WHERE lower(email) = lower($1)`,
		[email, displayName, hash, salt],
	);

	if (updated.rowCount === 0) {
		await client.query(
			`INSERT INTO profiles
			   (email, display_name, role, status, password_hash, password_salt)
			 VALUES ($1, $2, 'administrator', 'active', $3, $4)`,
			[email, displayName, hash, salt],
		);
	}

	const base = (process.env.APP_BASE_URL || 'http://localhost:8888').replace(/\/+$/, '');
	console.log(updated.rowCount === 0 ? 'Created administrator.' : 'Reset existing account to administrator.');
	console.log('');
	console.log(`  sign in at : ${base}`);
	console.log(`  email      : ${email}`);
	if (process.env.LSI_ADMIN_PASSWORD) {
		console.log('  password   : (the one in LSI_ADMIN_PASSWORD)');
	} else {
		console.log(`  password   : ${password}`);
		console.log('');
		console.log('Shown once. Change it in Settings after signing in if you like.');
	}
} finally {
	await client.end();
}
