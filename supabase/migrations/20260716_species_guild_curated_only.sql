-- EIA trait slice #1 — fix the species.guild projection (Option B).
--
-- 20260715's apply_species_trait projected species.guild = coalesce(p_guild, p_trophic_niche),
-- i.e. the AVONET diet label for uncurated birds. But species has a pre-existing CHECK
-- constraint (species_guild_check) restricting guild to the magora vocab, which the AVONET
-- Trophic.Niche terms (Invertivore/Vertivore/Aquatic predator/...) violate. Decision: keep
-- species.guild CURATED-ONLY (magora vocab), honest-NULL for uncurated birds and non-birds;
-- the AVONET axes already live in species.trophic_niche / primary_lifestyle (and
-- ref_species_traits). The constraint stays; no constraint change.
--
-- Function-body change only: CREATE OR REPLACE apply_species_trait with the species.guild
-- projection set to p_guild (no coalesce). All other projections and the signature are
-- unchanged. CREATE OR REPLACE preserves the service_role-only EXECUTE grant from 20260715;
-- re-asserted below for self-containment. Applied manually after review.

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

  -- Derived-cache projection. species.guild is CURATED-ONLY (magora vocab; NULL for
  -- uncurated — keeps species_guild_check intact). AVONET diet/stratum live in their own
  -- projected columns, not in guild.
  update public.species set
    guild             = p_guild,
    trophic_niche     = p_trophic_niche,
    primary_lifestyle = p_primary_lifestyle,
    migratory_status  = p_migratory_status,
    indicator_status  = p_indicator_status,
    sensitivity_flag  = p_sensitivity_flag
  where id = p_species_id;
end;
$$;

-- Keep the write path closed to service_role only (re-asserted; CREATE OR REPLACE preserves it).
revoke execute on function public.apply_species_trait(
  uuid, text, text, text, text, text, boolean, smallint, text, text, text
) from anon, authenticated, public;
grant execute on function public.apply_species_trait(
  uuid, text, text, text, text, text, boolean, smallint, text, text, text
) to service_role;
