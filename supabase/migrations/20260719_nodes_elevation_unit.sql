-- Elevation Unit Disambiguation — make the unit of nodes.elevation_m explicit.
--
-- THE AMBIGUITY: nodes stores elevation in a column named `elevation_m` ("meters"),
-- but every existing node's value is actually in FEET (e.g. birdnode11 sits at 6300 ft,
-- ~1920 m — NOT 6300 m). Nothing recorded the unit, so any consumer that trusts the
-- column name misreads the value. This bit the narrative pipeline directly: the insight
-- prompt was emitting "Elevation: 6300m" (near-Himalayan) instead of 6300 ft, which
-- distorts montane-species plausibility.
--
-- THE FIX (settled with Noah): an EXPLICIT unit column. Values are kept exactly
-- as-entered — we do NOT canonicalize to meters. 6300 stays 6300, now carrying an
-- attached unit of 'ft'. The unit column is the source of truth; the legacy `_m`
-- suffix on the value column is a naming wart left untouched here to avoid a risky,
-- unrequested production rename (every consumer already reads the value literally).
--
-- SCOPE: nodes only. mobile_detections (the listen-post side) carries no elevation
-- field — only habitat metadata — so there is nothing to disambiguate there. If an
-- elevation field is ever added to mobile_detections, give it the same treatment.
--
-- Existing nodes RLS policies are unaffected; the new column inherits them.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ── nodes.elevation_unit ─────────────────────────────────────────────────────
-- NOT NULL DEFAULT 'ft' backfills every existing row to 'ft' in place (they are all
-- feet) and makes 'ft' the default for new inserts, so a caller that omits the unit
-- still lands on the correct value for the current fleet. The CHECK rejects anything
-- outside the two supported units.
alter table public.nodes
  add column if not exists elevation_unit text not null default 'ft'
    check (elevation_unit in ('ft', 'm'));

comment on column public.nodes.elevation_unit is
  'Unit of elevation_m''s value: ''ft'' or ''m''. Values are stored as-entered and are '
  'NOT canonicalized — read this alongside elevation_m to render/interpret the elevation. '
  'All rows existing at migration 20260719 are feet.';
