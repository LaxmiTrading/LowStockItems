/**
 * The purchase-order follow-up API.
 *
 * Kept out of api.js, which is already auth and Zoho — a third domain in there
 * would make it the place every feature lands.
 */

import { api } from './api';

/* ------------------------------------------------------------ call fields */

// Stored as codes, which the server and a CHECK constraint both hold to this
// set. The labels live only here, so rewording one is not a migration.
export const CALL_OUTCOMES = [
	{ value: 'goods_not_ready', label: 'Goods Not Ready' },
	{ value: 'production_delayed', label: 'Production Delayed' },
	{ value: 'dispatch_promised', label: 'Dispatch Promised' },
	{ value: 'dispatched', label: 'Dispatched' },
	{ value: 'lr_awaiting', label: 'LR Awaiting' },
];

export const CALL_DIRECTIONS = [
	{ value: 'outbound', label: 'Outbound Call' },
	{ value: 'inbound', label: 'Inbound Call' },
];

export const outcomeLabel = (code) =>
	CALL_OUTCOMES.find((o) => o.value === code)?.label ?? null;

export const directionLabel = (code) =>
	CALL_DIRECTIONS.find((d) => d.value === code)?.label ?? null;

/* ----------------------------------------------------------- the workflow */

// The stages and their edges change about as often as somebody edits
// Settings, and every open panel needs them. Cached for the session and
// dropped whenever this module writes to it, so the editor still sees its own
// change immediately.
let workflowCache = null;
let workflowInFlight = null;

export function getWorkflow({ force = false } = {}) {
	if (force) {
		workflowCache = null;
		workflowInFlight = null;
	}
	if (workflowCache) return Promise.resolve(workflowCache);
	// De-duped, so several panels opening at once make one request.
	if (workflowInFlight) return workflowInFlight;

	workflowInFlight = api
		.get('/api/po/workflow')
		.then((data) => {
			workflowCache = data;
			return data;
		})
		.finally(() => {
			workflowInFlight = null;
		});

	return workflowInFlight;
}

export function invalidateWorkflow() {
	workflowCache = null;
	workflowInFlight = null;
}

/**
 * The stages reachable from where an order currently sits.
 *
 * An order with no stage yet may only enter at the default one. The server
 * enforces this too — this is what keeps a menu from offering a move it would
 * then refuse.
 */
export function reachableFrom(workflow, currentStatusId) {
	const live = (workflow?.statuses ?? []).filter((s) => !s.archived);
	if (!currentStatusId) return live.filter((s) => s.isInitial);

	const allowed = new Set(
		(workflow?.transitions ?? [])
			.filter((t) => t.fromStatusId === currentStatusId)
			.map((t) => t.toStatusId),
	);
	return live.filter((s) => allowed.has(s.id));
}

export function statusById(workflow, id) {
	if (!id) return null;
	return (workflow?.statuses ?? []).find((s) => s.id === id) ?? null;
}

/* ------------------------------------------------------ workflow editing */

export const createStatus = (payload) =>
	api.post('/api/po/workflow/statuses', payload).then(after);

export const updateStatus = (payload) =>
	api.put('/api/po/workflow/statuses', payload).then(after);

export const deleteStatus = (id) =>
	api
		.delete(`/api/po/workflow/statuses?id=${encodeURIComponent(id)}`)
		.then(after);

export const replaceTransitions = (edges) =>
	api.put('/api/po/workflow/transitions', { edges }).then(after);

/**
 * Save the whole pipeline — names, colours, order, default, won and lost — in
 * one request, the way the Customize Pipeline dialog edits it.
 */
export const savePipeline = (stages) =>
	api.put('/api/po/workflow/pipeline', { stages }).then(after);

// Every write above changes the workflow, so the cached copy is stale the
// moment one returns.
function after(data) {
	invalidateWorkflow();
	return data;
}

/* ----------------------------------------------------------- follow-ups */

export const listFollowups = () =>
	api.get('/api/po/followups').then((d) => d.followups ?? []);

export const followupDetail = (purchaseorderId) =>
	api.get(
		`/api/po/followups/detail?purchaseorderId=${encodeURIComponent(purchaseorderId)}`,
	);

export const setFollowupStatus = (payload) =>
	api.post('/api/po/followups/status', payload);

export const logCall = (payload) => api.post('/api/po/followups/calls', payload);

export const updateCall = (payload) => api.put('/api/po/followups/calls', payload);

export const deleteCall = (eventId) =>
	api.delete(
		`/api/po/followups/calls?eventId=${encodeURIComponent(eventId)}`,
	);

/**
 * Ask the server to forget follow-ups whose orders are no longer open. The
 * server reads Zoho itself and rate-limits the sweep, so this is safe to call
 * after every load.
 */
export const reconcileFollowups = () =>
	api.post('/api/po/followups/reconcile', {});

/* --------------------------------------------------------- push devices */

export const registerDevice = (token, userAgent) =>
	api.post('/api/push/devices', { token, userAgent });

export const unregisterDevice = (token) =>
	api.delete(`/api/push/devices?token=${encodeURIComponent(token)}`);
