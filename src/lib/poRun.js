// ─────────────────────────────────────────────────────────────────────────────
// The purchase-order list load, held outside React.
//
// Zoho's filter_by takes one status at a time, so listing the orders worth
// chasing means draining the paginated endpoint once per status, serialized to
// stay under the rate limit. On a busy month that is several seconds of work.
//
// Held in the page's own state it would be thrown away on every navigation and
// started again on return, so it lives here instead — the load carries on while
// you are elsewhere and coming back reattaches to it.
//
// In memory only: a page reload starts over.
// ─────────────────────────────────────────────────────────────────────────────

import { listPurchaseOrders } from '../components/ZohoAPI';
import { listFollowups } from './poFollowups';

const IDLE = {
	phase: 'idle', // idle | loading | done | error
	orders: [],
	// purchaseorder_id -> the follow-up row, for the list's status and due
	// columns. Kept beside the orders rather than fetched per row, and kept
	// here rather than in the page so a status set in the panel survives
	// navigating away and back.
	followups: {},
	loaded: 0,
	error: null,
	finishedAt: null,
};

let state = IDLE;
const listeners = new Set();
let running = false;
// Lets a load in flight be abandoned when a fresh one is asked for.
let token = 0;

function set(patch) {
	// A new object each change, the same object between them — which is what
	// useSyncExternalStore needs to avoid re-rendering forever.
	state = { ...state, ...patch };
	for (const fn of listeners) fn();
}

export function getState() {
	return state;
}

export function subscribe(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/**
 * Start a load, unless one is already running or has finished.
 *
 * `force` re-reads from Zoho — used by the page's refresh control, and after a
 * PO is created elsewhere in the app.
 */
export async function startLoad({ force = false } = {}) {
	if (running) return;
	if (!force && state.phase === 'done') return;

	running = true;
	const mine = ++token;

	set({ phase: 'loading', orders: [], loaded: 0, error: null });

	try {
		const orders = await listPurchaseOrders({
			onProgress: (partial) => {
				if (mine !== token) return;
				set({ orders: partial, loaded: partial.length });
			},
		});

		if (mine !== token) return;
		set({
			phase: 'done',
			orders,
			loaded: orders.length,
			finishedAt: Date.now(),
		});

		// After the orders, not with them: the list is useful without it, and a
		// follow-up service that is down must not empty the page. Hence the
		// swallowed failure — the status column simply stays blank.
		try {
			const rows = await listFollowups();
			if (mine !== token) return;
			set({ followups: Object.fromEntries(rows.map((r) => [r.purchaseorderId, r])) });
		} catch {
			/* the orders are still worth showing */
		}
	} catch (e) {
		if (mine === token) {
			set({
				phase: 'error',
				error: e.message || 'Could not load purchase orders.',
			});
		}
	} finally {
		if (mine === token) running = false;
	}
}

/**
 * Patch one order's follow-up after the panel has changed it.
 *
 * The alternative is re-reading every follow-up on each save, which is a
 * request the panel already has the answer to.
 */
export function applyFollowup(purchaseorderId, followup) {
	if (!purchaseorderId) return;
	const next = { ...state.followups };
	if (followup) next[purchaseorderId] = followup;
	else delete next[purchaseorderId];
	set({ followups: next });
}

/** Drop the cache so the next visit re-reads from Zoho. */
export function invalidate() {
	token++;
	running = false;
	state = IDLE;
	for (const fn of listeners) fn();
}
