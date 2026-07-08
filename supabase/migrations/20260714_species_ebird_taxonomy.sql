-- Prerequisite for EIA trait slice #1 (Species Guild/Diet Enrichment).
--
-- `species` has `ebird_code` / `family` / `order_name` columns that are 100% NULL, so the
-- planned `ref_species_traits` crosswalk (key on `ebird_code` ↔ AVONET eBird taxonomy) has
-- nothing to join on. This backfills eBird taxonomy onto `species` from the public eBird
-- taxonomy endpoint, matched by `scientific_name` (then `common_name` fallback), via the
-- ETL `scripts/backfill_ebird_taxonomy.mjs`.
--
-- Taxonomy fields only — the trait columns (guild / migratory_status / indicator_status /
-- sensitivity_flag) are NOT touched here. `species` is reference data; no person data.
-- `listeners.id = auth.users(id)`; `node_follows` never referenced. Net-new, separate from
-- the pulses / narrative-cache schema. Applied manually, reviewed first.

-- Writer RPC: SECURITY DEFINER so the ETL runs on the anon key (base table not
-- anon-writable), mirroring set_node_detection_insight / set_pulse_narrative. coalesce
-- keeps any existing value, so passing a NULL never clears a populated field (idempotent,
-- re-runnable — a later `species` add enriches on re-run without disturbing existing rows).
create or replace function public.set_species_taxonomy(
  p_id         uuid,
  p_ebird_code text,
  p_family     text,
  p_order_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.species
     set ebird_code = coalesce(p_ebird_code, ebird_code),
         family     = coalesce(p_family, family),
         order_name = coalesce(p_order_name, order_name)
   where id = p_id;
end;
$$;

grant execute on function public.set_species_taxonomy(uuid, text, text, text) to anon, authenticated;

create index if not exists species_ebird_code_idx on public.species (ebird_code);
