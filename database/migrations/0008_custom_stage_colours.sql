-- ============================================================================
-- 0008 — A stage may have any colour, not only one of twelve
--
-- The pipeline editor now has a colour wheel beside the palette. A picked
-- colour is stored as a lowercase #rrggbb in the same `tone` column; the
-- palette names are still accepted, and every stage already saved keeps its
-- name.
--
-- 0004 kept hex out on the grounds that a stored colour would suit one theme
-- and not the other. That held while tones coloured whole pills. They no
-- longer do: since 0006 only a small dot carries the colour and the pill stays
-- on neutral theme tokens, so a custom dot reads in both themes much as a
-- palette dot does. Choosing one too dark for the dark theme, or too pale for
-- the light one, is the person's call.
-- ============================================================================

ALTER TABLE po_followup_statuses
  DROP CONSTRAINT IF EXISTS po_followup_statuses_tone_known;

ALTER TABLE po_followup_statuses
  ADD CONSTRAINT po_followup_statuses_tone_known CHECK (
    tone IN (
      'slate', 'red', 'orange', 'amber', 'yellow', 'green',
      'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink',
      'neutral', 'brand', 'ok', 'warn', 'danger'
    )
    OR tone ~ '^#[0-9a-f]{6}$'
  );

COMMENT ON COLUMN po_followup_statuses.tone IS
  'A palette name resolved in src/lib/tones.js, or a custom lowercase #rrggbb. Colours only the stage''s dot.';
