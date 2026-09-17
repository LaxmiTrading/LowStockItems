/**
 * Server-side reads of Zoho purchase orders, and reconciling follow-ups
 * against them.
 *
 * A follow-up is only worth keeping while its order is still open with the
 * vendor. Once an order is billed, closed or cancelled it drops out of the
 * open and draft lists, and its follow-up row and call history are deleted.
 *
 * That deletion is irreversible, so two rules hold it back:
 *
 *  · The active list must have come back whole. Every page answered, every
 *    page said code 0, pagination ran to its end. A fetch that failed half
 *    way looks exactly like "those orders closed", and trusting it would wipe
 *    the timelines of orders that are still very much open.
 *
 *  · A follow-up created after the fetch began is never deleted by it. An
 *    order raised in Zoho a second after the list was read would otherwise be
 *    missing from it and lose its first call.
 */

import { query, queryMany, queryOne } from '../db.mjs';
import {
	getAccessToken,
	invalidateAccessToken,
	requireResolvedCredentials,
} from './tokens.mjs';

/** The statuses the Purchase Orders page lists — see FOLLOWABLE_PO_STATUSES. */
const ACTIVE_FILTERS = ['Status.Draft', 'Status.Open'];

const PER_PAGE = 200; // Zoho's maximum, so the fewest calls.
const PAGE_CAP = 100; // A malformed page_context must not loop forever.

/** Never sweep more often than this, whoever asks. Also covers a run in flight. */
const MIN_GAP_SECONDS = 120;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function zohoGet(resource, params) {
	const { organizationId } = await requireResolvedCredentials();
	const search = new URLSearchParams({ ...params, organization_id: organizationId });

	for (let attempt = 0; attempt < 2; attempt++) {
		const { accessToken, apiDomain } = await getAccessToken({
			forceRefresh: attempt > 0,
		});
		const response = await fetch(
			`${apiDomain}/books/v3/${resource}?${search.toString()}`,
			{ headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } },
		);

		// Zoho can revoke a token early. Clear exactly that one and try once
		// more, the same way the proxy does.
		if (response.status === 401 && attempt === 0) {
			await invalidateAccessToken(accessToken);
			continue;
		}

		const body = await response.json().catch(() => null);
		return { status: response.status, body };
	}
	return { status: 401, body: null };
}

/**
 * Every open and draft purchase-order id, with a flag saying whether the
 * list is known to be complete. Callers that delete must check it.
 */
export async function listActivePurchaseOrderIds() {
	const ids = new Set();
	let calls = 0;

	for (const filter of ACTIVE_FILTERS) {
		let page = 1;
		let more = true;

		while (more) {
			if (page > PAGE_CAP) {
				return { complete: false, reason: `stopped at ${PAGE_CAP} pages of ${filter}`, ids, calls };
			}

			let result;
			try {
				result = await zohoGet('purchaseorders', {
					filter_by: filter,
					page: String(page),
					per_page: String(PER_PAGE),
				});
			} catch (error) {
				return { complete: false, reason: `${filter} page ${page}: ${error.message}`, ids, calls };
			}
			calls++;

			const { status, body } = result;
			if (status !== 200 || !body || body.code !== 0 || !Array.isArray(body.purchaseorders)) {
				return {
					complete: false,
					reason: `${filter} page ${page}: HTTP ${status}, code ${body?.code ?? 'none'}`,
					ids,
					calls,
				};
			}

			for (const po of body.purchaseorders) ids.add(String(po.purchaseorder_id));

			// Without page_context the only honest signal is a short page.
			more = body.page_context
				? body.page_context.has_more_page === true
				: body.purchaseorders.length === PER_PAGE;
			page++;
			await delay(300);
		}
	}

	return { complete: true, ids, calls };
}

async function recordRun(result) {
	await query(
		`UPDATE po_followup_reconcile
		    SET last_finished_at = NOW(), last_result = $1::jsonb
		  WHERE id = 1`,
		[JSON.stringify(result)],
	);
}

/**
 * Delete follow-ups whose purchase orders are no longer open in Zoho.
 *
 * `minIntervalMs` lets a page load trigger this cheaply: if a sweep started
 * recently, this one returns straight away without touching Zoho.
 */
export async function reconcileFollowups({ minIntervalMs = 0, trigger = 'manual' } = {}) {
	const gapSeconds = Math.max(minIntervalMs / 1000, MIN_GAP_SECONDS);

	const claimed = await queryOne(
		`UPDATE po_followup_reconcile
		    SET last_started_at = NOW()
		  WHERE id = 1
		    AND (last_started_at IS NULL
		         OR last_started_at < NOW() - make_interval(secs => $1::double precision))
		  RETURNING last_started_at`,
		[gapSeconds],
	);
	if (claimed === null) {
		return { ran: false, skipped: 'recent', trigger };
	}
	const startedAt = claimed.last_started_at;

	try {
		const tracked = await queryMany(
			`SELECT purchaseorder_id, purchaseorder_number FROM po_followups`,
		);
		if (tracked.length === 0) {
			const result = { ran: true, trigger, tracked: 0, deleted: 0, numbers: [] };
			await recordRun(result);
			return result;
		}

		const active = await listActivePurchaseOrderIds();
		if (!active.complete) {
			const result = {
				ran: true,
				trigger,
				skipped: 'incomplete',
				reason: active.reason,
				tracked: tracked.length,
				deleted: 0,
				numbers: [],
			};
			console.warn('[reconcile] active list incomplete, nothing deleted', result);
			await recordRun(result);
			return result;
		}

		const gone = tracked
			.filter((row) => !active.ids.has(String(row.purchaseorder_id)))
			.map((row) => row.purchaseorder_id);

		let removed = [];
		if (gone.length > 0) {
			// ON DELETE CASCADE takes each timeline with it. created_at guards
			// against a follow-up started after the list was read.
			removed = await queryMany(
				`DELETE FROM po_followups
				  WHERE purchaseorder_id = ANY($1::text[])
				    AND created_at < $2
				  RETURNING purchaseorder_id, purchaseorder_number`,
				[gone, startedAt],
			);
		}

		const result = {
			ran: true,
			trigger,
			active: active.ids.size,
			tracked: tracked.length,
			zohoCalls: active.calls,
			deleted: removed.length,
			numbers: removed.map((r) => r.purchaseorder_number ?? r.purchaseorder_id),
		};
		if (removed.length > 0) console.log('[reconcile] removed closed orders', result);
		await recordRun(result);
		return result;
	} catch (error) {
		await recordRun({ ran: true, trigger, error: error.message }).catch(() => {});
		throw error;
	}
}
