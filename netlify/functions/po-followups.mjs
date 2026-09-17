/**
 * Purchase-order follow-up: the configurable status workflow, the per-order
 * state, and the vendor call log behind it.
 *
 * Same shape as auth.mjs — a literal route table matched by matchRoute inside
 * withErrorHandling, with every path repeated in `export const config`.
 *
 * matchRoute compares pathnames literally and takes no parameters, on purpose
 * (see the note on it in ../shared/http.mjs). So ids travel in the body on a
 * write and in the query string on a read or a delete; there is no
 * /api/po/followups/:id and there should not be one.
 */

import {
	jsonSuccess,
	matchRoute,
	readJson,
	requireString,
	withErrorHandling,
} from '../shared/http.mjs';
import { AppError, ValidationError } from '../shared/errors.mjs';
import { queryMany, queryOne, withTransaction } from '../shared/db.mjs';
import { requireAdministrator, requireUser } from '../shared/auth/session.mjs';
import { PIPELINE_TONES, savePipelineStages } from '../shared/po/pipeline.mjs';
import { reconcileFollowups } from '../shared/zoho/purchaseOrders.mjs';
import { markRemindersChanged } from '../shared/po/reminderGate.mjs';

/* ------------------------------------------------------------ validation */

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the CHECK on po_followups.purchaseorder_id. Checked here too so a
// bad id is a named 400 rather than a Postgres constraint violation surfacing
// as a 500.
const PO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Every colour the pipeline accepts; shared with the pipeline save.
const TONES = PIPELINE_TONES;

function uuidField(body, field, { required = true } = {}) {
	const value = body?.[field];
	if (value === undefined || value === null || value === '') {
		if (required) {
			throw new AppError('VALIDATION', `${field} is required.`, 400, { field });
		}
		return null;
	}
	if (typeof value !== 'string' || !UUID_RE.test(value)) {
		throw new AppError('VALIDATION', `${field} is not a valid id.`, 400, {
			field,
		});
	}
	return value;
}

function purchaseOrderId(body) {
	const value = requireString(body, 'purchaseorderId', { max: 64 });
	if (!PO_ID_RE.test(value)) {
		throw new AppError('VALIDATION', 'purchaseorderId is not valid.', 400, {
			field: 'purchaseorderId',
		});
	}
	return value;
}

/**
 * An absolute instant, as the browser sent it.
 *
 * The client converts its `datetime-local` value with `.toISOString()` before
 * sending, so what arrives is unambiguous and no timezone correction belongs
 * here. The lost-sale validator's "one day of future slack" hack exists
 * because those fields are bare calendar dates; these are instants and need
 * nothing of the kind.
 */
function instantField(body, field, { required = false } = {}) {
	const value = body?.[field];
	if (value === undefined || value === null || value === '') {
		if (required) {
			throw new AppError('VALIDATION', `${field} is required.`, 400, { field });
		}
		return null;
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new AppError('VALIDATION', `${field} is not a valid date and time.`, 400, {
			field,
		});
	}
	const year = parsed.getUTCFullYear();
	if (year < 2000 || year > 2100) {
		throw new AppError('VALIDATION', `${field} is out of range.`, 400, { field });
	}
	return parsed.toISOString();
}

// Mirror the CHECKs 0007 puts on po_followup_events, so a bad value is a
// named 400 rather than a constraint violation surfacing as a 500.
const CALL_OUTCOMES = [
	'goods_not_ready',
	'production_delayed',
	'dispatch_promised',
	'dispatched',
	'lr_awaiting',
];
const CALL_DIRECTIONS = ['inbound', 'outbound'];

/** One of a fixed set of codes, always required. */
function choiceField(body, field, allowed, message) {
	const value = body?.[field];
	if (!allowed.includes(value)) {
		throw new AppError('VALIDATION', message, 400, { field });
	}
	return value;
}

function optionalText(body, field, max) {
	const value = body?.[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') {
		throw new AppError('VALIDATION', `${field} must be text.`, 400, { field });
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > max) {
		throw new AppError('VALIDATION', `${field} is too long.`, 400, { field });
	}
	return trimmed;
}

function queryParam(request, name) {
	return new URL(request.url).searchParams.get(name);
}

/* ------------------------------------------------------------- workflow */

const statusRow = (r) => ({
	id: r.id,
	name: r.name,
	tone: r.tone,
	sortOrder: r.sort_order,
	isInitial: r.is_initial,
	isTerminal: r.is_terminal,
	outcome: r.outcome ?? null,
	archived: r.archived_at !== null,
});

async function readWorkflow() {
	const statuses = await queryMany(
		`SELECT id, name, tone, sort_order, is_initial, is_terminal, outcome, archived_at
		   FROM po_followup_statuses
		  ORDER BY archived_at NULLS FIRST, sort_order, name`,
	);
	const transitions = await queryMany(
		`SELECT from_status_id, to_status_id FROM po_followup_transitions`,
	);
	return {
		statuses: statuses.map(statusRow),
		transitions: transitions.map((t) => ({
			fromStatusId: t.from_status_id,
			toStatusId: t.to_status_id,
		})),
	};
}

async function getWorkflow(request) {
	await requireUser(request);
	return jsonSuccess(await readWorkflow(), request);
}

async function createStatus(request) {
	await requireAdministrator(request);
	const body = await readJson(request);

	const name = requireString(body, 'name', { max: 60 });
	const tone = body.tone ?? 'neutral';
	if (!TONES.has(tone)) {
		throw new ValidationError('That is not a known tone.', { field: 'tone' });
	}

	const duplicate = await queryOne(
		`SELECT id FROM po_followup_statuses
		  WHERE lower(name) = lower($1) AND archived_at IS NULL`,
		[name],
	);
	if (duplicate) {
		throw new ValidationError('A status with that name already exists.', {
			field: 'name',
		});
	}

	const created = await queryOne(
		`INSERT INTO po_followup_statuses (name, tone, sort_order, is_initial, is_terminal)
		 VALUES ($1, $2,
		   COALESCE((SELECT MAX(sort_order) + 10 FROM po_followup_statuses), 10),
		   $3, $4)
		 RETURNING id, name, tone, sort_order, is_initial, is_terminal, outcome, archived_at`,
		[name, tone, body.isInitial === true, body.isTerminal === true],
	);

	return jsonSuccess({ status: statusRow(created) }, request, { status: 201 });
}

async function updateStatus(request) {
	await requireAdministrator(request);
	const body = await readJson(request);
	const id = uuidField(body, 'id');

	const existing = await queryOne(
		`SELECT id FROM po_followup_statuses WHERE id = $1`,
		[id],
	);
	if (!existing) throw new AppError('NOT_FOUND', 'No such status.', 404);

	const name = body.name === undefined ? null : requireString(body, 'name', { max: 60 });
	if (name !== null) {
		const clash = await queryOne(
			`SELECT id FROM po_followup_statuses
			  WHERE lower(name) = lower($1) AND archived_at IS NULL AND id <> $2`,
			[name, id],
		);
		if (clash) {
			throw new ValidationError('A status with that name already exists.', {
				field: 'name',
			});
		}
	}

	if (body.tone !== undefined && !TONES.has(body.tone)) {
		throw new ValidationError('That is not a known tone.', { field: 'tone' });
	}
	if (
		body.sortOrder !== undefined &&
		!Number.isInteger(body.sortOrder)
	) {
		throw new ValidationError('sortOrder must be a whole number.', {
			field: 'sortOrder',
		});
	}

	// COALESCE so an omitted field keeps its current value rather than being
	// nulled — this endpoint is a patch, not a replace.
	const updated = await queryOne(
		`UPDATE po_followup_statuses
		    SET name        = COALESCE($2, name),
		        tone        = COALESCE($3, tone),
		        sort_order  = COALESCE($4, sort_order),
		        is_initial  = COALESCE($5, is_initial),
		        is_terminal = COALESCE($6, is_terminal),
		        updated_at  = NOW()
		  WHERE id = $1
		  RETURNING id, name, tone, sort_order, is_initial, is_terminal, outcome, archived_at`,
		[
			id,
			name,
			body.tone ?? null,
			body.sortOrder ?? null,
			body.isInitial === undefined ? null : body.isInitial === true,
			body.isTerminal === undefined ? null : body.isTerminal === true,
		],
	);

	return jsonSuccess({ status: statusRow(updated) }, request);
}

/**
 * Remove a status — really if nothing points at it, by archiving if something
 * does.
 *
 * Which of the two happens is decided by the database rather than by a count
 * this handler takes first and then races against: the delete is attempted,
 * and the ON DELETE RESTRICT on po_followups.status_id turns "still in use"
 * into a foreign-key violation we catch.
 */
async function deleteStatus(request) {
	await requireAdministrator(request);
	const id = queryParam(request, 'id');
	if (!id || !UUID_RE.test(id)) {
		throw new ValidationError('A status id is required.', { field: 'id' });
	}

	const status = await queryOne(
		`SELECT id, is_initial, archived_at FROM po_followup_statuses WHERE id = $1`,
		[id],
	);
	if (!status) throw new AppError('NOT_FOUND', 'No such status.', 404);

	// Two guards, so the workflow cannot be edited into something with no way
	// in and no way back short of SQL.
	const live = await queryOne(
		`SELECT COUNT(*)::int AS total,
		        COUNT(*) FILTER (WHERE is_initial)::int AS initial
		   FROM po_followup_statuses
		  WHERE archived_at IS NULL AND id <> $1`,
		[id],
	);
	if (status.archived_at === null && live.total === 0) {
		throw new ValidationError('At least one status has to remain.');
	}
	if (status.archived_at === null && status.is_initial && live.initial === 0) {
		throw new ValidationError(
			'This is the only status a purchase order can start at. Mark another as a starting status first.',
		);
	}

	const inUse = await queryOne(
		`SELECT COUNT(*)::int AS n FROM po_followups WHERE status_id = $1`,
		[id],
	);

	// Try the real delete first, in a transaction of its own. A failed
	// statement poisons the whole transaction in Postgres, so the archive
	// cannot be a fallback inside this one — it needs a fresh transaction
	// after this has rolled back.
	try {
		await withTransaction((run) =>
			run(`DELETE FROM po_followup_statuses WHERE id = $1`, [id]),
		);
		return jsonSuccess({ deleted: true, archived: false, inUseOn: 0 }, request);
	} catch (error) {
		// 23503 = foreign_key_violation: an order or a timeline entry still
		// points here, and that history is what keeps the status alive.
		if (String(error?.code) !== '23503') throw error;
	}

	await withTransaction(async (run) => {
		await run(
			`UPDATE po_followup_statuses SET archived_at = NOW(), updated_at = NOW()
			  WHERE id = $1 AND archived_at IS NULL`,
			[id],
		);
		// Edges are configuration with no historical value, and leaving them
		// would keep offering a move to a status no longer on offer.
		await run(
			`DELETE FROM po_followup_transitions
			  WHERE from_status_id = $1 OR to_status_id = $1`,
			[id],
		);
	});

	return jsonSuccess(
		{ deleted: false, archived: true, inUseOn: inUse.n },
		request,
	);
}

/**
 * Replace the whole transition graph in one statement pair.
 *
 * Whole-graph rather than per-edge because the editor is a checkbox matrix:
 * one save is one request, and closing the tab half-way through cannot leave
 * the flow partly rewired.
 */
async function replaceTransitions(request) {
	await requireAdministrator(request);
	const body = await readJson(request);

	const edges = body.edges;
	if (!Array.isArray(edges)) {
		throw new ValidationError('edges must be a list.', { field: 'edges' });
	}
	if (edges.length > 2000) {
		throw new ValidationError('That is too many transitions.', {
			field: 'edges',
		});
	}

	const cleaned = edges.map((edge, i) => {
		const from = uuidField(edge, 'fromStatusId');
		const to = uuidField(edge, 'toStatusId');
		if (from === to) {
			throw new ValidationError(
				`Transition ${i + 1} goes from a status to itself.`,
			);
		}
		return [from, to];
	});

	const ids = [...new Set(cleaned.flat())];
	if (ids.length > 0) {
		const live = await queryMany(
			`SELECT id FROM po_followup_statuses
			  WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
			[ids],
		);
		if (live.length !== ids.length) {
			throw new ValidationError(
				'A transition names a status that no longer exists.',
			);
		}
	}

	await withTransaction(async (run) => {
		await run(`DELETE FROM po_followup_transitions`);
		for (const [from, to] of cleaned) {
			await run(
				`INSERT INTO po_followup_transitions (from_status_id, to_status_id)
				 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				[from, to],
			);
		}
	});

	return jsonSuccess(await readWorkflow(), request);
}

/* ------------------------------------------------------------ follow-ups */

const followupRow = (r) => ({
	purchaseorderId: r.purchaseorder_id,
	purchaseorderNumber: r.purchaseorder_number,
	vendorId: r.vendor_id,
	vendorName: r.vendor_name,
	statusId: r.status_id,
	statusName: r.status_name ?? null,
	statusTone: r.status_tone ?? null,
	statusArchived: r.status_archived ?? false,
	nextFollowupAt: r.next_followup_at,
	notifiedAt: r.notified_at,
	lastEventAt: r.last_event_at ?? null,
	eventCount: r.event_count ?? 0,
	updatedAt: r.updated_at,
});

const FOLLOWUP_SELECT = `
	SELECT f.purchaseorder_id, f.purchaseorder_number, f.vendor_id, f.vendor_name,
	       f.status_id, f.next_followup_at, f.notified_at, f.updated_at,
	       s.name AS status_name, s.tone AS status_tone,
	       (s.archived_at IS NOT NULL) AS status_archived,
	       e.last_event_at, e.event_count
	  FROM po_followups f
	  LEFT JOIN po_followup_statuses s ON s.id = f.status_id
	  LEFT JOIN LATERAL (
	    SELECT MAX(occurred_at) AS last_event_at, COUNT(*)::int AS event_count
	      FROM po_followup_events WHERE followup_id = f.id
	  ) e ON TRUE`;

/**
 * Every tracked order in one call.
 *
 * Unfiltered on purpose: a row exists only once somebody has chased that
 * order, so this is small, and asking for a few hundred ids in a query string
 * would be both slower and longer than any URL should be.
 */
async function listFollowups(request) {
	await requireUser(request);
	const rows = await queryMany(`${FOLLOWUP_SELECT} ORDER BY f.updated_at DESC`);
	return jsonSuccess({ followups: rows.map(followupRow) }, request);
}

const eventRow = (r) => ({
	id: r.id,
	kind: r.kind,
	occurredAt: r.occurred_at,
	outcome: r.outcome,
	direction: r.direction,
	details: r.details,
	conclusion: r.conclusion,
	promisedDispatchDate: r.promised_dispatch_date,
	promisedReadyDate: r.promised_ready_date,
	needsFollowup: r.needs_followup,
	nextFollowupAt: r.next_followup_at,
	fromStatusId: r.from_status_id,
	fromStatusName: r.from_status_name,
	toStatusId: r.to_status_id,
	toStatusName: r.to_status_name,
	forced: r.forced,
	createdById: r.created_by,
	createdByName: r.created_by_name,
	createdAt: r.created_at,
});

async function followupDetail(request) {
	await requireUser(request);
	const poId = queryParam(request, 'purchaseorderId');
	if (!poId || !PO_ID_RE.test(poId)) {
		throw new ValidationError('A purchase order id is required.', {
			field: 'purchaseorderId',
		});
	}

	const followup = await queryOne(
		`${FOLLOWUP_SELECT} WHERE f.purchaseorder_id = $1`,
		[poId],
	);

	// Not an error: an order nobody has chased yet simply has no row, and the
	// panel opens on an empty timeline rather than a 404.
	if (!followup) {
		return jsonSuccess({ followup: null, events: [] }, request);
	}

	const events = await queryMany(
		`SELECT e.*,
		        fs.name AS from_status_name, ts.name AS to_status_name,
		        p.display_name AS created_by_name
		   FROM po_followup_events e
		   JOIN po_followups f ON f.id = e.followup_id
		   LEFT JOIN po_followup_statuses fs ON fs.id = e.from_status_id
		   LEFT JOIN po_followup_statuses ts ON ts.id = e.to_status_id
		   LEFT JOIN profiles p ON p.id = e.created_by
		  WHERE f.purchaseorder_id = $1
		  ORDER BY e.occurred_at DESC, e.created_at DESC`,
		[poId],
	);

	return jsonSuccess(
		{ followup: followupRow(followup), events: events.map(eventRow) },
		request,
	);
}

/** Create the order's row if this is the first time anyone has touched it. */
async function upsertFollowup(run, body, actorId) {
	const row = await run(
		`INSERT INTO po_followups
		   (purchaseorder_id, purchaseorder_number, vendor_id, vendor_name,
		    created_by, updated_by)
		 VALUES ($1, $2, $3, $4, $5, $5)
		 ON CONFLICT (purchaseorder_id) DO UPDATE
		   SET purchaseorder_number = COALESCE(EXCLUDED.purchaseorder_number,
		                                       po_followups.purchaseorder_number),
		       vendor_id   = COALESCE(EXCLUDED.vendor_id, po_followups.vendor_id),
		       vendor_name = COALESCE(EXCLUDED.vendor_name, po_followups.vendor_name),
		       updated_by  = EXCLUDED.updated_by,
		       updated_at  = NOW()
		 RETURNING id, status_id`,
		[
			body.purchaseorderId,
			optionalText(body, 'purchaseorderNumber', 64),
			optionalText(body, 'vendorId', 64),
			optionalText(body, 'vendorName', 200),
			actorId,
		],
	);
	return row.rows[0];
}

/**
 * Decide whether a move is allowed, and say why not when it is not.
 *
 * An order with no status yet may only enter at a status marked initial;
 * everything else needs an edge. An administrator may override either, which
 * is recorded on the event rather than hidden.
 */
async function checkTransition(run, currentStatusId, targetStatusId, actor, force) {
	const target = (
		await run(
			`SELECT id, name, archived_at FROM po_followup_statuses WHERE id = $1`,
			[targetStatusId],
		)
	).rows[0];

	if (!target) throw new AppError('NOT_FOUND', 'No such status.', 404);
	if (target.archived_at !== null) {
		throw new ValidationError('That status has been removed.');
	}

	const isAdmin = actor.role === 'administrator';
	if (force) {
		if (!isAdmin) {
			throw new AppError(
				'FORBIDDEN',
				'Only an administrator can override the follow-up flow.',
				403,
			);
		}
		return true;
	}

	if (currentStatusId === null) {
		const initial = (
			await run(
				`SELECT 1 FROM po_followup_statuses
				  WHERE id = $1 AND is_initial AND archived_at IS NULL`,
				[targetStatusId],
			)
		).rows[0];
		if (!initial) {
			throw new AppError(
				'ILLEGAL_TRANSITION',
				`A purchase order cannot start at "${target.name}".`,
				409,
			);
		}
		return false;
	}

	if (currentStatusId === targetStatusId) {
		throw new ValidationError('That is already the status.');
	}

	const edge = (
		await run(
			`SELECT 1 FROM po_followup_transitions
			  WHERE from_status_id = $1 AND to_status_id = $2`,
			[currentStatusId, targetStatusId],
		)
	).rows[0];

	if (!edge) {
		throw new AppError(
			'ILLEGAL_TRANSITION',
			`The follow-up flow does not allow a move to "${target.name}" from here.`,
			409,
		);
	}
	return false;
}

/**
 * Point the order at its soonest pending reminder.
 *
 * Denormalised onto the parent so the reminder sweep is one indexed read. The
 * notified_at reset is what lets a rescheduled follow-up fire again: without
 * it, moving a reminder forward would leave it already marked as sent.
 */
async function recomputeNextFollowup(run, followupId) {
	await run(
		`UPDATE po_followups f
		    SET next_followup_at = e.next_followup_at,
		        next_followup_event_id = e.id,
		        notified_at = CASE
		          WHEN e.next_followup_at IS DISTINCT FROM f.next_followup_at
		          THEN NULL ELSE f.notified_at END
		   FROM (
		     SELECT id, next_followup_at FROM po_followup_events
		      WHERE followup_id = $1 AND needs_followup
		      ORDER BY next_followup_at ASC LIMIT 1
		   ) e
		  WHERE f.id = $1`,
		[followupId],
	);

	// The subquery above yields no row when nothing is pending, and an UPDATE
	// ... FROM with no matching row updates nothing — so clearing is separate.
	await run(
		`UPDATE po_followups
		    SET next_followup_at = NULL, next_followup_event_id = NULL
		  WHERE id = $1
		    AND NOT EXISTS (
		      SELECT 1 FROM po_followup_events
		       WHERE followup_id = $1 AND needs_followup
		    )`,
		[followupId],
	);
}

async function readEventFields(body) {
	const needsFollowup = body.needsFollowup === true;
	return {
		occurredAt: instantField(body, 'occurredAt', { required: true }),
		outcome: choiceField(body, 'outcome', CALL_OUTCOMES, 'Pick the outcome of the call.'),
		direction: choiceField(
			body,
			'direction',
			CALL_DIRECTIONS,
			'Say whether this was an inbound or an outbound call.',
		),
		details: optionalText(body, 'details', 4000),
		needsFollowup,
		// Forced null when the toggle is off: the form hides the field rather
		// than clearing it, so a stale value would otherwise be saved.
		nextFollowupAt: needsFollowup
			? instantField(body, 'nextFollowupAt', { required: true })
			: null,
	};
}

function assertReminderInFuture(fields) {
	if (!fields.nextFollowupAt) return;
	// A small grace, because the form was filled in a minute ago and a reminder
	// a few seconds in the past is a typo, not a request to notify immediately.
	if (new Date(fields.nextFollowupAt).getTime() < Date.now() - 5 * 60_000) {
		throw new ValidationError('The next follow-up has already passed.', {
			field: 'nextFollowupAt',
		});
	}
}

async function logCall(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	body.purchaseorderId = purchaseOrderId(body);

	const fields = await readEventFields(body);
	assertReminderInFuture(fields);

	const targetStatusId = uuidField(body, 'statusId', { required: false });

	// Marked on both sides of the write: before, so a timeout between the
	// commit and the second mark cannot leave the sweep blind to this reminder;
	// after, so a sweep that read the gate mid-transaction cannot record a
	// "next due" that predates it.
	await markRemindersChanged();
	const result = await withTransaction(async (run) => {
		const followup = await upsertFollowup(run, body, actor.id);

		// Picking the status it is already on is not a move. Treating it as one
		// would write a timeline entry reading "from X to nothing".
		const moving =
			targetStatusId !== null && targetStatusId !== followup.status_id;

		let forced = false;
		if (moving) {
			forced = await checkTransition(
				run,
				followup.status_id,
				targetStatusId,
				actor,
				body.force === true,
			);
		}

		const event = (
			await run(
				`INSERT INTO po_followup_events
				   (followup_id, kind, occurred_at, outcome, direction, details,
				    needs_followup, next_followup_at,
				    from_status_id, to_status_id, forced, created_by)
				 VALUES ($1, 'call', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				 RETURNING id`,
				[
					followup.id,
					fields.occurredAt,
					fields.outcome,
					fields.direction,
					fields.details,
					fields.needsFollowup,
					fields.nextFollowupAt,
					moving ? followup.status_id : null,
					moving ? targetStatusId : null,
					forced,
					actor.id,
				],
			)
		).rows[0];

		if (moving) {
			await run(
				`UPDATE po_followups SET status_id = $2, updated_by = $3, updated_at = NOW()
				  WHERE id = $1`,
				[followup.id, targetStatusId, actor.id],
			);
		}

		await recomputeNextFollowup(run, followup.id);
		return { followupId: followup.id, eventId: event.id };
	});
	await markRemindersChanged();

	const fresh = await queryOne(
		`${FOLLOWUP_SELECT} WHERE f.purchaseorder_id = $1`,
		[body.purchaseorderId],
	);
	return jsonSuccess(
		{ followup: followupRow(fresh), eventId: result.eventId },
		request,
		{ status: 201 },
	);
}

/** A status move on its own, with no call behind it. */
async function setStatus(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	body.purchaseorderId = purchaseOrderId(body);
	const targetStatusId = uuidField(body, 'statusId');

	await withTransaction(async (run) => {
		const followup = await upsertFollowup(run, body, actor.id);

		if (followup.status_id === targetStatusId) {
			throw new ValidationError('That is already the status.');
		}

		const forced = await checkTransition(
			run,
			followup.status_id,
			targetStatusId,
			actor,
			body.force === true,
		);

		await run(
			`INSERT INTO po_followup_events
			   (followup_id, kind, occurred_at, conclusion,
			    from_status_id, to_status_id, forced, created_by)
			 VALUES ($1, 'status_change', NOW(), $2, $3, $4, $5, $6)`,
			[
				followup.id,
				optionalText(body, 'note', 2000),
				followup.status_id,
				targetStatusId,
				forced,
				actor.id,
			],
		);

		await run(
			`UPDATE po_followups SET status_id = $2, updated_by = $3, updated_at = NOW()
			  WHERE id = $1`,
			[followup.id, targetStatusId, actor.id],
		);
	});

	const fresh = await queryOne(
		`${FOLLOWUP_SELECT} WHERE f.purchaseorder_id = $1`,
		[body.purchaseorderId],
	);
	return jsonSuccess({ followup: followupRow(fresh) }, request);
}

async function updateCall(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	const eventId = uuidField(body, 'eventId');

	const existing = await queryOne(
		`SELECT e.id, e.followup_id, e.kind, e.created_by, f.purchaseorder_id
		   FROM po_followup_events e
		   JOIN po_followups f ON f.id = e.followup_id
		  WHERE e.id = $1`,
		[eventId],
	);
	if (!existing) throw new AppError('NOT_FOUND', 'No such call.', 404);
	if (existing.kind !== 'call') {
		throw new ValidationError('Only a logged call can be edited.');
	}
	assertMayEdit(existing, actor);

	const fields = await readEventFields(body);
	assertReminderInFuture(fields);

	await markRemindersChanged();
	await withTransaction(async (run) => {
		// The conclusion and promised dates of a call logged before 0007 are
		// left as they were: the form no longer shows them, so it cannot be
		// allowed to wipe them.
		await run(
			`UPDATE po_followup_events
			    SET occurred_at = $2, outcome = $3, direction = $4, details = $5,
			        needs_followup = $6, next_followup_at = $7
			  WHERE id = $1`,
			[
				eventId,
				fields.occurredAt,
				fields.outcome,
				fields.direction,
				fields.details,
				fields.needsFollowup,
				fields.nextFollowupAt,
			],
		);
		await recomputeNextFollowup(run, existing.followup_id);
	});
	await markRemindersChanged();

	const fresh = await queryOne(
		`${FOLLOWUP_SELECT} WHERE f.purchaseorder_id = $1`,
		[existing.purchaseorder_id],
	);
	return jsonSuccess({ followup: followupRow(fresh) }, request);
}

async function deleteCall(request) {
	const actor = await requireUser(request);
	const eventId = queryParam(request, 'eventId');
	if (!eventId || !UUID_RE.test(eventId)) {
		throw new ValidationError('A call id is required.', { field: 'eventId' });
	}

	const existing = await queryOne(
		`SELECT e.id, e.followup_id, e.created_by, f.purchaseorder_id
		   FROM po_followup_events e
		   JOIN po_followups f ON f.id = e.followup_id
		  WHERE e.id = $1`,
		[eventId],
	);
	if (!existing) throw new AppError('NOT_FOUND', 'No such call.', 404);
	assertMayEdit(existing, actor);

	await markRemindersChanged();
	await withTransaction(async (run) => {
		await run(`DELETE FROM po_followup_events WHERE id = $1`, [eventId]);
		await recomputeNextFollowup(run, existing.followup_id);
	});
	await markRemindersChanged();

	const fresh = await queryOne(
		`${FOLLOWUP_SELECT} WHERE f.purchaseorder_id = $1`,
		[existing.purchaseorder_id],
	);
	return jsonSuccess({ deleted: true, followup: followupRow(fresh) }, request);
}

// The timeline is a record of what happened, so it is not a free-for-all: the
// person who logged a call can correct it, and an administrator can fix
// anything. Nobody else rewrites someone else's account of a conversation.
function assertMayEdit(event, actor) {
	if (actor.role === 'administrator') return;
	if (event.created_by === actor.id) return;
	throw new AppError(
		'FORBIDDEN',
		'Only the person who logged this call, or an administrator, can change it.',
		403,
	);
}

/* ---------------------------------------------------------- push devices */

async function registerDevice(request) {
	const actor = await requireUser(request);
	const body = await readJson(request);
	const token = requireString(body, 'token', { max: 4096 });

	await queryOne(
		`INSERT INTO push_devices (profile_id, token, user_agent)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (token) DO UPDATE
		   SET profile_id = EXCLUDED.profile_id,
		       user_agent = EXCLUDED.user_agent,
		       last_seen_at = NOW()
		 RETURNING id`,
		[actor.id, token, optionalText(body, 'userAgent', 400)],
	);

	return jsonSuccess({ registered: true }, request, { status: 201 });
}

async function unregisterDevice(request) {
	const actor = await requireUser(request);
	const token = queryParam(request, 'token');
	if (!token) {
		throw new ValidationError('A device token is required.', {
			field: 'token',
		});
	}

	// Scoped to the actor so one account cannot unregister another's device.
	await queryOne(
		`DELETE FROM push_devices WHERE token = $1 AND profile_id = $2 RETURNING id`,
		[token, actor.id],
	);

	return jsonSuccess({ removed: true }, request);
}

/* --------------------------------------------------------- the pipeline */

/**
 * Save the whole pipeline in one request — names, colours, order, the
 * default stage and the won/lost outcomes — the way the Customize Pipeline
 * dialog edits it. The work is in ../shared/po/pipeline.mjs.
 */
async function savePipeline(request) {
	await requireAdministrator(request);
	const body = await readJson(request);
	const summary = await savePipelineStages(body.stages);
	return jsonSuccess({ ...(await readWorkflow()), ...summary }, request);
}

/**
 * Forget follow-ups whose purchase orders are no longer open in Zoho.
 *
 * Called by the Purchase Orders page after it loads. The server reads the
 * open list from Zoho itself rather than trusting the page, refuses to
 * delete on a partial fetch, and sweeps at most every ten minutes however
 * often it is asked.
 */
async function reconcile(request) {
	await requireUser(request);
	const result = await reconcileFollowups({ minIntervalMs: 10 * 60_000, trigger: 'page' });
	return jsonSuccess(result, request);
}

/* ------------------------------------------------------------------ route */

const routes = [
	{ method: 'GET', pattern: '/api/po/workflow', handler: getWorkflow },
	{ method: 'POST', pattern: '/api/po/workflow/statuses', handler: createStatus },
	{ method: 'PUT', pattern: '/api/po/workflow/statuses', handler: updateStatus },
	{ method: 'DELETE', pattern: '/api/po/workflow/statuses', handler: deleteStatus },
	{ method: 'PUT', pattern: '/api/po/workflow/transitions', handler: replaceTransitions },
	{ method: 'PUT', pattern: '/api/po/workflow/pipeline', handler: savePipeline },
	{ method: 'GET', pattern: '/api/po/followups', handler: listFollowups },
	{ method: 'GET', pattern: '/api/po/followups/detail', handler: followupDetail },
	{ method: 'POST', pattern: '/api/po/followups/status', handler: setStatus },
	{ method: 'POST', pattern: '/api/po/followups/calls', handler: logCall },
	{ method: 'PUT', pattern: '/api/po/followups/calls', handler: updateCall },
	{ method: 'DELETE', pattern: '/api/po/followups/calls', handler: deleteCall },
	{ method: 'POST', pattern: '/api/po/followups/reconcile', handler: reconcile },
	{ method: 'POST', pattern: '/api/push/devices', handler: registerDevice },
	{ method: 'DELETE', pattern: '/api/push/devices', handler: unregisterDevice },
];

export default withErrorHandling(async (request, context) => {
	const match = matchRoute(routes, request);
	if (match === null) {
		throw new AppError('NOT_FOUND', 'No such endpoint.', 404);
	}
	return match.handler(request, context);
});

export const config = {
	path: [
		'/api/po/workflow',
		'/api/po/workflow/statuses',
		'/api/po/workflow/transitions',
		'/api/po/workflow/pipeline',
		'/api/po/followups',
		'/api/po/followups/detail',
		'/api/po/followups/status',
		'/api/po/followups/calls',
		'/api/po/followups/reconcile',
		'/api/push/devices',
	],
};
