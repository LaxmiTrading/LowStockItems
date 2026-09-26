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
//
// What the vendor said. Retired by 0007 in favour of the pipeline stage, and
// brought back by 0009 for the follow-up response form: the stage says where
// the chase stands, which is not the same as what was actually heard on the
// call, and "no answer" is not a stage at all.
export const CALL_OUTCOMES = [
	{ value: 'no_answer', label: 'No Answer / Will Call Back' },
	{ value: 'goods_not_ready', label: 'Goods Not Ready' },
	{ value: 'production_delayed', label: 'Production Delayed' },
	{ value: 'dispatch_promised', label: 'Dispatch Promised' },
	{ value: 'dispatched', label: 'Dispatched' },
	{ value: 'lr_awaiting', label: 'LR Not Sent Yet' },
	{ value: 'lr_sent', label: 'LR Sent' },
];

export const CALL_DIRECTIONS = [
	{ value: 'outbound', label: 'Outbound Call' },
	{ value: 'inbound', label: 'Inbound Call' },
];

// The two ways an open nudge stops being open.
export const RESOLUTIONS = [
	{
		value: 'resolved',
		label: 'Mark this follow-up as resolved',
		hint: 'Nothing more to chase until something changes.',
	},
	{
		value: 'rescheduled',
		label: 'Schedule a new follow-up',
		hint: 'Pick when to come back to this.',
	},
];

export const outcomeLabel = (code) =>
	CALL_OUTCOMES.find((o) => o.value === code)?.label ?? null;

export const directionLabel = (code) =>
	CALL_DIRECTIONS.find((d) => d.value === code)?.label ?? null;

export const resolutionLabel = (code) =>
	code === 'resolved' ? 'Resolved' : code === 'rescheduled' ? 'Rescheduled' : null;

/* ------------------------------------------------------------ date fields */

/**
 * `datetime-local` wants "YYYY-MM-DDTHH:mm" in *local* time, with no zone.
 * Built by hand rather than from toISOString, which converts to UTC and would
 * show an Indian user a time five and a half hours off.
 *
 * Here rather than in a form because both the call form and the response form
 * need them.
 */
export function toLocalInput(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}`
	);
}

// The inverse, and the only place a local value becomes an absolute instant.
// `new Date('2026-09-14T11:30')` is parsed as local time, which is what was
// meant, so toISOString then carries the right moment to the server.
export function toInstant(localValue) {
	if (!localValue) return null;
	const parsed = new Date(localValue);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * A promised dispatch date has **no conversion in either direction**.
 *
 * `<input type="date">` produces 'YYYY-MM-DD', the column is a bare DATE, and
 * the server hands back the same string. Putting one through a Date on the way
 * out is how a promise for the 18th arrives as the 17th, so there is
 * deliberately no `toPromiseDate` beside the two helpers above — the raw input
 * value is already what the server wants.
 */
export const isDateInput = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Midnight *local*, for comparing a bare date against today. */
export const asLocalDay = (ymd) =>
	ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00`) : null;

/**
 * Whether a promised date has gone by. Compared against the start of today, not
 * against the clock: a promise for today is not late at nine in the morning.
 */
export function isPastDay(ymd) {
	const day = asLocalDay(ymd);
	if (!day || Number.isNaN(day.getTime())) return false;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return day.getTime() < today.getTime();
}

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

/**
 * One line saying why this order is owed a call.
 *
 * A twin of `dueReason` in netlify/shared/po/dueMessage.mjs, which composes the
 * same sentence for the push and the email. That module is ESM under
 * netlify/shared and CRA cannot import out of src/, so the duplication is
 * unavoidable — change one and change the other, or the panel and the reminder
 * will say different things about the same order.
 *
 * Takes the followup row and the stage, because the client has both already and
 * the server flattens them onto one row.
 */
export function dueReason(followup, status) {
	if (!followup?.nextFollowupAt) return null;

	const derived = followup.nextFollowupSource === 'stage';
	if (derived && status?.chaseNote) return status.chaseNote;

	if (!derived) {
		return `${followup.vendorName ?? 'This vendor'} was due a call back.`;
	}

	if (status?.chaseAnchor === 'promise' && followup.promisedDispatchDate) {
		return `Dispatch was promised for ${fmtDay(followup.promisedDispatchDate)}.`;
	}

	if (followup.statusSince) {
		const days = Math.max(
			0,
			Math.floor(
				(new Date(followup.nextFollowupAt).getTime() -
					new Date(followup.statusSince).getTime()) /
					86_400_000,
			),
		);
		const stage = status?.name ?? 'this stage';
		return days === 0
			? `Still in ${stage}, with nothing new from the vendor.`
			: `In ${stage} for ${days} day${days === 1 ? '' : 's'} with no change.`;
	}

	return `${followup.vendorName ?? 'This vendor'} was due a call back.`;
}

/**
 * Whether the app is currently asking for something on this order.
 *
 * Due and in the past, whatever put it there — a reminder somebody set or a
 * stage that has waited long enough. This is what decides whether "Respond" is
 * offered ahead of "Log call": before the date arrives there is nothing to
 * answer, and a call made early is an ordinary call.
 */
export const isFollowupOwed = (followup) =>
	Boolean(followup?.nextFollowupAt) &&
	new Date(followup.nextFollowupAt).getTime() <= Date.now();

/** A bare date, shown without ever putting it through a timezone. */
export function fmtDay(ymd) {
	const day = asLocalDay(ymd);
	if (!day || Number.isNaN(day.getTime())) return null;
	return day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
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

/** Answer an open nudge: what the vendor said, and whether that settles it. */
export const respondToFollowup = (payload) =>
	api.post('/api/po/followups/respond', payload);

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
