-- ============================================================================
-- 0009 — The chase runs itself, and a nudge is answered rather than dismissed
--
-- The follow-up layer could record that a call happened and that somebody
-- wanted to be reminded at a time they typed. The actual job is narrower and
-- harder: a vendor promises a dispatch date, the date arrives, and somebody has
-- to notice that nothing moved. Later the goods are dispatched and days pass
-- with nothing received, and somebody has to notice that too and start asking
-- for the LR.
--
-- Three things this adds.
--
--  1. A stage may chase on its own — `chase_after_days` with `chase_anchor`,
--     read as "nudge me if an order is still here N days after <anchor>". The
--     anchor is per stage and not a fallback, because an order that reaches
--     Dispatched still carries the vendor's last promise: a rule of "use the
--     promise if there is one" would date Dispatched's nudge from a day already
--     past and fire it immediately.
--
--  2. `promised_dispatch_date` is asked for again, and projected onto the order
--     so the due can be derived in one statement. 0007 retired it on the
--     grounds that a pipeline stage says where the chase stands — true, but the
--     stage cannot say *which day was promised*, and that is the fact the whole
--     loop turns on.
--
--  3. A nudge is a task with two exits rather than an alarm that rings once.
--     `resolution` on the event and `chase_resolved_at` on the order are how
--     "nothing more to chase until something changes" is recorded, which is
--     what makes it safe to keep nudging while neither exit has been taken.
--
-- `Dispatched` stops being the end of the chase here. 0004 seeded it terminal
-- and 0006 made that `outcome = 'won'`; LR awaited and Received now follow it,
-- and a stage carrying an outcome is never nudged — so left alone it would
-- configure cleanly in the editor and then silently never fire.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A stage may chase on its own
-- ---------------------------------------------------------------------------

ALTER TABLE po_followup_statuses
  ADD COLUMN IF NOT EXISTS chase_after_days INT,
  ADD COLUMN IF NOT EXISTS chase_anchor     TEXT NOT NULL DEFAULT 'stage',
  ADD COLUMN IF NOT EXISTS chase_note       TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followup_statuses_chase_anchor_known'
  ) THEN
    ALTER TABLE po_followup_statuses
      ADD CONSTRAINT po_followup_statuses_chase_anchor_known
      CHECK (chase_anchor IN ('promise', 'stage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followup_statuses_chase_sane'
  ) THEN
    ALTER TABLE po_followup_statuses
      ADD CONSTRAINT po_followup_statuses_chase_sane CHECK (
        (chase_after_days IS NULL OR chase_after_days BETWEEN 0 AND 365)
        -- A stage that ends the chase has nothing left to chase for.
        AND (chase_after_days IS NULL OR outcome IS NULL)
        AND (chase_note IS NULL OR length(chase_note) <= 160)
      );
  END IF;
END $$;

COMMENT ON COLUMN po_followup_statuses.chase_after_days IS
  'Nudge if an order is still in this stage this many days after chase_anchor. NULL means never.';
COMMENT ON COLUMN po_followup_statuses.chase_anchor IS
  'Where those days are counted from: the promised dispatch date (promise), or when the order entered this stage (stage).';
COMMENT ON COLUMN po_followup_statuses.chase_note IS
  'What the reminder should say, used verbatim. NULL falls back to wording the app composes.';

-- ---------------------------------------------------------------------------
-- What the order owes, projected onto the order
-- ---------------------------------------------------------------------------

-- The promise is recorded per call and the reminder is per order, so four
-- readers would each need the same lateral subquery. Projected instead, and
-- recomputed by shared/po/reminders.mjs alongside the due itself.
ALTER TABLE po_followups
  ADD COLUMN IF NOT EXISTS promised_dispatch_date DATE,
  ADD COLUMN IF NOT EXISTS status_since           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_followup_source   TEXT,
  ADD COLUMN IF NOT EXISTS chase_resolved_at      TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followups_next_source_known'
  ) THEN
    ALTER TABLE po_followups
      ADD CONSTRAINT po_followups_next_source_known
      CHECK (next_followup_source IS NULL OR next_followup_source IN ('event', 'stage'));
  END IF;
END $$;

-- Deliberately no constraint tying next_followup_source = 'event' to a non-null
-- next_followup_event_id. The self-referential FK added in 0004 is ON DELETE
-- SET NULL, so deleting the call that set a reminder would violate it inside
-- that very statement, before the recompute that repairs the row.

COMMENT ON COLUMN po_followups.promised_dispatch_date IS
  'The dispatch date the vendor last gave, from the most recent call that recorded one.';
COMMENT ON COLUMN po_followups.status_since IS
  'When the order entered its current stage. Not updated_at, which every call bumps whether or not it moved anything.';
COMMENT ON COLUMN po_followups.next_followup_source IS
  'Whether next_followup_at came from a reminder somebody set (event) or from the stage chasing on its own (stage).';
COMMENT ON COLUMN po_followups.chase_resolved_at IS
  'When somebody answered the nudge with "nothing more to chase". Cleared by any stage move or new promise, which re-arms the chase.';

-- ---------------------------------------------------------------------------
-- Answering a nudge
-- ---------------------------------------------------------------------------

ALTER TABLE po_followup_events
  ADD COLUMN IF NOT EXISTS resolution TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followup_events_resolution_known'
  ) THEN
    ALTER TABLE po_followup_events
      ADD CONSTRAINT po_followup_events_resolution_known
      CHECK (resolution IS NULL OR resolution IN ('resolved', 'rescheduled'));
  END IF;
END $$;

COMMENT ON COLUMN po_followup_events.resolution IS
  'On a response: whether the nudge was closed (resolved) or a new date was set (rescheduled).';

-- A response is its own kind. The timeline reads as one list either way, but a
-- call somebody chose to make and an answer to a nudge are different acts.
ALTER TABLE po_followup_events
  DROP CONSTRAINT IF EXISTS po_followup_events_kind_known;

ALTER TABLE po_followup_events
  ADD CONSTRAINT po_followup_events_kind_known
    CHECK (kind IN ('call', 'status_change', 'note', 'response'));

-- `outcome` comes back as "Call response" — what the vendor actually said. The
-- five codes 0007 fixed were right as far as they went; they were missing the
-- two commonest answers, one of which is not an answer at all.
ALTER TABLE po_followup_events
  DROP CONSTRAINT IF EXISTS po_followup_events_outcome_known;

ALTER TABLE po_followup_events
  ADD CONSTRAINT po_followup_events_outcome_known CHECK (outcome IN (
    'no_answer', 'goods_not_ready', 'production_delayed', 'dispatch_promised',
    'dispatched', 'lr_awaiting', 'lr_sent'
  ));

-- ---------------------------------------------------------------------------
-- The stages this flow actually has
--
-- Additively. The pipeline is configuration, and somebody who has already
-- renamed or deleted a stage meant it — so an edited pipeline keeps every row
-- exactly as it is and only gains the stages it is missing. The test for
-- "nobody has touched this" is that the live names are still precisely the six
-- 0004 seeded.
--
-- A rename cannot be told from a deletion plus an addition, so an edited
-- pipeline can end up with a stage that duplicates one in spirit — "Delayed"
-- beside somebody's "Vendor stalling". That is the price of never overwriting
-- what they chose, and Customize Pipeline is where they settle it. The same
-- goes for a curated "Dispatched" that is still marked won: this migration
-- leaves it won, and clearing that is a decision to make in Settings.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  untouched BOOLEAN;
BEGIN
  -- Compared as a set rather than as a sorted list. An ordered comparison would
  -- depend on the database collation, and under any locale-aware one
  -- "dispatched" sorts before "dispatch promised" — the space is ignored at the
  -- primary level — so a hardcoded list in C order silently never matches.
  SELECT COUNT(*) = 6
     AND COUNT(*) FILTER (WHERE lower(name) IN (
           'awaiting confirmation', 'cancelled by vendor', 'delayed',
           'dispatch promised', 'dispatched', 'to follow up'
         )) = 6
    INTO untouched
    FROM po_followup_statuses
   WHERE archived_at IS NULL;

  IF untouched THEN
    -- Renamed rather than replaced, so the id survives and every order sitting
    -- here, every timeline entry naming it and every edge 0004 drew from it
    -- follows the rename instead of being stranded.
    UPDATE po_followup_statuses
       SET name = 'Awaiting dispatch date', tone = 'slate', sort_order = 10,
           updated_at = NOW()
     WHERE lower(name) = 'to follow up';

    UPDATE po_followup_statuses SET sort_order = 15, updated_at = NOW()
     WHERE lower(name) = 'awaiting confirmation';

    UPDATE po_followup_statuses SET tone = 'amber', sort_order = 20, updated_at = NOW()
     WHERE lower(name) = 'dispatch promised';

    UPDATE po_followup_statuses SET tone = 'red', sort_order = 30, updated_at = NOW()
     WHERE lower(name) = 'delayed';

    -- Dispatched becomes a middle stage: the goods still have to arrive and the
    -- LR still has to come, so LR awaited and Received follow it. Its outcome
    -- has to go with that, because a stage carrying one is never nudged.
    --
    -- Only done here, on a pipeline nobody has touched. Clearing won from a
    -- stage somebody curated would rewrite what they decided the chase means,
    -- and that is their call to make in Settings, not this migration's.
    UPDATE po_followup_statuses
       SET tone = 'blue', sort_order = 40, outcome = NULL, is_terminal = FALSE,
           updated_at = NOW()
     WHERE lower(name) = 'dispatched';

    UPDATE po_followup_statuses SET sort_order = 70, updated_at = NOW()
     WHERE lower(name) = 'cancelled by vendor';
  END IF;

  -- Matched on lower(name) across archived rows too: a stage somebody archived
  -- was removed deliberately, and re-inserting a live twin of it is exactly the
  -- clobbering this block exists to avoid. Every row goes in with
  -- is_initial = FALSE, so po_followup_statuses_single_default cannot be
  -- tripped whichever branch ran.
  INSERT INTO po_followup_statuses
    (name, tone, sort_order, is_initial, is_terminal, outcome,
     chase_anchor, chase_after_days, chase_note)
  SELECT seed.name, seed.tone,
         CASE WHEN untouched THEN seed.sort_order
              ELSE COALESCE((SELECT MAX(sort_order) FROM po_followup_statuses), 0)
                   + seed.sort_order END,
         FALSE, seed.outcome IS NOT NULL, seed.outcome,
         seed.chase_anchor, seed.chase_after_days, seed.chase_note
    FROM (VALUES
      ('Awaiting dispatch date', 'slate',  10, NULL,
       'stage',   NULL, NULL),
      ('Dispatch promised',      'amber',  20, NULL,
       'promise', 0,    'The vendor promised dispatch for this date.'),
      ('Delayed',                'red',    30, NULL,
       'stage',   1,    'Delayed with no new date. Ask for one.'),
      ('Dispatched',             'blue',   40, NULL,
       'stage',   4,    'Dispatched, but nothing received yet. Ask for the LR.'),
      ('LR awaited',             'violet', 50, NULL,
       'stage',   2,    'Still waiting on the LR to trace the shipment.'),
      ('Received',               'green',  60, 'won',
       'stage',   NULL, NULL),
      ('Cancelled by vendor',    'slate',  70, 'lost',
       'stage',   NULL, NULL)
    ) AS seed(name, tone, sort_order, outcome,
              chase_anchor, chase_after_days, chase_note)
   WHERE NOT EXISTS (
     SELECT 1 FROM po_followup_statuses s WHERE lower(s.name) = lower(seed.name)
   );

  -- Give the chase defaults to stages that already existed under a name this
  -- flow knows. This runs in both branches, and it is not the clobbering the
  -- block above avoids: these three columns were added by this migration, so
  -- there is nothing of anybody's in them to overwrite. Without it the whole
  -- feature would sit inert on any pipeline that had ever been edited, since
  -- the insert skips a stage whose name is already taken.
  --
  -- Guarded on outcome IS NULL, which both respects po_followup_statuses_chase_sane
  -- and means a curated won/lost stage is left entirely alone.
  UPDATE po_followup_statuses s
     SET chase_anchor = seed.chase_anchor,
         chase_after_days = seed.chase_after_days,
         chase_note = seed.chase_note,
         updated_at = NOW()
    FROM (VALUES
      ('dispatch promised', 'promise', 0, 'The vendor promised dispatch for this date.'),
      ('delayed',           'stage',   1, 'Delayed with no new date. Ask for one.'),
      ('dispatched',        'stage',   4, 'Dispatched, but nothing received yet. Ask for the LR.'),
      ('lr awaited',        'stage',   2, 'Still waiting on the LR to trace the shipment.')
    ) AS seed(name, chase_anchor, chase_after_days, chase_note)
   WHERE lower(s.name) = seed.name
     AND s.archived_at IS NULL
     AND s.outcome IS NULL
     AND s.chase_after_days IS NULL;
END $$;

-- Joined by name the way 0004 does, so the edges land wherever the rows are,
-- and never deleted: narrowing the flow is what Allowed moves is for.
INSERT INTO po_followup_transitions (from_status_id, to_status_id)
SELECT f.id, t.id
  FROM (VALUES
    ('Awaiting dispatch date', 'Dispatch promised'),
    ('Awaiting dispatch date', 'Delayed'),
    ('Awaiting dispatch date', 'Cancelled by vendor'),
    ('Dispatch promised',      'Dispatched'),
    ('Dispatch promised',      'Delayed'),
    ('Dispatch promised',      'Cancelled by vendor'),
    ('Delayed',                'Dispatch promised'),
    ('Delayed',                'Dispatched'),
    ('Delayed',                'Cancelled by vendor'),
    ('Dispatched',             'LR awaited'),
    ('Dispatched',             'Received'),
    ('Dispatched',             'Delayed'),
    ('LR awaited',             'Received'),
    ('LR awaited',             'Delayed')
  ) AS e(from_name, to_name)
  JOIN po_followup_statuses f ON lower(f.name) = lower(e.from_name)
                            AND f.archived_at IS NULL
  JOIN po_followup_statuses t ON lower(t.name) = lower(e.to_name)
                            AND t.archived_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill the projections
-- ---------------------------------------------------------------------------

UPDATE po_followups f
   SET promised_dispatch_date = (
         SELECT e.promised_dispatch_date
           FROM po_followup_events e
          WHERE e.followup_id = f.id
            AND e.promised_dispatch_date IS NOT NULL
          ORDER BY e.occurred_at DESC, e.created_at DESC
          LIMIT 1),
       -- The best available guess at when it entered its stage: the move that
       -- put it there, else the last time anything touched the row.
       status_since = COALESCE(
         (SELECT MAX(e.occurred_at) FROM po_followup_events e
           WHERE e.followup_id = f.id AND e.to_status_id = f.status_id),
         f.updated_at,
         f.created_at)
 WHERE f.promised_dispatch_date IS NULL
   AND f.status_since IS NULL;

-- Every due that exists today was typed by somebody.
UPDATE po_followups
   SET next_followup_source = 'event'
 WHERE next_followup_at IS NOT NULL
   AND next_followup_source IS NULL;

-- ---------------------------------------------------------------------------
-- Seed the stage-derived dues, without a notification storm
--
-- Orders that have sat in Dispatched for a month all become due the moment this
-- lands, and the next fifteen-minute tick would send one enormous digest and a
-- push to match. Anything already past at migration time is therefore stamped
-- as notified: it shows red in the list and counts in the "follow-ups due"
-- metric, and simply never pushes for the historical backlog. A reminder that
-- is late is still visible; a batch of fifty teaches people to ignore the alert.
-- ---------------------------------------------------------------------------

UPDATE po_followups f
   SET next_followup_at = d.due,
       next_followup_source = 'stage',
       next_followup_event_id = NULL,
       notified_at = CASE WHEN d.due <= NOW() THEN NOW() ELSE NULL END
  FROM (
    SELECT f2.id,
           ((CASE
               WHEN s.chase_anchor = 'promise'
                AND f2.promised_dispatch_date IS NOT NULL
               THEN f2.promised_dispatch_date
               ELSE (f2.status_since AT TIME ZONE 'Asia/Kolkata')::date
             END + s.chase_after_days + TIME '10:00')
            AT TIME ZONE 'Asia/Kolkata') AS due
      FROM po_followups f2
      JOIN po_followup_statuses s ON s.id = f2.status_id
     WHERE s.chase_after_days IS NOT NULL
       AND s.outcome IS NULL
       AND f2.status_since IS NOT NULL
  ) d
 WHERE f.id = d.id
   -- A reminder somebody set themselves is not overwritten by a derived one
   -- that falls later.
   AND (f.next_followup_at IS NULL OR d.due < f.next_followup_at);
