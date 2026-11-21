-- Pre-history baseline (Spec 2 plan Task 12, spec §5.2): the `public` schema as it stood just before
-- 20260626, so a fresh database can replay every later migration in order. Production never applies
-- this file. Recording it in production's migration ledger belongs to Spec 2b; until then nothing
-- applies it to production, and it sorts before every existing file so that no one applying later
-- migrations by name picks it up by accident.
--
-- DERIVED, not recovered. Production's schema-only dump of `public` (pg_dump 17.10, 2026-11-21)
-- minus everything 20260626..20261106 creates, with what they alter or drop put back in its
-- earlier form:
--   * public.users, which 20260726 drops, and its policy "Service role full access users", which
--     20260725 alters. The table held 0 rows and nothing referenced it but nodes_owner_id_fkey
--     (20260726's pre-drop audit), so only its key column is reconstructed; its other columns are
--     unknown and nothing replays against them.
--   * nodes_owner_id_fkey references public.users(id) (20260705 repoints it at auth.users).
--   * detections.node_id and aci_logs.node_id are nullable, and their foreign keys are ON DELETE
--     CASCADE (20260727 sets NOT NULL and RESTRICT; its header records the CASCADE).
--   * The four "Service role full access" policies have no TO clause, so they apply to PUBLIC
--     (20260725 scopes them to service_role).
--   * Columns later files add are absent: nodes.species_whitelist, elevation_unit (and its check),
--     banner_path; detections.insight, insight_requested_at, range_status (and its check),
--     range_checked_at; species.trophic_niche, primary_lifestyle. nodes.last_seen_at stays:
--     20260717 adds it with IF NOT EXISTS, and production's column order shows it predates that file.
--
-- The proof (scripts/db/baseline-proof.mjs) applies this file and then every later migration to a
-- fresh local Supabase stack and compares the result with a production snapshot, under
-- supabase/migrations/checks/schema-allowlist.txt, which may name no object in `public`.
--
-- Rolling this back means dropping the database: see rollbacks/20260625_baseline_prehistory.rollback.sql.

-- Transaction-local, so the empty search_path does not leak into the files applied after this one
-- on the same connection.
select pg_catalog.set_config('search_path', '', true);
set local check_function_bodies = false;

-- PostGIS lives in `public` on production (geometry columns on nodes and detections).
create extension if not exists postgis with schema public;

-- Reconstructed: the legacy table 20260726 drops (see the header).
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL
);
ALTER TABLE public.users OWNER TO postgres;
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access users" ON public.users USING (true) WITH CHECK (true);

-- From production's dump, rewritten as the header describes.

CREATE FUNCTION public.auto_seed_species() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.species_name IS NOT NULL THEN
    INSERT INTO species (common_name, scientific_name, auto_seeded)
    VALUES (NEW.species_name, NEW.raw_label, true)
    ON CONFLICT (common_name) DO NOTHING;

    NEW.species_id = (
      SELECT id FROM species WHERE common_name = NEW.species_name
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.auto_seed_species() OWNER TO postgres;

CREATE TABLE public.nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    name text NOT NULL,
    hardware_type text DEFAULT 'rpi-zero-2w'::text,
    location public.geometry(Point,4326),
    elevation_m double precision,
    habitat_type text,
    is_active boolean DEFAULT true,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.nodes OWNER TO postgres;

CREATE FUNCTION public.update_node_habitat_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_node_habitat_updated_at() OWNER TO postgres;

CREATE FUNCTION public.update_species_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_species_updated_at() OWNER TO postgres;

CREATE TABLE public.aci_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid,
    recorded_at timestamp with time zone DEFAULT now(),
    aci_score double precision,
    time_category text,
    dawn_chorus boolean DEFAULT false,
    duration_secs integer DEFAULT 15,
    CONSTRAINT aci_logs_time_category_check CHECK ((time_category = ANY (ARRAY['Dawn'::text, 'Morning'::text, 'Midday'::text, 'Afternoon'::text, 'Dusk'::text, 'Night'::text])))
);


ALTER TABLE public.aci_logs OWNER TO postgres;

CREATE TABLE public.detections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid,
    species_id uuid,
    species_name text,
    detected_at timestamp with time zone DEFAULT now(),
    confidence double precision,
    location public.geometry(Point,4326),
    is_dawn_chorus boolean DEFAULT false,
    audio_file_url text,
    raw_label text,
    created_at timestamp with time zone DEFAULT now(),
    minutes_from_sunrise smallint,
    phenological_week smallint,
    season text,
    dawn_chorus_window boolean,
    CONSTRAINT detections_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT detections_phenological_week_check CHECK (((phenological_week >= 1) AND (phenological_week <= 52))),
    CONSTRAINT detections_season_check CHECK ((season = ANY (ARRAY['winter'::text, 'early_spring'::text, 'breeding'::text, 'post_breeding'::text, 'fall_migration'::text, 'late_fall'::text])))
);


ALTER TABLE public.detections OWNER TO postgres;

COMMENT ON COLUMN public.detections.minutes_from_sunrise IS 'Minutes since sunrise at detection time. Negative = before sunrise.';

COMMENT ON COLUMN public.detections.phenological_week IS 'Week of year 1-52, used for ecological season assignment.';

COMMENT ON COLUMN public.detections.season IS 'Ecological season derived from phenological week, not calendar quarters.';

COMMENT ON COLUMN public.detections.dawn_chorus_window IS 'True if detection occurred within -30 to +120 min of sunrise.';

CREATE TABLE public.node_habitat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    vegetation_structure text,
    dominant_vegetation text,
    canopy_cover_pct smallint,
    water_proximity text,
    disturbance_level text,
    disturbance_type text,
    aspect text,
    slope_pct smallint,
    notes text,
    recorded_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT node_habitat_aspect_check CHECK ((aspect = ANY (ARRAY['N'::text, 'NE'::text, 'E'::text, 'SE'::text, 'S'::text, 'SW'::text, 'W'::text, 'NW'::text, 'flat'::text]))),
    CONSTRAINT node_habitat_canopy_cover_pct_check CHECK (((canopy_cover_pct >= 0) AND (canopy_cover_pct <= 100))),
    CONSTRAINT node_habitat_disturbance_level_check CHECK ((disturbance_level = ANY (ARRAY['pristine'::text, 'low'::text, 'moderate'::text, 'high'::text]))),
    CONSTRAINT node_habitat_disturbance_type_check CHECK ((disturbance_type = ANY (ARRAY['none'::text, 'grazing'::text, 'logging'::text, 'fire_recent'::text, 'fire_historic'::text, 'roads'::text, 'development'::text, 'invasive_species'::text, 'mixed'::text]))),
    CONSTRAINT node_habitat_slope_pct_check CHECK (((slope_pct >= 0) AND (slope_pct <= 100))),
    CONSTRAINT node_habitat_vegetation_structure_check CHECK ((vegetation_structure = ANY (ARRAY['open_canopy'::text, 'closed_canopy'::text, 'shrubland'::text, 'grassland'::text, 'riparian'::text, 'wetland'::text, 'cliff_talus'::text, 'mixed'::text]))),
    CONSTRAINT node_habitat_water_proximity_check CHECK ((water_proximity = ANY (ARRAY['riparian'::text, 'wetland'::text, 'within_100m'::text, 'within_500m'::text, 'dry'::text, 'unknown'::text])))
);


ALTER TABLE public.node_habitat OWNER TO postgres;

CREATE TABLE public.species (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    common_name text NOT NULL,
    scientific_name text NOT NULL,
    taxon_class text,
    order_name text,
    family text,
    iucn_status text,
    ebird_code text,
    guild text,
    migratory_status text,
    indicator_status text,
    sensitivity_flag boolean DEFAULT false,
    auto_seeded boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT species_guild_check CHECK ((guild = ANY (ARRAY['aerial_insectivore'::text, 'foliage_gleaner'::text, 'bark_prober'::text, 'ground_forager'::text, 'granivore'::text, 'omnivore'::text, 'raptor'::text, 'nectarivore'::text, 'frugivore'::text, 'aquatic'::text, 'other'::text]))),
    CONSTRAINT species_indicator_status_check CHECK ((indicator_status = ANY (ARRAY['climate_sensitive'::text, 'habitat_specialist'::text, 'habitat_generalist'::text, 'disturbance_indicator'::text, 'old_growth_indicator'::text, 'none'::text]))),
    CONSTRAINT species_migratory_status_check CHECK ((migratory_status = ANY (ARRAY['resident'::text, 'short_distance'::text, 'long_distance'::text, 'altitudinal'::text, 'irruptive'::text])))
);


ALTER TABLE public.species OWNER TO postgres;

CREATE VIEW public.occurrences_view AS
 SELECT d.id AS "occurrenceID",
    COALESCE(s.scientific_name, d.species_name) AS "scientificName",
    s.common_name AS "vernacularName",
    s.taxon_class AS class,
    s.family,
    s.iucn_status AS "iucnRedListCategory",
    public.st_y(d.location) AS "decimalLatitude",
    public.st_x(d.location) AS "decimalLongitude",
    10 AS "coordinateUncertaintyInMeters",
    d.detected_at AS "eventDate",
    'MachineObservation'::text AS "basisOfRecord",
    d.confidence AS "identificationVerificationStatus",
    n.name AS "datasetName",
    n.habitat_type AS habitat
   FROM ((public.detections d
     LEFT JOIN public.species s ON ((s.id = d.species_id)))
     LEFT JOIN public.nodes n ON ((n.id = d.node_id)));


ALTER VIEW public.occurrences_view OWNER TO postgres;

ALTER TABLE ONLY public.aci_logs
    ADD CONSTRAINT aci_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.detections
    ADD CONSTRAINT detections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.node_habitat
    ADD CONSTRAINT node_habitat_node_id_key UNIQUE (node_id);

ALTER TABLE ONLY public.node_habitat
    ADD CONSTRAINT node_habitat_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_common_name_unique UNIQUE (common_name);

ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_scientific_name_key UNIQUE (scientific_name);

CREATE INDEX aci_node_idx ON public.aci_logs USING btree (node_id);

CREATE INDEX aci_time_idx ON public.aci_logs USING btree (recorded_at DESC);

CREATE INDEX detections_location_idx ON public.detections USING gist (location);

CREATE INDEX detections_node_idx ON public.detections USING btree (node_id);

CREATE INDEX detections_species_idx ON public.detections USING btree (species_name);

CREATE INDEX detections_time_idx ON public.detections USING btree (detected_at DESC);

CREATE INDEX idx_aci_logs_node_id ON public.aci_logs USING btree (node_id);

CREATE INDEX idx_detections_node_id ON public.detections USING btree (node_id);

CREATE INDEX nodes_location_idx ON public.nodes USING gist (location);

CREATE INDEX species_scientific_idx ON public.species USING btree (scientific_name);

CREATE TRIGGER node_habitat_updated_at BEFORE UPDATE ON public.node_habitat FOR EACH ROW EXECUTE FUNCTION public.update_node_habitat_updated_at();

CREATE TRIGGER seed_species_on_detection BEFORE INSERT ON public.detections FOR EACH ROW EXECUTE FUNCTION public.auto_seed_species();

CREATE TRIGGER species_updated_at BEFORE UPDATE ON public.species FOR EACH ROW EXECUTE FUNCTION public.update_species_updated_at();

ALTER TABLE ONLY public.aci_logs
    ADD CONSTRAINT aci_logs_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.detections
    ADD CONSTRAINT detections_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.detections
    ADD CONSTRAINT detections_species_id_fkey FOREIGN KEY (species_id) REFERENCES public.species(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.node_habitat
    ADD CONSTRAINT node_habitat_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);

CREATE POLICY "Public read aci_logs" ON public.aci_logs FOR SELECT USING (true);

CREATE POLICY "Public read detections" ON public.detections FOR SELECT USING (true);

CREATE POLICY "Public read node_habitat" ON public.node_habitat FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "Public read nodes" ON public.nodes FOR SELECT USING (true);

CREATE POLICY "Public read species" ON public.species FOR SELECT USING (true);

CREATE POLICY "Service role full access aci_logs" ON public.aci_logs USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access detections" ON public.detections USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access nodes" ON public.nodes USING (true) WITH CHECK (true);

ALTER TABLE public.aci_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.node_habitat ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nodes insert own aci_logs" ON public.aci_logs FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = node_id));

CREATE POLICY "nodes insert own detections" ON public.detections FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = node_id));

ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;

GRANT ALL ON FUNCTION public.auto_seed_species() TO anon;
GRANT ALL ON FUNCTION public.auto_seed_species() TO authenticated;
GRANT ALL ON FUNCTION public.auto_seed_species() TO service_role;

GRANT ALL ON TABLE public.nodes TO anon;
GRANT ALL ON TABLE public.nodes TO authenticated;
GRANT ALL ON TABLE public.nodes TO service_role;

GRANT ALL ON FUNCTION public.update_node_habitat_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_node_habitat_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_node_habitat_updated_at() TO service_role;

GRANT ALL ON FUNCTION public.update_species_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_species_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_species_updated_at() TO service_role;

GRANT ALL ON TABLE public.aci_logs TO anon;
GRANT ALL ON TABLE public.aci_logs TO authenticated;
GRANT ALL ON TABLE public.aci_logs TO service_role;

GRANT ALL ON TABLE public.detections TO anon;
GRANT ALL ON TABLE public.detections TO authenticated;
GRANT ALL ON TABLE public.detections TO service_role;

GRANT ALL ON TABLE public.node_habitat TO anon;
GRANT ALL ON TABLE public.node_habitat TO authenticated;
GRANT ALL ON TABLE public.node_habitat TO service_role;

GRANT ALL ON TABLE public.species TO anon;
GRANT ALL ON TABLE public.species TO authenticated;
GRANT ALL ON TABLE public.species TO service_role;

GRANT ALL ON TABLE public.occurrences_view TO anon;
GRANT ALL ON TABLE public.occurrences_view TO authenticated;
GRANT ALL ON TABLE public.occurrences_view TO service_role;
