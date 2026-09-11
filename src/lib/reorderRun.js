// ─────────────────────────────────────────────────────────────────────────────
// The reorder-suggestion run, held outside React.
//
// Computing costs one sales-report call per item, so a full pass takes minutes.
// If the run lived in the page's state it would be thrown away the moment you
// navigated elsewhere, and you would have to start again on return. Keeping it
// in a module-level store means the run carries on and the page simply
// reattaches to whatever it finds.
//
// Decisions live here too. Suggestions surviving a navigation while the
// approvals made against them did not would be worse than losing both.
//
// This is in memory, so a page reload does end a run — there is no server-side
// job to resume from.
// ─────────────────────────────────────────────────────────────────────────────

import { getAllItems, isInventoryItem } from '../components/ZohoAPI';
import { getSales, hasSales } from './salesCache';
import { listLostSales } from './lostSales';
import { computeSuggestion, DEFAULT_SETTINGS } from './reorderEngine';

const SALES_WINDOW_DAYS = 365;
const PACING_MS = 150;

const IDLE = {
	phase: 'idle', // idle | running | done | error
	progress: null, // { done, total }
	suggestions: null,
	status: {}, // item_id -> pending | approved | rejected
	error: null,
	scanned: 0,
	// What the candidate filter left out, so the page can say so. Excluding
	// silently is how a wrong field name looks exactly like "nothing to do".
	excluded: { nonInventory: 0 },
	finishedAt: null,
};

let state = IDLE;
const listeners = new Set();
let running = false;
// Lets a run in flight be abandoned when the user asks for a fresh one.
let runToken = 0;

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

export function isRunning() {
	return state.phase === 'running';
}

/** How far a suggestion moves things, for ordering the list. */
function magnitude(s) {
	const rop =
		s.proposed_rop == null ? 0 : Math.abs(s.proposed_rop - s.current_rop);
	const max =
		s.proposed_max == null ? 0 : Math.abs(s.proposed_max - s.current_max);
	return rop + max;
}

export async function startRun() {
	if (running) return;
	running = true;
	const token = ++runToken;

	set({
		phase: 'running',
		progress: { done: 0, total: 0 },
		suggestions: null,
		status: {},
		error: null,
		scanned: 0,
		finishedAt: null,
	});

	try {
		// Lost sales are the only evidence of demand that went unmet, and the
		// reason this can run at all before stock history exists. A failure here
		// is not fatal — it just means no correction is applied.
		const lostByItem = new Map();
		try {
			const lost = await listLostSales();
			// A record covers a whole visit, so the items it holds are what carry
			// the per-item signal. `count` stays a count of item lines — the number
			// of times this item was asked for and could not be supplied — rather
			// than of visits, which is what the engine's wording means by it.
			for (const r of lost) {
				for (const it of r.items || []) {
					if (!it.item_id) continue;
					const cur = lostByItem.get(it.item_id) || { units: 0, count: 0 };
					// Quantity is optional. A line without one still counts as a lost
					// sale but adds no units, so an unknown quantity never invents
					// demand — it only ever makes the correction more conservative.
					cur.units += Number(it.qty_wanted) || 0;
					cur.count += 1;
					lostByItem.set(it.item_id, cur);
				}
			}
		} catch {
			// Leave the map empty.
		}

		const items = await getAllItems();
		if (token !== runToken) return;

		// Only stock-tracked items can have a reorder point at all. A
		// sales-only or purchase-only item has no quantity to reason about, so a
		// proposal for one is noise — and it would still cost a sales-report
		// call to produce.
		const stockTracked = items.filter(isInventoryItem);

		// Then: only items that could produce a suggestion are worth a call. One
		// with neither a reorder point nor a max capacity has nothing to compare
		// a proposal against.
		const candidates = stockTracked.filter(
			(i) =>
				Number(i.reorder_level) > 0 ||
				Number(i.cf_maximum_capacity) > 0 ||
				lostByItem.has(i.item_id),
		);

		set({
			scanned: candidates.length,
			excluded: { nonInventory: items.length - stockTracked.length },
			progress: { done: 0, total: candidates.length },
		});

		const out = [];
		for (let i = 0; i < candidates.length; i++) {
			if (token !== runToken) return; // superseded by a newer run

			const item = candidates[i];
			const wasCached = hasSales(item.item_id, SALES_WINDOW_DAYS);
			const sold = await getSales(item.item_id, SALES_WINDOW_DAYS);
			const lost = lostByItem.get(item.item_id) || { units: 0, count: 0 };

			const suggestion = computeSuggestion(
				{
					item_id: item.item_id,
					item_name: item.name,
					current_rop: Number(item.reorder_level) || 0,
					current_max: Number(item.cf_maximum_capacity) || 0,
					sold,
					lost_units: lost.units,
					lost_sales_count: lost.count,
					// No nightly stock snapshot yet, so no censoring correction.
					days_in_stock: null,
					history_days: item.created_time
						? Math.floor(
								(Date.now() - new Date(item.created_time).getTime()) / 86400000,
							)
						: null,
					lead_time: null,
					order_cycle_days: null,
				},
				DEFAULT_SETTINGS,
			);

			if (suggestion) {
				out.push(suggestion);
				// Publish as they are found, ordered as they will finally appear, so
				// the list fills in while the run continues rather than staying blank.
				const sorted = [...out].sort((a, b) => magnitude(b) - magnitude(a));
				set({
					suggestions: sorted,
					status: {
						...state.status,
						[suggestion.item_id]: state.status[suggestion.item_id] ?? 'pending',
					},
				});
			}

			set({ progress: { done: i + 1, total: candidates.length } });
			// Pace only real requests; a cache hit costs the proxy nothing.
			if (!wasCached && i < candidates.length - 1) {
				await new Promise((r) => setTimeout(r, PACING_MS));
			}
		}

		if (token !== runToken) return;
		set({
			phase: 'done',
			suggestions: [...out].sort((a, b) => magnitude(b) - magnitude(a)),
			progress: null,
			finishedAt: Date.now(),
		});
	} catch (e) {
		if (token === runToken) {
			set({
				phase: 'error',
				error: e.message || 'Could not compute suggestions.',
				progress: null,
			});
		}
	} finally {
		if (token === runToken) running = false;
	}
}

export function setDecision(itemId, next) {
	set({ status: { ...state.status, [itemId]: next } });
}

export function setDecisions(patch) {
	set({ status: { ...state.status, ...patch } });
}
