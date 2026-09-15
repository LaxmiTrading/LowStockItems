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

import { queryMany, query } from '../shared/db.mjs';
import { appBaseUrl } from '../shared/http.mjs';
import { sendPush } from '../shared/push/fcm.mjs';
import { renderDueDigest, sendEmail } from '../shared/email/resend.mjs';

const BATCH = 100;

function authorised(request) {
	if (request.headers.get('x-netlify-event') === 'schedule') return true;
	const secret = process.env.CRON_SECRET;
	return Boolean(secret) && request.headers.get('x-cron-key') === secret;
}

export default async (request) => {
	if (!authorised(request)) return new Response('Not found', { status: 404 });

	try {
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
			            f.vendor_name, f.next_followup_at, f.status_id`,
		);

		if (due.length === 0) {
			return Response.json({ ok: true, data: { due: 0 } });
		}

		// Status names for the digest, in one round trip rather than per row.
		const statuses = await queryMany(
			`SELECT id, name FROM po_followup_statuses WHERE id = ANY($1::uuid[])`,
			[due.map((d) => d.status_id).filter(Boolean)],
		);
		const statusName = new Map(statuses.map((s) => [s.id, s.name]));
		const items = due.map((d) => ({
			...d,
			status_name: statusName.get(d.status_id) ?? null,
		}));

		const baseUrl = appBaseUrl();
		const results = { due: items.length, pushed: 0, emailed: false };

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
					? `${items[0].vendor_name ?? 'This vendor'} was due a call back.`
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
