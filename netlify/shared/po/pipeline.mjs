/**
 * Saving the purchase-order pipeline as one edit.
 *
 * The Customize Pipeline dialog changes names, colours, order, the default
 * stage and the won/lost outcomes together, and only commits when Save is
 * pressed. Replaying that as a string of single-status requests would pass
 * through states the database refuses — two defaults at once, or two stages
 * briefly sharing a name during a swap — so it is applied here, in one
 * transaction, in an order that never trips a constraint.
 */

import { withTransaction } from '../db.mjs';
import { AppError, ValidationError } from '../errors.mjs';

/** Mirrors po_followup_statuses_tone_known (migration 0006). */
export const PIPELINE_TONES = new Set([
	'slate', 'red', 'orange', 'amber', 'yellow', 'green',
	'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink',
	// Accepted from before 0006.
	'neutral', 'brand', 'ok', 'warn', 'danger',
]);

const OUTCOMES = new Set(['won', 'lost']);
const MAX_STAGES = 50;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanStages(stages) {
	if (!Array.isArray(stages) || stages.length === 0) {
		throw new ValidationError('Keep at least one stage.', { field: 'stages' });
	}
	if (stages.length > MAX_STAGES) {
		throw new ValidationError('That is too many stages.', { field: 'stages' });
	}

	const seen = new Set();
	const cleaned = stages.map((stage, index) => {
		const name = typeof stage?.name === 'string' ? stage.name.trim() : '';
		if (!name) {
			throw new ValidationError(`Stage ${index + 1} needs a name.`, {
				field: 'name',
				index,
			});
		}
		if (name.length > 60) {
			throw new ValidationError(`"${name.slice(0, 20)}…" is too long.`, {
				field: 'name',
				index,
			});
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			throw new ValidationError(`"${name}" appears twice.`, {
				field: 'name',
				index,
			});
		}
		seen.add(key);

		const tone = stage.tone ?? 'slate';
		if (!PIPELINE_TONES.has(tone)) {
			throw new ValidationError(`"${name}" has a colour this app does not know.`, {
				field: 'tone',
				index,
			});
		}

		const outcome = stage.outcome ?? null;
		if (outcome !== null && !OUTCOMES.has(outcome)) {
			throw new ValidationError(`"${name}" has an unknown outcome.`, {
				field: 'outcome',
				index,
			});
		}

		const id = stage.id ?? null;
		if (id !== null && (typeof id !== 'string' || !UUID_RE.test(id))) {
			throw new ValidationError(`"${name}" has an invalid id.`, {
				field: 'id',
				index,
			});
		}

		return {
			id,
			name,
			tone,
			outcome,
			isDefault: stage.isDefault === true,
			sortOrder: (index + 1) * 10,
		};
	});

	const defaults = cleaned.filter((s) => s.isDefault);
	if (defaults.length !== 1) {
		throw new ValidationError(
			'Choose exactly one default stage — it is where every purchase order starts.',
			{ field: 'isDefault' },
		);
	}
	if (defaults[0].outcome !== null) {
		throw new ValidationError(
			'The default stage is where orders start, so it cannot also be won or lost.',
			{ field: 'outcome' },
		);
	}

	return cleaned;
}

/**
 * Apply the pipeline. Returns what was removed and how, because a removed
 * stage that orders still use is archived rather than deleted and the dialog
 * should say so.
 */
export async function savePipelineStages(stages) {
	const cleaned = cleanStages(stages);

	return withTransaction(async (run) => {
		// Locked, so two administrators saving at once apply one after the
		// other rather than interleaving.
		const live = (
			await run(
				`SELECT id, name FROM po_followup_statuses
				  WHERE archived_at IS NULL
				  FOR UPDATE`,
			)
		).rows;
		const liveIds = new Set(live.map((r) => r.id));

		for (const stage of cleaned) {
			if (stage.id !== null && !liveIds.has(stage.id)) {
				throw new AppError(
					'CONFLICT',
					`"${stage.name}" was removed while you were editing. Reopen the pipeline and try again.`,
					409,
				);
			}
		}

		// 1. Removals first, so a stage deleted and re-added under the same name
		//    in one save does not collide with itself.
		const keptIds = new Set(cleaned.filter((s) => s.id).map((s) => s.id));
		const archived = [];
		let deleted = 0;

		for (const gone of live.filter((r) => !keptIds.has(r.id))) {
			const { in_use: inUse } = (
				await run(
					`SELECT EXISTS (SELECT 1 FROM po_followups WHERE status_id = $1)
					     OR EXISTS (SELECT 1 FROM po_followup_events
					                 WHERE from_status_id = $1 OR to_status_id = $1)
					     AS in_use`,
					[gone.id],
				)
			).rows[0];

			if (inUse) {
				// Orders or their timelines still name it. Hidden from every
				// picker, kept so that history keeps reading correctly.
				await run(
					`UPDATE po_followup_statuses
					    SET archived_at = NOW(), is_initial = FALSE, updated_at = NOW()
					  WHERE id = $1`,
					[gone.id],
				);
				await run(
					`DELETE FROM po_followup_transitions
					  WHERE from_status_id = $1 OR to_status_id = $1`,
					[gone.id],
				);
				archived.push(gone.name);
			} else {
				await run(`DELETE FROM po_followup_statuses WHERE id = $1`, [gone.id]);
				deleted++;
			}
		}

		// 2. Clear the default, and park the kept names on their ids. Setting
		//    the real names afterwards means a swap (A→B, B→A) never has two
		//    live stages sharing a name, which the unique index would refuse.
		await run(
			`UPDATE po_followup_statuses SET is_initial = FALSE WHERE archived_at IS NULL`,
		);
		if (keptIds.size > 0) {
			await run(
				`UPDATE po_followup_statuses SET name = '~' || id::text
				  WHERE id = ANY($1::uuid[])`,
				[[...keptIds]],
			);
		}

		// 3. Write every stage in its new position.
		const added = [];
		for (const stage of cleaned) {
			if (stage.id !== null) {
				await run(
					`UPDATE po_followup_statuses
					    SET name = $2, tone = $3, sort_order = $4, is_initial = $5,
					        outcome = $6, is_terminal = ($6::text IS NOT NULL),
					        updated_at = NOW()
					  WHERE id = $1`,
					[stage.id, stage.name, stage.tone, stage.sortOrder, stage.isDefault, stage.outcome],
				);
			} else {
				const { id } = (
					await run(
						`INSERT INTO po_followup_statuses
						   (name, tone, sort_order, is_initial, outcome, is_terminal)
						 VALUES ($1, $2, $3, $4, $5, ($5::text IS NOT NULL))
						 RETURNING id`,
						[stage.name, stage.tone, stage.sortOrder, stage.isDefault, stage.outcome],
					)
				).rows[0];
				added.push({ id, outcome: stage.outcome });
			}
		}

		// 4. A new stage with no transitions would be unreachable, and "Add
		//    Stage" doing nothing visible is worse than a flow slightly too
		//    permissive. It can be reached from every open stage and, while it
		//    is open itself, move on to any other. Allowed moves narrows that.
		for (const stage of added) {
			await run(
				`INSERT INTO po_followup_transitions (from_status_id, to_status_id)
				 SELECT s.id, $1 FROM po_followup_statuses s
				  WHERE s.archived_at IS NULL AND s.id <> $1 AND s.outcome IS NULL
				 ON CONFLICT DO NOTHING`,
				[stage.id],
			);
			if (stage.outcome === null) {
				await run(
					`INSERT INTO po_followup_transitions (from_status_id, to_status_id)
					 SELECT $1, s.id FROM po_followup_statuses s
					  WHERE s.archived_at IS NULL AND s.id <> $1
					 ON CONFLICT DO NOTHING`,
					[stage.id],
				);
			}
		}

		return { archived, deleted, added: added.length };
	});
}
