-- Range-Gate Precision Fix v1 — stop the gate over-quarantining legitimate species.
--
-- WHY: the range gate (20260720) quarantines a resolved species that sits in a covered cell
-- but is absent from that cell's eBird-sourced allowlist. That over-fires in two ways, so the
-- flag can't yet be consumed (Part A stays reverted, backfill stays dry-run):
--   1. Species that CANNOT appear in an eBird allowlist at all — non-birds (katydids/insects
--      have no eBird range) and birds whose `ebird_code` is null/empty — were being quarantined
--      as "implausible" when they are really just "not eBird-judgeable" (indeterminate).
--   2. Genuine local birds lost to eBird taxonomy splits/lumps: their stored `ebird_code`
--      points at the wrong current taxon, so the allowlist builder never places them in the
--      cell allowlist and they quarantine. Verified against eBird near birdnode11 (cell 90:-222):
--        * Yellow Warbler stored as Setophaga petechia / `manwar1` — but `manwar1` is now
--          *Mangrove* Yellow Warbler; the widespread local bird is Northern Yellow Warbler
--          (`yelwar1`, S. aestiva).
--        * Warbling Vireo stored as Vireo gilvus / `eawvir1` (Eastern) — but the local bird is
--          Western Warbling Vireo (`wewvir2`, V. swainsoni) after the split.
--        * Cordilleran Flycatcher (Empidonax occidentalis) has no distinct eBird code (lumped
--          into Western Flycatcher `wesfly`); left null and handled by the fail-open rule below.
--
-- WHAT: (1) redefine is_plausible so a species with no valid `ebird_code` FAILS OPEN (null),
-- checked AFTER allowlist membership so a null-code bird that legitimately mapped into the
-- allowlist still returns true; (2) correct the two mis-mapped codes. The builder
-- (api/range-allowlist-build.js) is separately made split/lump-resilient and the allowlist
-- rebuilt, so these locals map in and return true.
--
-- Fail-open invariant preserved: only an eBird-judgeable species (valid ebird_code) in a
-- covered cell that is absent from the allowlist returns false. null and true never quarantine.
-- No grant changes. No rows deleted. Coverage guard, week=0 sentinel, cell key all unchanged.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ── is_plausible: add the null/empty-ebird_code fail-open, AFTER the allowlist hit ──────────
create or replace function public.is_plausible(
  p_species_id uuid,
  p_lat        double precision,
  p_lon        double precision,
  p_week       integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cell text := range_cell_key(p_lat, p_lon);
  v_code text;
begin
  if p_species_id is null or v_cell is null then
    return null;                                   -- can't resolve -> indeterminate
  end if;
  if not exists (select 1 from public.range_allowlist where cell_key = v_cell) then
    return null;                                   -- no reference for this cell yet (coverage)
  end if;
  -- Allowlist hit wins FIRST — a null-code bird that legitimately mapped in returns true, not null.
  if exists (
    select 1 from public.range_allowlist
    where cell_key = v_cell
      and species_id = p_species_id
      and week in (0, p_week)                      -- 0 = all-weeks (v1)
  ) then
    return true;
  end if;
  -- Not in the allowlist. Only a species eBird can actually judge (has a real ebird_code) may
  -- be called implausible; non-birds / null-or-empty-code species FAIL OPEN (indeterminate).
  select nullif(btrim(ebird_code), '') into v_code
  from public.species where id = p_species_id;
  if v_code is null then
    return null;
  end if;
  return false;
end;
$$;
-- Grants unchanged (create-or-replace preserves them); re-assert for clarity, no anon change.
grant execute on function public.is_plausible(uuid, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ── ebird_code corrections (taxonomy drift) — guarded by the known-wrong value = idempotent ──
-- Yellow Warbler: manwar1 (Mangrove) -> yelwar1 (Northern Yellow Warbler, the widespread bird).
update public.species set ebird_code = 'yelwar1'
  where common_name = 'Yellow Warbler' and ebird_code = 'manwar1';
-- Warbling Vireo: eawvir1 (Eastern) -> wewvir2 (Western Warbling Vireo, the local bird).
update public.species set ebird_code = 'wewvir2'
  where common_name = 'Warbling Vireo' and ebird_code = 'eawvir1';
-- Cordilleran Flycatcher stays NULL on purpose (genuinely lumped into Western Flycatcher);
-- the fail-open rule above + the builder's wesfly alias handle it (mapped -> true).
