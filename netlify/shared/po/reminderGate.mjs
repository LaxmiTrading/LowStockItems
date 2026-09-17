/**
 * Lets the reminder sweep skip the database when nothing can be due.
 *
 * The sweep runs every fifteen minutes. Postgres (Netlify DB, on Neon) is
 * billed for the time its compute is awake, and suspends only after a few idle
 * minutes — so a query every quarter hour kept it running around the clock
 * whether or not anyone had a reminder set. This record, in Netlify Blobs,
 * carries the one fact the sweep needs to decide whether to look: when the
 * soonest pending reminder is. Reading it does not touch Postgres.
 *
 * Correctness rests on two rules, and every failure falls back to querying:
 *
 *  · Anything that changes a reminder marks the record dirty, before and after
 *    its transaction. The marker carries a fresh nonce, so every mark changes
 *    the record's ETag — deleting a key that is already absent would not.
 *
 *  · The sweep writes its result conditionally, against the ETag it read
 *    before querying. A reminder saved while the sweep was running has changed
 *    that ETag, so the write is refused and the next tick queries again,
 *    rather than recording a "next due" that never saw the new reminder.
 *
 * A missing, dirty, unreadable, or old record means "query". The age cap is a
 * backstop for a reminder written by some route that forgot to mark the
 * record — it bounds how late such a reminder could be, at a cost of a few
 * wake-ups a day.
 */

import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'po-reminders';
const KEY = 'next-due';

const MAX_UNCHECKED_MS = 6 * 60 * 60 * 1000;

// Only ever inside a call: Netlify injects the Blobs configuration per
// invocation, and getStore at module scope throws.
const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });

/**
 * Record that a reminder may have changed. Never throws: failing to mark the
 * record must not fail the save the user is making. Both marks failing needs
 * Blobs to be refusing writes while still serving reads, and even then the
 * age cap bounds the delay.
 */
export async function markRemindersChanged() {
	try {
		await store().setJSON(KEY, {
			dirty: true,
			nonce: randomUUID(),
			markedAt: new Date().toISOString(),
		});
	} catch (error) {
		console.warn('[reminder-gate] could not mark reminders changed', {
			message: error?.message,
		});
	}
}

/**
 * Whether the sweep may skip the database this tick, and the ETag to write its
 * result against when it does not.
 */
export async function readReminderGate() {
	let entry;
	try {
		entry = await store().getWithMetadata(KEY, { type: 'json' });
	} catch (error) {
		console.warn('[reminder-gate] unreadable; querying', {
			message: error?.message,
		});
		return { skip: false, etag: null, exists: false, readable: false };
	}

	if (!entry) return { skip: false, etag: null, exists: false, readable: true };

	const { data } = entry;
	let etag = entry.etag ?? null;
	// The local Blobs server behind `netlify dev` sends no ETag on a read, but
	// does list one. A stale ETag from the listing can only make the later
	// conditional write refuse, never succeed wrongly.
	if (!etag) {
		try {
			const { blobs } = await store().list({ prefix: KEY });
			etag = blobs.find((b) => b.key === KEY)?.etag || null;
		} catch {
			etag = null;
		}
	}
	const checkedAt = Date.parse(data?.checkedAt ?? '');
	const nextDueAt =
		data?.nextDueAt === null ? null : Date.parse(data?.nextDueAt ?? '');
	const now = Date.now();

	const skip =
		data?.dirty === false &&
		Number.isFinite(checkedAt) &&
		now - checkedAt < MAX_UNCHECKED_MS &&
		(nextDueAt === null || (Number.isFinite(nextDueAt) && nextDueAt > now));

	return { skip, etag, exists: true, readable: true };
}

/**
 * Store what the sweep found, unless a reminder changed since it read the gate.
 *
 * `checkedAt` should be when the sweep started, not when it finished, so the
 * age cap is measured from the oldest data it can have seen.
 */
export async function recordReminderCheck(gate, { nextDueAt, checkedAt }) {
	if (!gate.readable) return;
	// A record that exists but came back without an ETag cannot be written
	// conditionally, and an unconditional write could hide a new reminder.
	if (gate.exists && !gate.etag) return;

	try {
		await store().setJSON(
			KEY,
			{
				dirty: false,
				nextDueAt: nextDueAt ? new Date(nextDueAt).toISOString() : null,
				checkedAt: new Date(checkedAt).toISOString(),
			},
			gate.exists ? { onlyIfMatch: gate.etag } : { onlyIfNew: true },
		);
	} catch (error) {
		console.warn('[reminder-gate] could not record the check', {
			message: error?.message,
		});
	}
}
