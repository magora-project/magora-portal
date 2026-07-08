-- EIA trait slice #1 — ref_species_traits: cached, provenance-carrying bird trait layer.
--
-- AXIS SPLIT (revised): we do NOT derive a single blended guild for uncurated birds.
-- ref_species_traits stores AVONET's two NATIVE single-axis traits for every matched bird:
--   trophic_niche      (AVONET Trophic.Niche  — DIET: Omnivore/Invertivore/Granivore/...)
--   primary_lifestyle  (AVONET Primary.Lifestyle — foraging STRATUM: Insessorial/Aerial/...)
-- `guild` is CURATED-ONLY (the 72 gen_guild_sql.py rows override; NULL for uncurated /
-- non-birds). migratory_status / indicator_status / sensitivity_flag are curated-only too.
-- avonet_migration is stored RAW (1/2/3), never mapped onto migratory_status.
--
-- Projection onto species.* (derived cache; the ETL is the sole writer; the 5 live
-- consumers keep reading species.* unchanged — no reroute): species.trophic_niche /
-- primary_lifestyle mirror the axis traits, and species.guild = the curated guild where
-- present, else the AVONET trophic_niche as a grounded DIET label (never a guessed
-- stratum). trait_source / provenance stamp which. ref_species_traits is not exposed to
-- the client. Bird reference data only — no person data (listeners.id = auth.users(id);
-- node_follows never referenced). Net-new, separate from the pulses / narrative schema.
-- Applied manually after review.

create table if not exists public.ref_species_traits (
  species_id         uuid primary key references public.species(id) on delete cascade,
  guild              text,        -- CURATED-ONLY (magora vocab); NULL for uncurated
  trophic_niche      text,        -- AVONET Trophic.Niche (diet), all matched birds
  primary_lifestyle  text,        -- AVONET Primary.Lifestyle (foraging stratum), all matched birds
  migratory_status   text,        -- curated-only
  indicator_status   text,        -- curated-only
  sensitivity_flag   boolean,     -- curated-only
  avonet_migration   smallint,    -- raw AVONET Migration 1/2/3 (never mapped to migratory_status)
  avonet_family      text,        -- raw AVONET Family2
  trait_source       text not null,   -- 'curated' | 'AVONET' | 'unmatched'
  provenance         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists ref_species_traits_species_idx on public.ref_species_traits (species_id);
create index if not exists ref_species_traits_niche_idx   on public.ref_species_traits (trophic_niche);

alter table public.ref_species_traits enable row level security;
create policy "ref_species_traits public read" on public.ref_species_traits
  for select to anon, authenticated using (true);

-- Axis-trait columns on species for the derived-cache projection (display + consumers).
alter table public.species add column if not exists trophic_niche     text;
alter table public.species add column if not exists primary_lifestyle text;

-- Sole-writer RPC (SECURITY DEFINER; ETL runs on the anon key). Upserts the authoritative
-- ref_species_traits row AND projects onto species.*: guild = curated OR trophic_niche
-- (grounded diet label), plus the axis traits and curated regional fields. Idempotent.
create or replace function public.apply_species_trait(
  p_species_id        uuid,
  p_guild             text,     -- curated guild (magora vocab); NULL for uncurated
  p_trophic_niche     text,     -- AVONET diet
  p_primary_lifestyle text,     -- AVONET stratum
  p_migratory_status  text,     -- curated-only
  p_indicator_status  text,     -- curated-only
  p_sensitivity_flag  boolean,  -- curated-only
  p_avonet_migration  smallint,
  p_avonet_family     text,
  p_trait_source      text,
  p_provenance        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ref_species_traits (
    species_id, guild, trophic_niche, primary_lifestyle, migratory_status, indicator_status,
    sensitivity_flag, avonet_migration, avonet_family, trait_source, provenance, updated_at
  ) values (
    p_species_id, p_guild, p_trophic_niche, p_primary_lifestyle, p_migratory_status, p_indicator_status,
    p_sensitivity_flag, p_avonet_migration, p_avonet_family, p_trait_source, p_provenance, now()
  )
  on conflict (species_id) do update set
    guild             = excluded.guild,
    trophic_niche     = excluded.trophic_niche,
    primary_lifestyle = excluded.primary_lifestyle,
    migratory_status  = excluded.migratory_status,
    indicator_status  = excluded.indicator_status,
    sensitivity_flag  = excluded.sensitivity_flag,
    avonet_migration  = excluded.avonet_migration,
    avonet_family     = excluded.avonet_family,
    trait_source      = excluded.trait_source,
    provenance        = excluded.provenance,
    updated_at        = now();

  -- Derived-cache projection. species.guild = curated guild, else the AVONET diet label.
  update public.species set
    guild             = coalesce(p_guild, p_trophic_niche),
    trophic_niche     = p_trophic_niche,
    primary_lifestyle = p_primary_lifestyle,
    migratory_status  = p_migratory_status,
    indicator_status  = p_indicator_status,
    sensitivity_flag  = p_sensitivity_flag
  where id = p_species_id;
end;
$$;

-- apply_species_trait is an UNCONDITIONAL upsert (must stay so — re-runnable ETL), so it
-- cannot use the anon write-once model the set_*_insight RPCs rely on. Anon + unconditional
-- overwrite on the trait substrate would be a public corruption vector into data the agents
-- voice authoritatively (EIA §8). Close the caller to service_role only; the ETL runs with
-- the service role key. (The anon READ policy on ref_species_traits stays — CC-BY trait data.)
revoke execute on function public.apply_species_trait(
  uuid, text, text, text, text, text, boolean, smallint, text, text, text
) from anon, authenticated, public;
grant execute on function public.apply_species_trait(
  uuid, text, text, text, text, text, boolean, smallint, text, text, text
) to service_role;
