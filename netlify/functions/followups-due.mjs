/**
 * The reminder sweep.
 *
 * Runs every fifteen minutes, finds the follow-ups that have come due, and
 * tells everyone — a web push to every registered device and one digest email
 * to every active account.
 *
 * Scheduled functions are still reachable at their URL, and this one cannot
 * call requireUser because a cron has no session. So anything that is not
 * Netlify's own scheduled invocation has to present CRON_SECRET, and anything
 * else gets a 404 rather than a 401 — there is no reason to confirm the
 * endpoint exists to someone guessing at it.
 */

import { queryMany, queryOne, query } from '../shared/db.mjs';
import { appBaseUrl } from '../shared/http.mjs';
import { sendPush } from '../shared/push/fcm.mjs';
import { renderDueDigest, sendEmail } from '../shared/email/resend.mjs';
import {
	readReminderGate,
	recordReminderCheck,
} from '../shared/po/reminderGate.mjs';
import { dueReason } from '../shared/po/dueMessage.mjs';

const BATCH = 100;

/**
 * How long a nudge nobody answered stays quiet before it asks again.
 *
 * A reminder that fires once and is never heard from again defeats the job it
 * exists for: chasing a vendor is asking repeatedly until something moves. What
 * makes repeating safe is that there are two ways to stop it — the response
 * form's "resolved" and "schedule a new follow-up" — so a nudge that has been
 * dealt with goes quiet immediately, and only genuinely unanswered ones repeat.
 *
 * Daily rather than every fifteen minutes for the obvious reason.
 */
const RENUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function authorised(request) {
	if (request.headers.get('x-netlify-event') === 'schedule') return true;
	const secret = process.env.CRON_SECRET;
	return Boolean(secret) && request.headers.get('x-cron-key') === secret;
}

/**
 * Remember when the next reminder falls due, so the ticks before then can skip
 * the database. Best-effort: if this fails, the next tick simply queries.
 */
async function recordNextDue(gate, checkedAt) {
	try {
		// Two ways a tick can have work: a reminder that has not been sent, and
		// a stage nudge that was sent, went unanswered, and is old enough to ask
		// again. The second has to be in here — leave it out and the gate would
		// happily sleep through every repeat it was meant to schedule.
		const row = await queryOne(
			`SELECT MIN(due) AS next_due FROM (
			   SELECT next_followup_at AS due
			     FROM po_followups
			    WHERE next_followup_at IS NOT NULL AND notified_at IS NULL
			   UNION ALL
			   SELECT notified_at + ($1 || ' milliseconds')::interval
			     FROM po_followups
			    WHERE next_followup_at IS NOT NULL
			      AND notified_at IS NOT NULL
			      AND next_followup_source = 'stage'
			      AND chase_resolved_at IS NULL
			 ) c`,
			[String(RENUDGE_INTERVAL_MS)],
		);
		await recordReminderCheck(gate, { nextDueAt: row?.next_due ?? null, checkedAt });
	} catch (error) {
		console.warn('[followups-due] could not record the next due time', {
			message: error?.message,
		});
	}
}

export default async (request) => {
	if (!authorised(request)) return new Response('Not found', { status: 404 });

	// Nothing can be due before the soonest reminder, so until then this tick
	// leaves Postgres asleep. See shared/po/reminderGate.mjs for why that is
	// safe.
	const gate = await readReminderGate();
	if (gate.skip) {
		return Response.json({ ok: true, data: { due: 0, skipped: true } });
	}
	const checkedAt = Date.now();

	try {
		// Ask again about anything nobody answered.
		//
		// Only stage nudges repeat. "Remind me at this time" is a request for one
		// reminder, and turning it into a daily one would be a different promise
		// than the person made to themselves. A stage saying "chase while this
		// sits here" is exactly a standing request, and the response form's two
		// exits — resolved, or a new date — are how it is called off.
		//
		// Clearing the stamp rather than notifying directly, so these rejoin the
		// claim below and get the same SKIP LOCKED protection against two
		// overlapping runs sending twice.
		const rearmed = await queryMany(
			`UPDATE po_followups
			    SET notified_at = NULL
			  WHERE next_followup_at IS NOT NULL
			    AND notified_at IS NOT NULL
			    AND next_followup_source = 'stage'
			    AND chase_resolved_at IS NULL
			    AND notified_at <= NOW() - ($1 || ' milliseconds')::interval
			  RETURNING id`,
			[String(RENUDGE_INTERVAL_MS)],
		);

		// Claimed before anything is sent, and in one statement. If the send
		// half of this run times out, the rows are already stamped and the next
		// tick will not notify them again — a duplicate reminder is worse than
		// a missed one here, because the missed one is still visible in the
		// list and the duplicate trains people to ignore the alert.
		//
		// SKIP LOCKED so two overlapping runs take different rows rather than
		// one waiting on the other.
		const due = await queryMany(
			`UPDATE po_followups f
			    SET notified_at = NOW()
			  WHERE f.id IN (
			    SELECT id FROM po_followups
			     WHERE next_followup_at IS NOT NULL
			       AND next_followup_at <= NOW()
			       AND notified_at IS NULL
			     ORDER BY next_followup_at
			     LIMIT ${BATCH}
			     FOR UPDATE SKIP LOCKED
			  )
			  RETURNING f.id, f.purchaseorder_id, f.purchaseorder_number,
			            f.vendor_name, f.next_followup_at, f.status_id,
			            f.next_followup_source, f.promised_dispatch_date,
			            f.status_since`,
		);

		if (due.length === 0) {
			await recordNextDue(gate, checkedAt);
			return Response.json({ ok: true, data: { due: 0, rearmed: rearmed.length } });
		}

		// Stage names and their wording for the digest, in one round trip rather
		// than per row.
		const statuses = await queryMany(
			`SELECT id, name, chase_note, chase_anchor
			   FROM po_followup_statuses WHERE id = ANY($1::uuid[])`,
			[due.map((d) => d.status_id).filter(Boolean)],
		);
		const stageById = new Map(statuses.map((s) => [s.id, s]));
		const items = due.map((d) => {
			const stage = stageById.get(d.status_id) ?? null;
			return {
				...d,
				status_name: stage?.name ?? null,
				// Only a stage-derived nudge speaks for the stage. A reminder
				// somebody typed keeps its own wording even on a stage that has
				// some configured.
				chase_note:
					d.next_followup_source === 'stage' ? (stage?.chase_note ?? null) : null,
				chase_anchor: stage?.chase_anchor ?? 'stage',
			};
		});

		const baseUrl = appBaseUrl();
		const results = { due: items.length, rearmed: rearmed.length, pushed: 0, emailed: false };

		// Push first: it is the one that actually interrupts someone, and it is
		// the cheaper of the two to lose if the run is killed.
		try {
			const devices = await queryMany(`SELECT token FROM push_devices`);
			const tokens = devices.map((d) => d.token);

			const title =
				items.length === 1
					? `Follow up: ${items[0].purchaseorder_number ?? 'purchase order'}`
					: `${items.length} follow-ups are due`;
			const body =
				items.length === 1
					? dueReason(items[0])
					: items
							.slice(0, 3)
							.map((i) => i.vendor_name ?? '—')
							.join(', ') + (items.length > 3 ? '…' : '');

			const { sent, dead } = await sendPush({
				tokens,
				title,
				body,
				url: `${baseUrl}/purchase-orders?filter=due`,
			});
			results.pushed = sent;

			// A token Firebase says is gone will never deliver again.
			if (dead.length > 0) {
				await query(`DELETE FROM push_devices WHERE token = ANY($1::text[])`, [
					dead,
				]);
			}
		} catch (error) {
			console.error('[followups-due] push failed', { message: error?.message });
		}

		try {
			const people = await queryMany(
				`SELECT email FROM profiles WHERE status = 'active'`,
			);
			if (people.length > 0) {
				const { subject, html, text } = renderDueDigest(items, baseUrl);
				// sendEmail reports rather than throws when Resend is not
				// configured, so the result has to come from its return value.
				// Logging "emailed" on a site with no key would make the one
				// window into this job say the opposite of what happened.
				const outcome = await sendEmail({
					to: people.map((p) => p.email),
					subject,
					html,
					text,
				});
				results.emailed = outcome.sent === true;
				if (!outcome.sent) results.emailSkipped = outcome.reason;
			}
		} catch (error) {
			console.error('[followups-due] email failed', {
				message: error?.message,
			});
		}

		await recordNextDue(gate, checkedAt);
		console.log('[followups-due]', results);
		return Response.json({ ok: true, data: results });
	} catch (error) {
		console.error('[followups-due] run failed', { message: error?.message });
		return Response.json(
			{ ok: false, error: { code: 'INTERNAL', message: 'Run failed.' } },
			{ status: 500 },
		);
	}
};

// Netlify reads the schedule from here, so netlify.toml needs no entry. Cron
// is evaluated in UTC; every quarter hour means this is timezone-agnostic.
export const config = {
	schedule: '*/15 * * * *',
};
