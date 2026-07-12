-- Universal Range-Validity Gate v1 — place-keyed plausibility gate for ALL detections.
--
-- WHY: BirdNET posts species that are geographically impossible for a place. Casa Colibri
-- (a Colorado montane node) carries Rook ×106 (Eurasian corvid), Carrion Crow, European
-- Greenfinch, Pale-legged Leaf Warbler, and penguins turn up elsewhere — all range
-- false-positives, because nothing checks regional plausibility between inference and
-- publish. This adds that check as ONE universal, place-keyed primitive applied to both
-- the node path (`detections`) and the listen-post path (`mobile_detections`), keyed on
-- each place's coordinates + week — never a per-named-node allow-list. New nodes and listen
-- posts inherit it automatically the moment they have coordinates.
--
-- ARCHITECTURE (settled with Noah):
--   * The eBird-derived allowlist gate is the LOAD-BEARING primitive, applied unconditionally
--     on both paths. Range comes from STRUCTURED data (eBird / BirdNET meta-model), never the
--     LLM.
--   * Inference runs OUTSIDE this repo (Pi nodes write `detections`; a Fly.io worker fills
--     `mobile_detections`), so the gate is enforced HERE as BEFORE-write DB TRIGGERS on both
--     tables — the task's sanctioned "trigger or edge function" enforcement. BirdNET's native
--     lat/lon/week location filter (the first-line optimization) lives in that external
--     inference code and is a documented out-of-repo requirement, NOT implemented here.
--   * Failing detections are FLAGGED + QUARANTINED, raw kept — never hard-dropped. Parallels
--     the mobile_detections -> public_mobile_detections consent gate: the raw row survives;
--     only publish-eligibility changes.
--
-- SCOPE: `detections`, `mobile_detections`, `public_mobile_detections`, and the new
--   `range_allowlist` reference table. No narrative/pulse overlap. mobile_detections changes
--   never expose user_id (listeners.id = auth.users(id)).
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Location-cell + week helpers (the shared keying — builder and gate MUST agree)
-- ════════════════════════════════════════════════════════════════════════════

-- Coarsen a coordinate to a ~0.5° grid cell (≈ 55 km N/S; ≈ 43 km E/W at 39°N), a
-- resolution consistent with the 50 km neighborhood the eBird builder queries. The cell key
-- is the SW-corner bucket indices as "latIdx:lonIdx". IMMUTABLE so it can be used anywhere.
-- Both the allowlist builder and is_plausible() resolve the cell through THIS function, so
-- they can never drift.
create or replace function public.range_cell_key(p_lat double precision, p_lon double precision)
returns text
language sql
immutable
as $$
  select case
    when p_lat is null or p_lon is null then null
    else floor(p_lat / 0.5)::int || ':' || floor(p_lon / 0.5)::int
  end;
$$;

-- BirdNET-style 48-week number (4 weeks per month, clamped) from a timestamp. Defined now
-- for the FUTURE week-resolved builder; v1 stores week = 0 ("all weeks", see below), so the
-- gate is week-agnostic today and this helper is not yet on the hot path.
create or replace function public.range_week(p_ts timestamptz)
returns smallint
language sql
immutable
as $$
  select case when p_ts is null then null else
    ((extract(month from p_ts)::int - 1) * 4
      + least(ceil(extract(day from p_ts)::numeric / 7.0)::int, 4))::smallint
  end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. range_allowlist — cached plausible-species set per cell/week (ref layer)
-- ════════════════════════════════════════════════════════════════════════════
-- Follows the ref_species_traits precedent: anon-read reference data; writes ONLY through a
-- SECURITY DEFINER RPC granted to service_role from the start (never anon — we already carry
-- two anon->service_role hardening debts, don't add a third).
--
-- week semantics: 0 = "all weeks / not week-resolved" (v1 fill). 1..48 reserved for a future
-- week-resolved builder. is_plausible() matches week IN (0, <target>), so v1 rows (week 0)
-- satisfy any query week; a later week-resolved rebuild can tighten without a schema change.
create table if not exists public.range_allowlist (
  cell_key     text     not null,           -- range_cell_key(lat, lon)
  week         smallint not null default 0, -- 0 = all-weeks (v1); 1..48 = BirdNET week (future)
  species_id   uuid     not null references public.species(id) on delete cascade,
  source       text     not null,           -- e.g. 'ebird:obs_geo_recent'
  generated_at timestamptz not null default now(),
  primary key (cell_key, week, species_id)
);
create index if not exists range_allowlist_cell_idx on public.range_allowlist (cell_key, week);

alter table public.range_allowlist enable row level security;
create policy "range_allowlist public read" on public.range_allowlist
  for select to anon, authenticated using (true);

-- Sole-writer RPC: atomically REPLACE one cell/week's species set (delete-then-insert in a
-- single statement pair inside the function's implicit transaction). Idempotent rebuild —
-- exactly what the monthly "rebuild per active cell" cadence needs. service_role only.
create or replace function public.replace_range_cell(
  p_cell_key    text,
  p_week        smallint,
  p_species_ids uuid[],
  p_source      text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.range_allowlist where cell_key = p_cell_key and week = p_week;
  insert into public.range_allowlist (cell_key, week, species_id, source, generated_at)
  select p_cell_key, p_week, sid, p_source, now()
  from unnest(p_species_ids) as sid
  on conflict (cell_key, week, species_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.replace_range_cell(text, smallint, uuid[], text)
  from anon, authenticated, public;
grant execute on function public.replace_range_cell(text, smallint, uuid[], text)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. is_plausible() — the single gate both paths call
-- ════════════════════════════════════════════════════════════════════════════
-- Returns a TRI-STATE via a nullable boolean:
--   TRUE  -> species is in the cell's allowlist (plausible)
--   FALSE -> the cell HAS an allowlist but the species is absent (implausible -> quarantine)
--   NULL  -> indeterminate: species unknown, or NO allowlist exists for the cell yet
--            (fail-OPEN — we never quarantine on missing reference data; freshness/coverage
--            of the allowlist affects only what we can judge, never correctness).
-- SECURITY DEFINER so it reads the reference layer uniformly regardless of caller.
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
begin
  if p_species_id is null or v_cell is null then
    return null;                                   -- can't resolve -> indeterminate
  end if;
  if not exists (select 1 from public.range_allowlist where cell_key = v_cell) then
    return null;                                   -- no reference for this cell yet
  end if;
  return exists (
    select 1 from public.range_allowlist
    where cell_key = v_cell
      and species_id = p_species_id
      and week in (0, p_week)                      -- 0 = all-weeks (v1)
  );
end;
$$;
-- Callable by everyone (reads anon-readable reference data); it exposes no private data.
grant execute on function public.is_plausible(uuid, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- Map is_plausible's tri-state onto the range_status vocabulary. One place, both triggers.
create or replace function public.range_status_of(p_plausible boolean)
returns text
language sql
immutable
as $$
  select case
    when p_plausible is null then 'unchecked'
    when p_plausible then 'plausible'
    else 'quarantined'
  end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Quarantine flags on BOTH detection tables (raw never deleted; only status changes)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.detections
  add column if not exists range_status text not null default 'unchecked'
    check (range_status in ('unchecked', 'plausible', 'quarantined')),
  add column if not exists range_checked_at timestamptz;

alter table public.mobile_detections
  add column if not exists range_status text not null default 'unchecked'
    check (range_status in ('unchecked', 'plausible', 'quarantined')),
  add column if not exists range_checked_at timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Enforcement point A — node path (detections), BEFORE INSERT
-- ════════════════════════════════════════════════════════════════════════════
-- Fires AFTER auto_seed_species (trigger name sorts later: 'z…' > 'seed…'), so NEW.species_id
-- is already resolved. lat/lon come from the detection's own PostGIS point when present,
-- else the node's location. week from detected_at (v1 gate is week-agnostic; week=0 rows
-- satisfy it regardless).
create or replace function public.gate_detection_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lon double precision;
  v_plausible boolean;
begin
  -- Prefer the detection's own point; fall back to the owning node's location.
  if NEW.location is not null then
    v_lat := ST_Y(NEW.location::geometry);
    v_lon := ST_X(NEW.location::geometry);
  else
    select ST_Y(location::geometry), ST_X(location::geometry)
      into v_lat, v_lon
    from public.nodes where id = NEW.node_id;
  end if;

  v_plausible := is_plausible(NEW.species_id, v_lat, v_lon, range_week(NEW.detected_at)::int);
  NEW.range_status := range_status_of(v_plausible);
  NEW.range_checked_at := now();
  return NEW;
end;
$$;

-- 'zzz_' prefix guarantees this runs AFTER auto_seed_species (which sets NEW.species_id).
drop trigger if exists zzz_gate_detection_range on public.detections;
create trigger zzz_gate_detection_range
  before insert on public.detections
  for each row execute function public.gate_detection_range();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Enforcement point B — listen-post path (mobile_detections), BEFORE INSERT OR UPDATE
-- ════════════════════════════════════════════════════════════════════════════
-- The phone inserts a PENDING row with no species; the external worker later UPDATEs it with
-- the inferred `species` jsonb ([{common_name, scientific_name, confidence}, ...]) and
-- status='complete'. So the gate must (re)run when species is populated — hence BEFORE INSERT
-- OR UPDATE. We gate on the PRIMARY (highest-confidence) species — the headline detection the
-- feed shows and the map keys on — resolved to a species_id via scientific_name then
-- common_name. Empty/again-null species -> unchecked (fail-open).
create or replace function public.gate_mobile_detection_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary jsonb;
  v_species_id uuid;
  v_plausible boolean;
begin
  -- Highest-confidence element of the species array (worker sorts desc, but don't assume).
  select elem
    into v_primary
  from jsonb_array_elements(coalesce(NEW.species, '[]'::jsonb)) as elem
  order by coalesce((elem->>'confidence')::numeric, 0) desc
  limit 1;

  if v_primary is not null then
    select id into v_species_id from public.species
     where scientific_name = (v_primary->>'scientific_name')
     limit 1;
    if v_species_id is null then
      select id into v_species_id from public.species
       where common_name = (v_primary->>'common_name')
       limit 1;
    end if;
  end if;

  v_plausible := is_plausible(v_species_id, NEW.lat, NEW.lon, range_week(NEW.detected_at)::int);
  NEW.range_status := range_status_of(v_plausible);
  NEW.range_checked_at := now();
  return NEW;
end;
$$;

drop trigger if exists zzz_gate_mobile_detection_range on public.mobile_detections;
create trigger zzz_gate_mobile_detection_range
  before insert or update of species, lat, lon on public.mobile_detections
  for each row execute function public.gate_mobile_detection_range();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Public view — exclude quarantined listen posts, alongside the existing consent gate
-- ════════════════════════════════════════════════════════════════════════════
-- A quarantined listen post is withheld from the public map/feed EXACTLY like an
-- un-consented one: raw row survives, only publish-eligibility changes. Definer-rights view
-- (unchanged) still hides user_id / notes / audio / device_info and coarsens coords.
--
-- Full current column set preserved verbatim (later migrations added insight / listener_handle
-- via the listeners join / tz_offset); create-or-replace cannot drop columns. The ONLY change
-- is the appended `range_status <> 'quarantined'` clause on the existing consent filter.
create or replace view public.public_mobile_detections
  with (security_invoker = false) as
  select
    m.id,
    m.detected_at,
    round(m.lat::numeric, 3) as lat,
    round(m.lon::numeric, 3) as lon,
    m.species,
    m.habitat_type,
    m.canopy_cover,
    m.water_present,
    m.disturbance_level,
    m.insight,
    l.handle as listener_handle,
    (m.device_info ->> 'tz_offset')::integer as tz_offset
  from public.mobile_detections m
    left join public.listeners l on l.id = m.user_id
  where m.status = 'complete'
    and m.published = true
    and m.range_status <> 'quarantined';   -- unchecked + plausible publish; quarantined withheld

grant select on public.public_mobile_detections to anon, authenticated;
