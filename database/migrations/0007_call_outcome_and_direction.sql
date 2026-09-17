-- ============================================================================
-- 0007 — A call's outcome is picked, not written, and has a direction
--
-- The call form asked for free text twice ("what was said", "conclusion") and
-- for two promised dates. In practice a vendor call ends in one of a handful
-- of states, and a list of those can be filtered and counted where prose
-- cannot. The form now records:
--
--  · `outcome`   — one of a fixed set, stored as a code. The labels live in the
--                  frontend, so rewording one is not a migration.
--  · `direction` — whether we rang them or they rang us.
--  · `details`   — unchanged column, now shown as "Notes".
--
-- `conclusion` and the promised dates are no longer written for calls, but are
-- kept: earlier calls still carry them and the timeline still shows them, and
-- a status move made on its own stores its note in `conclusion`.
--
-- Both new columns are nullable because calls logged before this have neither.
-- The endpoint requires them on every new or edited call.
-- ============================================================================

ALTER TABLE po_followup_events
  ADD COLUMN IF NOT EXISTS outcome   TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT;

ALTER TABLE po_followup_events
  DROP CONSTRAINT IF EXISTS po_followup_events_outcome_known;

ALTER TABLE po_followup_events
  ADD CONSTRAINT po_followup_events_outcome_known CHECK (outcome IN (
    'goods_not_ready', 'production_delayed', 'dispatch_promised',
    'dispatched', 'lr_awaiting'
  ));

ALTER TABLE po_followup_events
  DROP CONSTRAINT IF EXISTS po_followup_events_direction_known;

ALTER TABLE po_followup_events
  ADD CONSTRAINT po_followup_events_direction_known
    CHECK (direction IN ('inbound', 'outbound'));
