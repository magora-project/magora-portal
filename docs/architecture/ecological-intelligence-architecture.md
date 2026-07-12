# Ecological Intelligence Architecture

Status: spec (v1 scope defined). Trait slice #1 SHIPPED 2026-07-08 (bird trait enrichment — see §5, §12 decisions 3 & 4, §13); the interaction/phenology slices remain net-new schema, not yet built.
Position: the knowledge substrate beneath the ecological agent team. Pulse and Narrative reason *over* this layer; they never source ecological facts from model priors.

---

## 1. Purpose and position

Magora's agents need structured ecological knowledge to ask grounded questions and, later, to make grounded baseline claims. This spec defines that knowledge layer: what sources feed it, how they land in Supabase, the interfaces agents consume, and the boundaries that keep it trustworthy.

It sits **below Pulse**, not inside it. Pulse decides *what is notable*; this layer supplies *what relates to what* and *what should be happening now*.

## 2. Consumers

- **Pulse `survey_gap_question` (v1, live consumer).** The grounded tier ships today against existing structured fields; the **rich tier** (bird → shared floral resource → is it blooming?) activates the moment this layer exists.
- **Pulse `absence` baseline (future consumer).** Phenology expectation is the plant-side equivalent of an eBird baseline — one of the external baselines the gated `absence` kind requires before it can be enabled.
- **Narrative Agent reasoning (future).** Voice rendering draws on relationship/trait context for "why this matters" phrasing — but only over facts this layer supplies.

## 3. Sources

### v1 (ship these)

- **GloBI (Global Biotic Interactions)** — primary relationship source. Open index of species-interaction records (pollinator-plant, predator-prey, host-parasite). CC-BY 4.0 data, REST API, bulk archives. Supplies the bird ↔ plant edges the rich survey-gap tier needs.
- **USA-NPN (National Phenology Network)** — phenology source. Two products matter: observational bloom/leaf records, and the **gridded Spring Index / AGDD predictive models** that estimate expected first-bloom at a lat/long from climate. No API key (honor-system self-identification). The predictive models solve the "no node has a prior year" problem — expectation is modeled from climate, not node history.
- **AVONET / EltonTraits / SAviTraits** — bird trait enrichment (diet, foraging stratum, seasonal diet). Enriches the seeded `species` table (keyed by `ebird_code` over whatever `species` holds — the set grows with the network) so Pulse can reason about guild/diet, i.e. *why* two detected birds share a resource. AVONET is aligned to eBird taxonomy — see §7. **Trait slice #1 SHIPPED (2026-07-08)** — see §5 / §13.
- **iNaturalist ambient (already wired, Step 0)** — cross-taxa second baseline; nearby non-avian taxa the acoustic nodes can't hear. Ground-truth target for survey-gap questions.

### v2 (depth, deferred)

- **Mangal** — full interaction *networks* (connectance, centrality), REST API. Richer than GloBI's pairwise index when network-structure reasoning is wanted.
- **Metaweb / phylogenetic-transfer-learning prediction** — predict likely interactions where none are recorded, from evolutionary relatedness. Research-tier. Outputs must be flagged **predicted**, never presented as observed.

## 4. Architecture decision: cached reference layer

**Ingest these sources into Supabase as a periodically-refreshed reference layer. Do not call third-party APIs in the hot path.**

Rationale: this data is slow-moving (interactions and phenology models don't change intra-day), and the platform already runs a check-before-generate discipline (insight cache). Live calls in an interactive expand path would add latency, external-dependency failure modes, and rate-limit exposure for no benefit. ETL bulk CC-BY data on a refresh cadence; agents query Postgres/PostGIS locally.

Agents never import the sources' R clients (rglobi/rnpn/rmangal). They hit the underlying REST APIs only during ETL, or consume bulk archives.

## 5. Reference data model (sketch)

Net-new tables, separate migration from `pulses`.

- `ref_species_interactions`
  - `source_taxon_id`, `target_taxon_id` (internal taxon keys — see §7)
  - `interaction_type` (e.g. `pollinates`, `eats`, `visits`)
  - `provenance` (source dataset + citation), `is_predicted boolean default false`
- `ref_phenology_expectation`
  - `taxon_id`, spatial key (grid cell / PostGIS geometry), `phenophase` (e.g. `first_bloom`)
  - `expected_doy_start`, `expected_doy_end`, `model_source`, `climate_inputs` provenance
- `species` trait enrichment — **SHIPPED as joined `ref_species_traits`** (trait slice #1, 2026-07-08; §12 decision 3)
  - AVONET native single-axis traits for **all birds**: `trophic_niche` (diet) + `primary_lifestyle` (foraging stratum), keyed by `ebird_code`. The blended-guild derivation was **dropped** — AVONET is diet-only while the curated `guild` vocab conflates diet + stratum, so a single blended column is provenance-inconsistent (the axis split).
  - `guild` / `indicator_status` / `sensitivity_flag` / `migratory_status` are **curated-only** (regional judgment); NULL for uncurated birds and non-birds. Raw `avonet_migration` (1/2/3) stored separately, never mapped onto the 5-level `migratory_status`.
  - Every row carries `trait_source` + `provenance`. Authoritative in `ref_species_traits`; documented derived projection onto `species.*` for existing consumers (ETL is sole writer). `apply_species_trait` is **service_role-only** (unconditional upsert ⇒ no anon write path). Un-degrades Pulse `novel_detection.rarity`, which now consumes `trophic_niche`/`primary_lifestyle` + curated fields.
- `ref_taxonomy_crosswalk` (see §7) — maps external source IDs ↔ internal taxon key.
- `range_allowlist` — **a range/occurrence reference slice (EIA-adjacent), SHIPPED as part of the Universal Range-Validity Gate v1 (migration `20260720`).** Cached plausible-species set per coarsened location cell (`range_cell_key`, ~0.5°) + week, sourced from **eBird occurrence** (`data/obs/geo/recent`) — the same structured range data that constrains BirdNET inference. This is the SAME "cached reference layer, never third-party APIs in the hot path" pattern as §4 (a monthly batch builder writes it; the detection gate only reads it). Writes go through `replace_range_cell`, a **service_role-only** SECURITY DEFINER RPC (mirrors `apply_species_trait`). It is deliberately recorded here so it is **not re-drafted later as a separate concept**: the range/occurrence layer belongs to EIA alongside interactions, phenology, and traits — it is the *plausibility* seam (`is_plausible(species, lat, lon, week)`), consumed today by the detection-quarantine gate rather than by Pulse, and a natural future input to `novel_detection` reasoning. v1 is cell-resolved / week-agnostic (rows at `week = 0`); a future week-resolved rebuild tightens to 1..48 with no schema change.

PostGIS indexing on the phenology spatial key; the node's coords resolve to the relevant grid cell.

## 6. Consumer interfaces (the seam Pulse codes against)

Pulse v1 already stubs these; this layer implements them.

```
relationshipSource.getRelatedTaxa(taxon_id, interaction_type?) 
  → { taxon_id, interaction_type, provenance, is_predicted }[]

phenologySource.getExpectedPhenophase(taxon_id, lat, lng, date) 
  → { phenophase, expected_doy_window, model_source } | null
```

Contract guarantees: results carry provenance; predicted edges are flagged; a miss returns empty/null (Pulse must not emit a survey-gap question on absent structured data — see §8).

## 7. Taxonomic reconciliation (first-class concern)

The join problem is real and must be solved before edges are trustworthy. The `species` table is seeded on **eBird taxonomy**. GloBI references EOL/GBIF/ITIS/NCBI. USA-NPN uses its own species IDs. AVONET publishes three taxonomies **including eBird**.

Approach: an internal `taxon_id` as the spine, with `ref_taxonomy_crosswalk` mapping each source's identifiers to it. AVONET's eBird alignment is the cheapest bridge for the bird side; GBIF backbone is the practical hub for cross-taxa (plants). Unmapped source records are quarantined, not silently dropped or force-matched — a bad taxon match produces a false relationship, which is the exact failure mode §8 guards against.

## 8. Guardrails

- **LLM is renderer/reasoner, never knowledge source.** Every relationship and phenology fact an agent uses comes from this layer. If the layer has no edge, the agent does not invent one. A fabricated bird-flower link taught to a steward under an authoritative voice is the worst failure this system can produce.
- **Predicted vs observed is always distinguished.** `is_predicted` propagates to any payload; v1 uses observed only.
- **Empty is a valid answer.** Missing structured grounding suppresses the question; it never triggers a guess.
- **Global-first / region-agnostic seams.** Every reference seam is region-agnostic; regional data sources are pluggable implementations behind the seam, never baked into the interface. Global is a first-class goal. USA-NPN is one (US, temperate) phenology implementation, not the phenology layer — the temperate AGDD model does not transfer to tropical/aseasonal regions; a regional model plugs in behind `phenologySource`. §8's honest-empty rule means an unimplemented region goes quiet, never wrong.

## 9. IEK boundary

This layer is the **Western-scientific spine**. It is distinct from the IEK / Elder knowledge layer, which stays deliberately stubbed. The two are separate sources feeding agent reasoning; one is never collapsed into or substituted by the other, and the knowledge-consent model for IEK must not be retrofitted onto this layer's ingestion pattern. A GloBI edge and an Elder's account of the same relationship are different epistemologies with different consent and provenance requirements.

## 10. Licensing and attribution

GloBI data CC-BY 4.0; AVONET CC-BY; USA-NPN honor-system self-identification (populate a `request_source` on ETL). Attribution travels in each reference row's `provenance`, so any downstream surfacing can credit sources correctly.

## 11. Migration flag

Reference-layer tables (§5) are **net-new schema**, separate from the `pulses` migration. Flag to Architect before Claude Code builds.

## 12. Open decisions (for the Architect / Noah)

1. **Refresh cadence** for the cached layer — interactions rarely change (quarterly?); phenology models are seasonal (weekly during growing season?). Set per-source. *(OPEN — belongs to the GloBI/USA-NPN slices.)*
2. **Phenology spatial resolution** — grid-cell size / whether to store USA-NPN raster values vs point queries. Trades storage against precision. *(OPEN — belongs to the USA-NPN slice.)*
3. **Trait enrichment placement** — **RESOLVED (trait slice #1, 2026-07-08):** joined `ref_species_traits` (provenance-clean) is authoritative, with a documented derived projection onto `species.*` so existing consumers read unchanged. The ETL is the sole writer of the projection, so no drift.
4. **Crosswalk build order** — **RESOLVED (trait slice #1, 2026-07-08):** bird-side only, via `species.ebird_code` ↔ AVONET eBird taxonomy. No `taxon_id` spine / `ref_taxonomy_crosswalk` built yet — deferred to the GloBI/cross-taxa slice (where the GBIF hub becomes necessary).

## 13. Scope

- **v1:** GloBI (observed edges) + USA-NPN (predictive + observational phenology) + trait enrichment, all cached; bird-side crosswalk; the two consumer interfaces implemented; guardrails enforced.
  - **Shipped so far — trait slice #1 (2026-07-08):** AVONET native axes (`trophic_niche`, `primary_lifestyle`) for all birds + curated regional judgments in `ref_species_traits`; bird-side `ebird_code` crosswalk; `traitSource` seam; Pulse `novel_detection.rarity` un-degraded. GloBI edges, USA-NPN phenology, and the relationship/phenology seams remain to build.
- **v2:** Mangal networks; metaweb prediction (flagged predicted); cross-taxa crosswalk depth; Narrative reasoning consumers; IEK integration handled under its own consent model.
