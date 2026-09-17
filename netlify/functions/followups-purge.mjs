/**
 * The daily sweep that forgets purchase orders which are no longer open.
 *
 * The rule itself lives in ../shared/zoho/purchaseOrders.mjs, because the
 * Purchase Orders page triggers the same sweep after it loads. Follow-up
 * status never deletes anything — a stage marked won or lost is part of the
 * record. What removes a follow-up is its order leaving Zoho's open and draft
 * lists, which is what billing, closing or cancelling it does.
 *
 * This schedule is the backstop for days when nobody opens the page.
 *
 * Scheduled functions are still reachable at their URL and have no session to
 * check, so anything that is not Netlify's own scheduled invocation must
 * present CRON_SECRET, and gets a 404 otherwise.
 */

import { reconcileFollowups } from '../shared/zoho/purchaseOrders.mjs';

function authorised(request) {
	if (request.headers.get('x-netlify-event') === 'schedule') return true;
	const secret = process.env.CRON_SECRET;
	return Boolean(secret) && request.headers.get('x-cron-key') === secret;
}

export default async (request) => {
	if (!authorised(request)) return new Response('Not found', { status: 404 });

	try {
		const result = await reconcileFollowups({ minIntervalMs: 0, trigger: 'schedule' });
		console.log('[followups-purge]', result);
		return Response.json({ ok: true, data: result });
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
