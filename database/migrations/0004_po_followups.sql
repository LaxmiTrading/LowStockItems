-- ============================================================================
-- 0004 — Chasing vendors: purchase-order follow-up
--
-- Raising a purchase order is the easy half. The work that actually decides
-- whether stock arrives is the chasing afterwards: ringing the vendor, hearing
-- a dispatch promised for Thursday, and ringing again on Thursday when nothing
-- has moved. None of that was recorded anywhere, so what a vendor promised
-- lived in whoever made the call, and a follow-up happened when someone
-- remembered rather than when it was due.
--
-- These tables hold four things Zoho does not: where an order stands in our own
-- chase, which moves between those states are allowed, what was said on each
-- call, and when to ring next.
--
-- The status set is configuration, not code. Every business chases differently
-- and the vocabulary changes; making it a table means the workflow is edited in
-- Settings rather than in a migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The status set
--
-- Identified by a surrogate id rather than by name, because a rename must not
-- orphan the orders sitting on that status — and renames are the most likely
-- edit this table will ever see.
--
-- `tone` names a palette role, never a colour. src/index.css redefines every
-- --c-* triple for dark mode, so a stored hex would look correct in one theme
-- and wrong in the other.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_followup_statuses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  tone        TEXT        NOT NULL DEFAULT 'neutral',
  sort_order  INT         NOT NULL DEFAULT 0,

  -- Where a purchase order may enter the workflow. Entering anywhere else
  -- requires an existing status to move from.
  is_initial  BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Nothing follows this one; the order is done being chased.
  is_terminal BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Soft delete. A status assigned to an order in flight cannot simply be
  -- removed without stranding that order, so removing archives instead: it
  -- vanishes from every picker but still renders on the orders that hold it.
  archived_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT po_followup_statuses_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT po_followup_statuses_tone_known
    CHECK (tone IN ('neutral', 'brand', 'ok', 'warn', 'danger'))
);

-- Partial, so archiving "Delayed" does not block creating a new one later.
CREATE UNIQUE INDEX IF NOT EXISTS po_followup_statuses_name_lower_key
  ON po_followup_statuses (lower(name)) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS po_followup_statuses_live_idx
  ON po_followup_statuses (sort_order, name) WHERE archived_at IS NULL;

COMMENT ON TABLE po_followup_statuses IS
  'The configurable vendor-chase states, edited in Settings. Removal archives rather than deletes so orders in flight keep their status.';
COMMENT ON COLUMN po_followup_statuses.tone IS
  'A palette role (neutral/brand/ok/warn/danger), not a colour — the theme decides the actual value.';

-- ---------------------------------------------------------------------------
-- The allowed moves
--
-- A row here is permission to go from one status to another; the absence of a
-- row is what forbids it. Deliberately NOT enforced against po_followups: this
-- table is pure configuration, so rewiring the flow can never invalidate an
-- order that is already somewhere, and can never fail a later migration. The
-- graph is checked when a move is attempted and at no other time.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_followup_transitions (
  from_status_id UUID NOT NULL REFERENCES po_followup_statuses(id) ON DELETE CASCADE,
  to_status_id   UUID NOT NULL REFERENCES po_followup_statuses(id) ON DELETE CASCADE,

  PRIMARY KEY (from_status_id, to_status_id),

  CONSTRAINT po_followup_transitions_not_self
    CHECK (from_status_id <> to_status_id)
);

-- The Settings matrix needs the reverse direction as cheaply as the forward.
CREATE INDEX IF NOT EXISTS po_followup_transitions_to_idx
  ON po_followup_transitions (to_status_id);

COMMENT ON TABLE po_followup_transitions IS
  'Edges of the status flow: a row permits from -> to. Configuration only; checked on a move, never as a constraint on stored state.';

-- ---------------------------------------------------------------------------
-- Per-order state
--
-- Keyed by Zoho's own purchaseorder_id. That is a foreign key to a system this
-- database cannot see, so it cannot be enforced — which is exactly why the
-- number and vendor name are copied in beside it. The reminder job has no Zoho
-- session and no browser; being able to compose "PO-00565, Rupa & Company" from
-- one row is what keeps it from needing one.
--
-- A row appears the first time somebody touches an order. Orders nobody has
-- chased have no row at all.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_followups (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  purchaseorder_id     TEXT        NOT NULL UNIQUE,
  purchaseorder_number TEXT,
  vendor_id            TEXT,
  vendor_name          TEXT,

  -- Nullable: a call can be logged before anyone decides on a status.
  -- RESTRICT is the structural guarantee that a status in use cannot be hard
  -- deleted out from under an order — the delete fails loudly instead of
  -- quietly nulling this column.
  status_id            UUID        REFERENCES po_followup_statuses(id) ON DELETE RESTRICT,

  -- The soonest unfired follow-up across this order's calls, denormalised from
  -- po_followup_events so the reminder sweep is one indexed read rather than a
  -- per-order aggregate. Recomputed in the same transaction as every event
  -- write.
  next_followup_at     TIMESTAMPTZ,

  -- Stamped when a reminder for the current next_followup_at has been sent, so
  -- it fires once. Cleared whenever that timestamp moves.
  notified_at          TIMESTAMPTZ,

  -- Which call set the current reminder, so the timeline can point at it. The
  -- foreign key is added below, once po_followup_events exists.
  next_followup_event_id UUID,

  created_by           UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by           UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deliberately permissive: this exists to reject junk, not to encode an
  -- assumption about Zoho's id alphabet that a stricter pattern would turn
  -- into a total write outage on the day it changes.
  CONSTRAINT po_followups_po_id_shape
    CHECK (purchaseorder_id ~ '^[A-Za-z0-9_-]{1,64}$')
);

-- The reminder sweep's only index. Partial, so it holds the handful of rows
-- actually waiting rather than one entry per order ever tracked.
CREATE INDEX IF NOT EXISTS po_followups_due_idx
  ON po_followups (next_followup_at)
  WHERE next_followup_at IS NOT NULL AND notified_at IS NULL;

-- Answers "is this status still in use?" before an archive, and backs the
-- ON DELETE RESTRICT check above.
CREATE INDEX IF NOT EXISTS po_followups_status_idx
  ON po_followups (status_id) WHERE status_id IS NOT NULL;

COMMENT ON TABLE po_followups IS
  'One row per purchase order somebody is chasing. purchaseorder_id is Zoho''s id — an unenforceable foreign key, hence the copied number and vendor name.';
COMMENT ON COLUMN po_followups.next_followup_at IS
  'Denormalised soonest unfired reminder across this order''s calls. Recomputed with every event write; the reminder sweep reads only this.';

-- ---------------------------------------------------------------------------
-- The call log, which is also the timeline
--
-- Calls and status changes share a table because the timeline is one
-- chronological list. Splitting them would make every read a UNION with dummy
-- columns on both sides; `kind` costs a single CHECK instead.
--
-- occurred_at is one instant rather than a date column plus a time column:
-- ordering across a midnight boundary with two columns needs a composite sort
-- and breaks the moment one of them is null. The form splits it back into a
-- date and a time for display.
--
-- The promised dates stay DATE on purpose. "They said Thursday" has no time of
-- day, and storing it as an instant would let a timezone conversion move it to
-- Wednesday.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS po_followup_events (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id            UUID        NOT NULL REFERENCES po_followups(id) ON DELETE CASCADE,

  kind                   TEXT        NOT NULL DEFAULT 'call',
  occurred_at            TIMESTAMPTZ NOT NULL,

  -- What was discussed, and how it ended.
  details                TEXT,
  conclusion             TEXT,

  promised_dispatch_date DATE,
  promised_ready_date    DATE,

  -- The toggle on the form, and the one field that creates a reminder.
  needs_followup         BOOLEAN     NOT NULL DEFAULT FALSE,
  next_followup_at       TIMESTAMPTZ,

  -- A status move recorded alongside the call, so the timeline can show it
  -- without a second entry.
  from_status_id         UUID        REFERENCES po_followup_statuses(id) ON DELETE RESTRICT,
  to_status_id           UUID        REFERENCES po_followup_statuses(id) ON DELETE RESTRICT,

  -- An administrator moved the order along an edge the flow does not allow.
  -- Recorded rather than hidden, so the timeline stays an honest account.
  forced                 BOOLEAN     NOT NULL DEFAULT FALSE,

  created_by             UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT po_followup_events_kind_known
    CHECK (kind IN ('call', 'status_change', 'note')),

  -- The reminder toggle cannot be on without the date it needs.
  CONSTRAINT po_followup_events_followup_has_date
    CHECK (needs_followup = FALSE OR next_followup_at IS NOT NULL)
);

-- The timeline is the only way this table is ever read. created_at breaks the
-- tie when two calls are logged for the same minute.
CREATE INDEX IF NOT EXISTS po_followup_events_timeline_idx
  ON po_followup_events (followup_id, occurred_at DESC, created_at DESC);

-- Finding the soonest pending reminder for one order, during the recompute.
CREATE INDEX IF NOT EXISTS po_followup_events_pending_idx
  ON po_followup_events (followup_id, next_followup_at)
  WHERE needs_followup;

COMMENT ON TABLE po_followup_events IS
  'Vendor calls and status moves in one chronological log — the timeline shown against each purchase order.';

-- SET NULL because deleting the call that set a reminder should clear the
-- pointer, not take the order with it. Guarded so a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'po_followups_next_event_fk'
  ) THEN
    ALTER TABLE po_followups
      ADD CONSTRAINT po_followups_next_event_fk
      FOREIGN KEY (next_followup_event_id)
      REFERENCES po_followup_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Push registrations
--
-- token is globally unique rather than unique per profile. A shared terminal
-- where a second person signs in yields the same FCM token, and two rows for it
-- would mean two notifications on one device; the upsert re-points the existing
-- row instead. Disabling an account takes its devices with it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_devices (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token        TEXT        NOT NULL UNIQUE,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_devices_profile_idx
  ON push_devices (profile_id);

COMMENT ON TABLE push_devices IS
  'Firebase Cloud Messaging registration tokens. Pruned when Firebase reports one unregistered.';

-- ---------------------------------------------------------------------------
-- A workflow to start from
--
-- Seeded only when the table is empty, so a re-run is a no-op and an
-- administrator who has since deleted "Delayed" does not find it back.
-- ---------------------------------------------------------------------------

INSERT INTO po_followup_statuses (name, tone, sort_order, is_initial, is_terminal)
SELECT * FROM (VALUES
  ('To follow up',          'neutral', 10, TRUE,  FALSE),
  ('Awaiting confirmation', 'brand',   20, FALSE, FALSE),
  ('Dispatch promised',     'warn',    30, FALSE, FALSE),
  ('Delayed',               'danger',  40, FALSE, FALSE),
  ('Dispatched',            'ok',      50, FALSE, TRUE),
  ('Cancelled by vendor',   'neutral', 60, FALSE, TRUE)
) AS seed(name, tone, sort_order, is_initial, is_terminal)
WHERE NOT EXISTS (SELECT 1 FROM po_followup_statuses);

-- Joined by name rather than by hardcoded ids, so the edges land on whatever
-- the rows above were given.
INSERT INTO po_followup_transitions (from_status_id, to_status_id)
SELECT f.id, t.id
  FROM (VALUES
    ('To follow up',          'Awaiting confirmation'),
    ('To follow up',          'Dispatch promised'),
    ('To follow up',          'Cancelled by vendor'),
    ('Awaiting confirmation', 'Dispatch promised'),
    ('Awaiting confirmation', 'Delayed'),
    ('Awaiting confirmation', 'Cancelled by vendor'),
    ('Dispatch promised',     'Dispatched'),
    ('Dispatch promised',     'Delayed'),
    ('Dispatch promised',     'Cancelled by vendor'),
    ('Delayed',               'Dispatch promised'),
    ('Delayed',               'Dispatched'),
    ('Delayed',               'Cancelled by vendor')
  ) AS e(from_name, to_name)
  JOIN po_followup_statuses f ON f.name = e.from_name
  JOIN po_followup_statuses t ON t.name = e.to_name
ON CONFLICT DO NOTHING;
