/**
 * When an order is next owed a call.
 *
 * Two independent things can owe one, and `po_followups.next_followup_at` is
 * the earlier of them:
 *
 *  · a reminder somebody set on a call — the "Next follow-up on" field;
 *  · the stage the order is sitting in, configured with "chase if still here
 *    N days after <anchor>".
 *
 * The stage's nudge is what makes the chase run itself. "If it has not reached
 * dispatched within four days" needs nothing watching it, because moving the
 * order recomputes from the new stage and the old nudge simply stops existing.
 *
 * Lives here rather than in po-followups.mjs because the pipeline editor needs
 * it too: chase days are configuration and the due they imply is stored, so
 * changing them has to re-date every order already sitting in that stage. It is
 * also the hardest statement in this codebase, and one copy of it is plenty.
 */

/**
 * Both anchors are pinned to 10:00 in Asia/Kolkata.
 *
 * `promised_dispatch_date` is a bare DATE, and casting one to timestamptz in a
 * function running in UTC gives midnight UTC — 05:30 IST, a push before dawn.
 * The stage anchor gets the same treatment for a different reason: it is a real
 * instant, so a stage entered at 23:10 would otherwise nudge at 23:10.
 */
const DUE_AT_IST = `+ TIME '10:00') AT TIME ZONE 'Asia/Kolkata'`;

/**
 * Point the order at its soonest reminder, from either source.
 *
 * **Call this last.** It reads the current transaction's state, so the new
 * status_id / status_since must already be written and the event already
 * inserted, updated or deleted before it runs.
 *
 * @param run  the transaction-scoped query function from withTransaction
 * @param followupId  po_followups.id
 */
export async function recomputeNextFollowup(run, followupId) {
	// The live promise is whatever the most recent call recorded, so deleting
	// that call takes the promise with it and the chase re-dates from the stage.
	await run(
		`UPDATE po_followups f
		    SET promised_dispatch_date = (
		          SELECT e.promised_dispatch_date
		            FROM po_followup_events e
		           WHERE e.followup_id = f.id
		             AND e.promised_dispatch_date IS NOT NULL
		           ORDER BY e.occurred_at DESC, e.created_at DESC
		           LIMIT 1)
		  WHERE f.id = $1`,
		[followupId],
	);

	await run(
		`WITH me AS (
		   SELECT id, status_id, promised_dispatch_date, status_since,
		          chase_resolved_at
		     FROM po_followups WHERE id = $1
		 ),
		 manual AS (
		   SELECT e.next_followup_at AS due, 'event'::text AS source, e.id AS event_id
		     FROM po_followup_events e
		    WHERE e.followup_id = $1 AND e.needs_followup
		    ORDER BY e.next_followup_at ASC
		    LIMIT 1
		 ),
		 derived AS (
		   SELECT ((CASE
		              WHEN s.chase_anchor = 'promise'
		               AND me.promised_dispatch_date IS NOT NULL
		              THEN me.promised_dispatch_date
		              ELSE (me.status_since AT TIME ZONE 'Asia/Kolkata')::date
		            END + s.chase_after_days ${DUE_AT_IST}) AS due,
		          'stage'::text AS source,
		          NULL::uuid AS event_id
		     FROM me
		     JOIN po_followup_statuses s ON s.id = me.status_id
		    WHERE s.chase_after_days IS NOT NULL
		      -- A stage that ends the chase has nothing left to chase for.
		      AND s.outcome IS NULL
		      -- Somebody answered the nudge with "nothing more to chase". Any
		      -- stage move or new promise clears this and re-arms it.
		      AND me.chase_resolved_at IS NULL
		      AND me.status_since IS NOT NULL
		 ),
		 pick AS (
		   SELECT * FROM (SELECT * FROM manual UNION ALL SELECT * FROM derived) c
		    -- A tie goes to the human's: it was asked for deliberately, and the
		    -- derived one would say less about why.
		    ORDER BY c.due ASC, (c.source = 'event') DESC
		    LIMIT 1
		 )
		 UPDATE po_followups f
		    SET next_followup_at       = p.due,
		        next_followup_source   = p.source,
		        next_followup_event_id = p.event_id,
		        -- What lets a rescheduled follow-up fire again: without it,
		        -- moving a reminder forward would leave it already marked sent.
		        notified_at = CASE
		          WHEN p.due IS DISTINCT FROM f.next_followup_at
		          THEN NULL ELSE f.notified_at END
		   FROM (
		     SELECT due, source, event_id FROM pick
		     UNION ALL
		     -- Nothing is owed. An UPDATE ... FROM whose source yields no row
		     -- updates nothing at all, so the empty case has to arrive as a row
		     -- of nulls rather than as an absence.
		     SELECT NULL::timestamptz, NULL::text, NULL::uuid
		      WHERE NOT EXISTS (SELECT 1 FROM pick)
		   ) p
		  WHERE f.id = $1`,
		[followupId],
	);
}

/**
 * Re-date every order whose stage chases, after the pipeline was edited.
 *
 * Scanning the whole table is fine: it holds only orders still open with a
 * vendor (§6.8 deletes the rest) and a pipeline save is rare.
 */
export async function recomputeAllStageFollowups(run) {
	const { rows } = await run(
		`SELECT id FROM po_followups
		  WHERE status_id IS NOT NULL AND status_since IS NOT NULL`,
	);
	for (const row of rows) await recomputeNextFollowup(run, row.id);
	return rows.length;
}
