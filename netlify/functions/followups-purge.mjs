/**
 * Forget the orders that are finished.
 *
 * Once a purchase order is billed, closed or cancelled there is nothing left
 * to chase, and by the decision taken for this feature its follow-up state and
 * call history are deleted outright rather than archived.
 *
 * That is irreversible and unattended, which dictates how it is written:
 *
 *  · A row is deleted only when Zoho has been asked about that specific order
 *    and has answered with a final status. Absence from a list is never
 *    treated as evidence — a half-drained pagination loop or a transient error
 *    looks exactly like "it is no longer open", and reading that as "received"
 *    would destroy months of call history in a single bad run.
 *  · The PO numbers deleted are logged, because the function log is the only
 *    record that will exist afterwards.
 *
 * Runs daily rather than every quarter hour: it costs one Zoho call per
 * tracked order and shares the organisation's rate limit with people using the
 * app.
 */

import { queryMany, query } from '../shared/db.mjs';
import { getAccessToken, requireResolvedCredentials } from '../shared/zoho/tokens.mjs';

// What Zoho calls an order that is done with. `received` is included for
// organisations that track receipts; the rest are Zoho Books' own vocabulary.
const FINAL = new Set(['billed', 'closed', 'cancelled', 'received', 'void']);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authorised(request) {
	if (request.headers.get('x-netlify-event') === 'schedule') return true;
	const secret = process.env.CRON_SECRET;
	return Boolean(secret) && request.headers.get('x-cron-key') === secret;
}

export default async (request) => {
	if (!authorised(request)) return new Response('Not found', { status: 404 });

	try {
		const tracked = await queryMany(
			`SELECT purchaseorder_id, purchaseorder_number FROM po_followups`,
		);
		if (tracked.length === 0) {
			return Response.json({ ok: true, data: { checked: 0, deleted: 0 } });
		}

		const credentials = await requireResolvedCredentials();
		const token = await getAccessToken();

		const purged = [];
		let checked = 0;
		let unreadable = 0;

		for (const row of tracked) {
			try {
				const res = await fetch(
					`${credentials.apiDomain}/books/v3/purchaseorders/${encodeURIComponent(row.purchaseorder_id)}` +
						`?organization_id=${encodeURIComponent(credentials.organizationId)}`,
					{ headers: { Authorization: `Zoho-oauthtoken ${token}` } },
				);

				// 404 means Zoho no longer has the order at all — deleted at the
				// source. That IS a positive answer, so the local row goes too.
				if (res.status === 404) {
					purged.push(row);
					checked++;
					await delay(300);
					continue;
				}

				if (!res.ok) {
					// Anything else — a 429, a 500, an expired token — is not an
					// answer about this order, so it is left exactly as it is.
					unreadable++;
					await delay(300);
					continue;
				}

				const body = await res.json();
				const status = String(body?.purchaseorder?.status ?? '').toLowerCase();
				checked++;

				if (status && FINAL.has(status)) purged.push(row);
			} catch (error) {
				unreadable++;
				console.error('[followups-purge] could not read order', {
					purchaseorder_id: row.purchaseorder_id,
					message: error?.message,
				});
			}

			// The same pacing every batch read in this codebase uses.
			await delay(300);
		}

		if (purged.length > 0) {
			// ON DELETE CASCADE on po_followup_events takes the timeline with it.
			await query(
				`DELETE FROM po_followups WHERE purchaseorder_id = ANY($1::text[])`,
				[purged.map((p) => p.purchaseorder_id)],
			);
		}

		// The only surviving record of what was removed.
		console.log('[followups-purge]', {
			tracked: tracked.length,
			checked,
			unreadable,
			deleted: purged.length,
			numbers: purged.map((p) => p.purchaseorder_number ?? p.purchaseorder_id),
		});

		return Response.json({
			ok: true,
			data: {
				tracked: tracked.length,
				checked,
				unreadable,
				deleted: purged.length,
			},
		});
	} catch (error) {
		console.error('[followups-purge] run failed', { message: error?.message });
		return Response.json(
			{ ok: false, error: { code: 'INTERNAL', message: 'Run failed.' } },
			{ status: 500 },
		);
	}
};

// 01:30 UTC is 07:00 IST — after the overnight, before anyone is working.
export const config = {
	schedule: '30 1 * * *',
};
