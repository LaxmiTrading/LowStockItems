/**
 * The purchase-order follow-up API.
 *
 * Kept out of api.js, which is already auth and Zoho — a third domain in there
 * would make it the place every feature lands.
 */

import { api } from './api';

/* ----------------------------------------------------------- the workflow */

// The status set and its edges change about as often as somebody edits
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
 * The statuses reachable from where an order currently sits.
 *
 * An order with no status yet may only enter at one marked initial. The server
 * enforces this too — this is what keeps the dropdown from offering a move it
 * would then refuse.
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

/* --------------------------------------------------------- push devices */

export const registerDevice = (token, userAgent) =>
	api.post('/api/push/devices', { token, userAgent });

export const unregisterDevice = (token) =>
	api.delete(`/api/push/devices?token=${encodeURIComponent(token)}`);
