# Task Definition — Species Guild/Diet Enrichment v1 (EIA trait slice #1)

> Rationale-free implementation spec for Claude Code. Design rationale lives in the Architect project / vault (`Ecological-Intelligence-Architecture` §12 decisions 3 & 4, this slice). Repo + GitHub history is source of truth.

## Problem

Pulse's `species` table (358 rows) has null-seeded trait columns; `novel_detection.rarity` runs a degraded conservation+frequency proxy that ignores guild, and its tuning-todo says "activate guild/diet rarity when guild-enrichment lands." Build the first EIA trait slice: a provenance-clean cached trait layer that populates AVONET's clean diet/foraging axes for all birds plus the curated guild + regional judgments (from `scripts/gen_guild_sql.py`), exposed through a trait accessor and projected onto `species` for existing consumers, and wire Pulse rarity to consume it.

**Prereq (SHIPPED):** `ebird_code` / `family` / `order_name` backfilled (migration `20260714`, 346/358; 12 honest NULLs = 11 non-birds + the Cordilleran/Western Flycatcher lump). The crosswalk key now exists.

**AVONET source:** figshare `https://figshare.com/s/b990722d72a26b5bfead` → "AVONET Supplementary dataset 1.xlsx", sheet **`AVONET2_eBird`** (eBird taxonomy, 11,009 species). CC-BY — surface attribution in the app (credits/about line) and keep per-row provenance in `ref_species_traits`.

## Output

- **`ref_species_traits`** — a net-new cached reference table (joined, not in-place), one row per matched species, carrying `trophic_niche`, `primary_lifestyle`, `guild` (curated-only), `migratory_status`, `indicator_status`, `sensitivity_flag`, `avonet_migration`, and per-row `trait_source` provenance.
- **AVONET ingest (ETL, idempotent + re-runnable):** for **all bird rows, keyed on `ebird_code`** — never a hardcoded species list — store AVONET's **native single-axis traits**: `trophic_niche` (from `Trophic.Niche` = diet) and `primary_lifestyle` (from `Primary.Lifestyle` = foraging stratum). These are the analytic ground truth. **Do NOT derive a single blended `guild` from AVONET** — the curated `guild` vocab conflates diet + stratum, and AVONET is diet-only, so a blended derivation produces a provenance-dependent, semantically inconsistent column (decided at the v1 validation gate: 67% agreement was the vocabulary flagging the two-axis conflation, not a tuning problem). AVONET's data is static (no refresh cron), but the ETL must be **re-runnable**: species added later (new regions/nodes) enrich on re-run. AVONET is a complete global bird dataset, so this covers any region, not just North America.
- **Curated ingest:** port the 72 rows from `scripts/gen_guild_sql.py` into `ref_species_traits` with `trait_source='curated'`; these are the **only** source of `guild` / `migratory_status` / `indicator_status` / `sensitivity_flag`.
- **`traitSource.getTraits(species_id)`** accessor — mirrors the existing `relationshipSource` / `phenologySource` seams (EIA §6); returns the trait row with provenance, or empty on a miss.
- **Pulse rarity wiring:** `novel_detection.rarity` consumes `trophic_niche` (+ `primary_lifestyle`) and curated `indicator_status`/`sensitivity_flag` where present, via `traitSource`; additive — where traits are NULL, the current proxy stands. Update the `rarity_basis` evidence stamp to name `trophic_niche` (AVONET).
- **Post-apply verification (no blended-guild gate):** the blended AVONET→guild agreement gate is dropped (the axis split removed the blended derivation). After apply, verify coverage (every bird has `trophic_niche` + `primary_lifestyle` or honest-NULL) and live rarity, and report back.

## Field-source rules (honest degradation — enforce exactly)

- **`trophic_niche` / `primary_lifestyle`** — AVONET-derived for all birds (grounded, `trait_source='AVONET'`). The clean analytic axes Pulse reasons over. Birds with no AVONET match → NULL + flagged unmatched (never force-matched, EIA §7/§8); non-birds → NULL (AVONET is birds-only).
- **`guild`** — **curated-only** (the 72), magora vocab. NULL for uncurated birds and non-birds in `ref_species_traits`. Never derive a blended guild from AVONET. The `species.guild` display projection is **also curated-only — honest-NULL for uncurated**; never project the AVONET `trophic_niche` diet term into `species.guild` (it would violate `species_guild_check` and blur the vocabulary boundary — the AVONET diet axis lives in `species.trophic_niche`, not `species.guild`).
- **`migratory_status`** — **curated-only** (72). NULL elsewhere. Do NOT map AVONET's coarse 3-level migration onto Magora's 5-level (irruptive/altitudinal/long/short) — that mislabels. Store raw `avonet_migration` (1/2/3) as a separate field for future use; do not present it as `migratory_status`.
- **`indicator_status`** — **curated-only** (72). NULL elsewhere. Never derive from AVONET (it is a regional ecological judgment, not an AVONET field; deriving it is a fabricated claim, EIA §8).
- **`sensitivity_flag`** — **curated-only** (72). NULL elsewhere. Never fabricate.

## Constraints

- **Placement:** `ref_species_traits` is the **authoritative, provenance-carrying** source (EIA §12 decision 3). The ETL **also projects** `guild` + the curated fields onto the existing `species` trait columns as a **documented derived cache** — the ETL is the sole writer, so no drift; label the columns "derived from ref_species_traits, do not hand-edit." The 5 live consumers (`DetectionCard.jsx` badges, `api/insight.js` node-insight prompt, 3× `api/_pulse`) keep reading `species.*` unchanged — **no reroute**. Build `traitSource.getTraits(species_id)` (reads `ref_species_traits`, provenance-aware) for Pulse rarity and to parallel the `relationshipSource`/`phenologySource` seams; Pulse may read the projected `species.guild` directly where simpler. Do not expose `ref_species_traits` to the client — the projection already feeds the frontend.
- **Crosswalk:** bird-side only (EIA §12 decision 4). Key `ref_species_traits` to `species` via `ebird_code` ↔ AVONET eBird taxonomy. Do **not** build a `taxon_id` spine or `ref_taxonomy_crosswalk` in this slice — deferred to the GloBI/cross-taxa slice.
- **Global readiness:** never hardcode the species set or assume North America. Enrich by `ebird_code` over whatever `species` holds. `trophic_niche`/`primary_lifestyle` (AVONET) are global; the curated `guild`/`indicator_status`/`sensitivity_flag`/`migratory_status` are a *regional* set (Colorado/montane) — species outside it get honest-empty NULLs, exactly like the uncurated birds. Do not fabricate regional judgments for out-of-region species.
- **Provenance:** every row carries `trait_source` and an AVONET citation where AVONET-sourced (EIA §8/§10). Curated judgments are never overwritten by AVONET.
- **Guardrails (EIA §8):** the layer is structured-source-only; empty is a valid answer (NULL, never a guess). No predicted values in v1.
- **Migration is net-new and SEPARATE from `pulses`** (EIA §11). Do not touch the `pulses` / `upsert_pulse` / narrative-cache schema.
- Carry `listeners.id = auth.users(id)`; never reference `node_follows`. `ref_species_traits` is species reference data — no person data.
- Do not build GloBI, USA-NPN, the relational/phenology sub-scores, or a `taxon_id` spine. Do not touch `survey_gap_question` scoring — its `relationship_strength` / `phenology_alignment` stay degraded (they need later slices).

## Files (expected)

- Migration (net-new): `ref_species_traits` + indexes; separate file from the pulses migrations.
- ETL / seed script: AVONET ingest (native axes) + curated port (from `gen_guild_sql.py`). AVONET bulk file is CC-BY — pull during ETL only, not the hot path.
- `api/_pulse/sources.js` (or wherever `relationshipSource` / `phenologySource` live) — add `traitSource.getTraits`.
- `api/_pulse/score.js` / `generate.js` — wire `novel_detection.rarity` to `traitSource`; update `rarity_basis` stamp. Additive; no change to other kinds.
- `scripts/gen_guild_sql.py` — track in git as the curated-judgment source of record (do not discard its 72 rows).

## Migration (REQUIRED — flag)

`ref_species_traits` (net-new, separate migration): `species_id` FK → `species(id)`, `trophic_niche`, `primary_lifestyle`, `guild` (curated-only), `migratory_status`, `indicator_status`, `sensitivity_flag`, `avonet_migration`, `trait_source`, `provenance`, timestamps. Index on `species_id`. No change to `pulses`; `species.*` trait columns are written only as the derived display projection.

## Test

- **Coverage:** every bird row has `trophic_niche` + `primary_lifestyle`, or is explicitly flagged unmatched (NULL + provenance) — no silent drops, no force-matches. Non-birds → NULL. Curated 72 keep `guild` / `migratory_status` / `indicator_status` / `sensitivity_flag`. Re-running the ETL after adding species enriches them without touching existing rows (idempotent).
- **Consistency spot-check (not a gate):** curated diet-guilds (e.g. `granivore`) map to the matching AVONET `trophic_niche` — sanity only; there is no blended-guild agreement gate (blended derivation was dropped at the v1 validation gate).
- **Honest-empty:** `migratory_status` / `indicator_status` / `sensitivity_flag` are non-NULL **only** for the 72 curated species; NULL for the rest. Curated `guild` values survive (not overwritten by AVONET).
- **Accessor:** `traitSource.getTraits` returns provenance; a miss returns empty/null.
- **Pulse rarity:** consumes `trophic_niche` where present; unchanged where NULL; `rarity_basis` stamp updated; `activity_spike` / `soundscape_shift` / `survey_gap_question` scoring unchanged (regression).
- **Isolation:** migration is separate from `pulses`; `ref_species_traits` is authoritative; `species.*` trait columns are written only as the derived projection (ETL sole writer). The 5 existing consumers keep reading `species.*` (projection populates them) — no reroute, no client exposure of `ref_species_traits`.
