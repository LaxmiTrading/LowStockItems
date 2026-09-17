-- ============================================================================
-- 0006 — The pipeline as people edit it, and forgetting closed orders
--
-- The status editor now works like a sales pipeline: stages in order, each
-- with a colour, exactly one default where an order starts, and stages that
-- mark the chase as won or lost. Three things in the schema did not fit that:
--
--  · `tone` allowed five role names. A pipeline wants a colour per stage, so
--    the set widens to a palette. Still names, never hex — the frontend
--    decides what "teal" looks like in each theme.
--
--  · `is_terminal` said a stage ends the chase but not how. `outcome` records
--    won or lost; `is_terminal` is kept in step with it for existing readers.
--
--  · Several stages could be marked initial. A pipeline has one default, and
--    a partial unique index now holds the database to that.
--
-- And a place to remember when follow-ups were last reconciled against Zoho,
-- so a page load cannot trigger that sweep more than once every few minutes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Colours
-- ---------------------------------------------------------------------------

ALTER TABLE po_followup_statuses
  DROP CONSTRAINT IF EXISTS po_followup_statuses_tone_known;

ALTER TABLE po_followup_statuses
  ADD CONSTRAINT po_followup_statuses_tone_known CHECK (tone IN (
    'slate', 'red', 'orange', 'amber', 'yellow', 'green',
    'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink',
    -- The role names 0004 stored. Still accepted so nothing written before
    -- this migration becomes invalid; the data below moves them over.
    'neutral', 'brand', 'ok', 'warn', 'danger'
  ));

UPDATE po_followup_statuses
   SET tone = CASE tone
                WHEN 'neutral' THEN 'slate'
                WHEN 'brand'   THEN 'blue'
                WHEN 'ok'      THEN 'green'
                WHEN 'warn'    THEN 'amber'
                WHEN 'danger'  THEN 'red'
              END,
       updated_at = NOW()
 WHERE tone IN ('neutral', 'brand', 'ok', 'warn', 'danger');

-- ---------------------------------------------------------------------------
-- Won and lost
-- ---------------------------------------------------------------------------

ALTER TABLE po_followup_statuses
  ADD COLUMN IF NOT EXISTS outcome TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followup_statuses_outcome_known'
  ) THEN
    ALTER TABLE po_followup_statuses
      ADD CONSTRAINT po_followup_statuses_outcome_known
      CHECK (outcome IS NULL OR outcome IN ('won', 'lost'));
  END IF;
END $$;

-- Existing terminal stages have to become one or the other. A name that says
-- the order fell through is lost; anything else that ended the chase is won.
UPDATE po_followup_statuses
   SET outcome = CASE WHEN name ~* '(cancel|lost|reject|fell through)' THEN 'lost' ELSE 'won' END,
       updated_at = NOW()
 WHERE is_terminal AND outcome IS NULL;

COMMENT ON COLUMN po_followup_statuses.outcome IS
  'won or lost when this stage ends the chase, NULL while it is still open. is_terminal mirrors it.';

-- ---------------------------------------------------------------------------
-- One default
-- ---------------------------------------------------------------------------

-- Keep the earliest initial stage and clear the rest.
UPDATE po_followup_statuses s
   SET is_initial = FALSE, updated_at = NOW()
 WHERE s.is_initial
   AND s.archived_at IS NULL
   AND s.id <> (
     SELECT id FROM po_followup_statuses
      WHERE is_initial AND archived_at IS NULL
      ORDER BY sort_order, name
      LIMIT 1
   );

-- And if there was none, the first stage becomes the default.
UPDATE po_followup_statuses
   SET is_initial = TRUE, updated_at = NOW()
 WHERE id = (
     SELECT id FROM po_followup_statuses
      WHERE archived_at IS NULL
      ORDER BY sort_order, name
      LIMIT 1
   )
   AND NOT EXISTS (
     SELECT 1 FROM po_followup_statuses WHERE is_initial AND archived_at IS NULL
   );

-- An index on a constant, restricted to live default rows, can hold at most
-- one of them.
CREATE UNIQUE INDEX IF NOT EXISTS po_followup_statuses_single_default
  ON po_followup_statuses ((TRUE))
  WHERE is_initial AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Reconciling against Zoho
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_followup_reconcile (
  id               SMALLINT    PRIMARY KEY DEFAULT 1,

  -- Claimed atomically before a run starts, so two page loads or a page load
  -- and the daily schedule never sweep at the same time.
  last_started_at  TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,

  -- What the last run did, including which purchase-order numbers it removed.
  -- After a hard delete this is the only record that they existed.
  last_result      JSONB,

  CONSTRAINT po_followup_reconcile_single_row CHECK (id = 1)
);

INSERT INTO po_followup_reconcile (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE po_followup_reconcile IS
  'When follow-ups were last reconciled against the open purchase orders in Zoho, and what that removed.';
