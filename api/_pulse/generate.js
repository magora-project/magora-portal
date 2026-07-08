// Pulse Agent v1 — candidate generation (§3). Parameterized queries against the verified
// tables; thresholds come from PULSE_CONFIG, not literals. Returns Candidate[] carrying
// per-component sub-scores in [0,1]; scorePulses aggregates them with the versioned
// weights. `absence` is deliberately NOT generated (gated off — see §3/§5).
//
// Two degradations are wired here because the guild/diet columns are null-seeded in v1:
//   1. novel_detection.rarity is derived from seeded conservation status + network
//      detection frequency; it does NOT read the guild column. `guild` appears in
//      evidence only when present (optional/nullable).
//   2. survey_gap_question.relationship_strength returns a NEUTRAL sub-score via the
//      stubbed relationshipSource seam. The grounded tier (habitat fields + iNat
//      ground-truth) fires normally and is NOT degraded.
// Both are marked tuning-todos that activate when the guild-enrichment migration lands.

import { PULSE_CONFIG, PULSE_ABSENCE_ENABLED } from './payload.js'
import {
  detectionsInWindow, hasPriorDetection, networkDetectionCount, speciesProfile,
  detectionCount, aciMean, nodeHabitat, nodeCoords, nodeSpeciesSet, inatAmbient,
  relationshipSource, phenologySource, traitSource,
} from './sources.js'

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n) => Math.round(n * 1000) / 1000
const spanMs = (w) => Math.max(new Date(w.end) - new Date(w.start), 3600000) // floor at 1h
const spanDays = (w) => spanMs(w) / 86400000
const N = PULSE_CONFIG

/**
 * The shared candidate generator both entry points call. Window is always a parameter.
 * @param {string} nodeId
 * @param {import('./payload.js').Window} window
 * @returns {Promise<import('./payload.js').Candidate[]>}
 */
export async function generateCandidates(nodeId, window) {
  const detected = await detectionsInWindow(nodeId, window)

  const [novel, spike, soundscape, surveyGap] = await Promise.all([
    genNovelDetections(nodeId, window, detected),
    genActivitySpike(nodeId, window, detected),
    genSoundscapeShift(nodeId, window),
    genSurveyGapQuestions(nodeId),
  ])

  // absence — NOT generated in v1. The enum value + schema slot exist so no migration is
  // needed later, but the generator is intentionally unbuilt and gated. Even flipping the
  // flag would additionally require an external baseline, a baseline threshold,
  // coverage-continuity, and node-offline detection (none of which v1 implements).
  if (PULSE_ABSENCE_ENABLED) {
    // Intentionally a no-op guard, not a generator. See task def §3 and §5.
  }

  return [...novel, ...spike, ...soundscape, ...surveyGap]
}

// ── novel_detection ──────────────────────────────────────────────────────────
// weights: { rarity: 0.5, recency: 0.3, confidence: 0.2 }
async function genNovelDetections(nodeId, window, detected) {
  const winMs = spanMs(window)
  const winEnd = new Date(window.end).getTime()

  const results = await Promise.all(
    detected.map(async (d) => {
      const prior = await hasPriorDetection(nodeId, d.species_name, window.start)
      if (prior) return null // seen before at this node -> not novel

      const [profile, netCount] = await Promise.all([
        speciesProfile(d.species_name),
        networkDetectionCount(d.species_name),
      ])
      // Authoritative trait layer (ref_species_traits). Null before the trait ETL lands
      // or on a miss (non-bird / unmatched) -> the degraded proxy stands (additive).
      const traits = await traitSource.getTraits(profile?.id)

      const freqScore = clamp01(1 - netCount / N.novelFrequencyFullN) // rarer network-wide -> higher
      const consScore = conservationScore(profile?.conservation_status)
      const traitScore = traitSignificance(traits) // null when no grounded traits present

      // When grounded traits exist, fold the AVONET diet/stratum axes + (curated) guild /
      // indicator_status / sensitivity_flag into rarity; otherwise the conservation+frequency
      // proxy stands unchanged. No blended-guild derivation.
      let rarity, rarityBasis
      if (traitScore != null) {
        rarity = clamp01(0.4 * freqScore + 0.25 * consScore + 0.35 * traitScore)
        rarityBasis = `traits (${traits.trait_source}): trophic_niche/primary_lifestyle + curated guild/indicator_status/sensitivity_flag + conservation + network frequency`
      } else {
        rarity = clamp01(0.6 * freqScore + 0.4 * consScore)
        rarityBasis = 'degraded: conservation_status + network detection frequency (no trait row)'
      }

      // recency: first-seen nearer the window end scores higher.
      const recency = clamp01(1 - (winEnd - new Date(d.first_seen).getTime()) / winMs)
      const confidence = clamp01(d.confidence_max ?? 0)

      return {
        kind: 'novel_detection',
        components: { rarity, recency, confidence },
        subject: { species: [d.species_name] },
        evidence: {
          first_seen: d.first_seen,
          confidence_max: d.confidence_max,
          detection_count_in_window: d.count,
          conservation_status: profile?.conservation_status ?? null,
          network_detection_count: netCount,
          ...(traits?.trophic_niche ? { trophic_niche: traits.trophic_niche } : {}),      // AVONET diet
          ...(traits?.primary_lifestyle ? { primary_lifestyle: traits.primary_lifestyle } : {}), // AVONET stratum
          ...(traits?.guild ? { guild: traits.guild, guild_source: 'curated' } : {}),     // curated-only
          ...(traits?.provenance ? { trait_provenance: traits.provenance } : {}),
          rarity_basis: rarityBasis,
        },
      }
    }),
  )
  return results.filter(Boolean)
}

// ── activity_spike ─────────────────────────────────────────────────────────────
// weights: { magnitude: 0.6, baseline_stability: 0.4 }
async function genActivitySpike(nodeId, window, detected) {
  const winDays = spanDays(window)
  const baseStart = new Date(new Date(window.start).getTime() - N.baselineDays * 86400000).toISOString()

  const [winCount, baseCount] = await Promise.all([
    detectionCount(nodeId, window.start, window.end),
    detectionCount(nodeId, baseStart, window.start),
  ])

  // No baseline -> cannot claim a spike (cold-start guard; salience has no history delta).
  if (baseCount <= 0) return []

  const winRate = winCount / winDays
  const baseRate = baseCount / N.baselineDays
  const ratio = baseRate > 0 ? winRate / baseRate : 0
  if (ratio < N.spikeMultiple) return []

  const magnitude = clamp01((ratio - 1) / (N.spikeCeiling - 1))
  const baseline_stability = clamp01(baseCount / N.baselineStabilityFullN)

  return [{
    kind: 'activity_spike',
    components: { magnitude, baseline_stability },
    subject: { metric: 'detection_rate', species: detected.map((d) => d.species_name).slice(0, 20) },
    evidence: {
      window_rate: round(winRate),
      baseline_rate: round(baseRate),
      ratio: round(ratio),
      window_count: winCount,
      baseline_count: baseCount,
      baseline_days: N.baselineDays,
    },
  }]
}

// ── soundscape_shift (with §5 downward -> question gate) ───────────────────────
// weights: { delta_magnitude: 0.7, direction: 0.3 }
async function genSoundscapeShift(nodeId, window) {
  const baseStart = new Date(new Date(window.start).getTime() - N.aciBaselineDays * 86400000).toISOString()
  const [win, base] = await Promise.all([
    aciMean(nodeId, window.start, window.end),
    aciMean(nodeId, baseStart, window.start),
  ])
  if (win.mean == null || base.mean == null) return [] // no baseline / no samples

  const delta = win.mean - base.mean
  if (Math.abs(delta) < N.aciMinDelta) return [] // within noise

  const delta_magnitude = clamp01(Math.abs(delta) / N.aciDeltaCeiling)
  const up = delta >= 0
  const evidence = {
    window_mean: round(win.mean),
    baseline_mean: round(base.mean),
    delta: round(delta),
    direction: up ? 'up' : 'down',
    window_samples: win.sampleCount,
    baseline_samples: base.sampleCount,
    baseline_days: N.aciBaselineDays,
  }

  // Upward shift: emit as soundscape_shift (more acoustic complexity/activity).
  if (up || PULSE_ABSENCE_ENABLED) {
    return [{
      kind: 'soundscape_shift',
      components: { delta_magnitude, direction: up ? 1 : 0 },
      subject: { metric: 'aci' },
      evidence,
    }]
  }

  // §5 gate: a DOWNWARD shift is emitted ONLY as a survey_gap_question (a question, never
  // a decline assertion) while PULSE_ABSENCE_ENABLED is false.
  const [rel, phen] = await Promise.all([neutralRelationship(), neutralPhenology()])
  return [{
    kind: 'survey_gap_question',
    components: { relationship_strength: rel, phenology_alignment: phen, data_absence: delta_magnitude },
    subject: { metric: 'aci' },
    survey_gap: {
      question_focus: "The soundscape here has been quieter than this node's recent baseline. What changed at this place?",
      relationship_rationale:
        'Lower acoustic complexity can mean fewer vocal animals, weather, or a change at the recorder. v1 asks rather than asserts decline (absence detection is gated off).',
      answer_target: 'journal free-text',
    },
    evidence: { ...evidence, routed_from: 'soundscape_shift', gate: 'downward shift routed to question (PULSE_ABSENCE_ENABLED=false)' },
  }]
}

// ── survey_gap_question (grounded tier: habitat fields + iNat ground-truth) ────
// weights: { relationship_strength: 0.5, phenology_alignment: 0.3, data_absence: 0.2 }
async function genSurveyGapQuestions(nodeId) {
  const out = []
  const [habitat, { lat, lon }, nodeSpecies] = await Promise.all([
    nodeHabitat(nodeId),
    nodeCoords(nodeId),
    nodeSpeciesSet(nodeId),
  ])

  // habitat-gap: structured habitat fields that are null/absent for the place.
  const habitatFields = ['vegetation_structure', 'dominant_vegetation', 'water_proximity', 'disturbance_level']
  for (const f of habitatFields) {
    const missing = !habitat || habitat[f] == null || habitat[f] === ''
    if (!missing) continue
    const [rel, phen] = await Promise.all([neutralRelationship(), neutralPhenology()])
    out.push({
      kind: 'survey_gap_question',
      components: { relationship_strength: rel, phenology_alignment: phen, data_absence: 1 },
      subject: { metric: f },
      survey_gap: {
        question_focus: `This place has no recorded ${f.replace(/_/g, ' ')}. Can you fill it in?`,
        relationship_rationale:
          'Structured habitat context grounds later relational reasoning about which species this place should support. Held neutral in v1 (guild/diet + reference layer not yet available).',
        answer_target: `node_habitat.${f}`,
      },
      evidence: { missing_field: f, has_habitat_row: !!habitat },
    })
  }

  // iNat ground-truth: a research-grade nearby taxon the node has never detected.
  const ambient = await inatAmbient(lat, lon)
  const detectedLower = new Set([...nodeSpecies].map((s) => s.toLowerCase()))
  let asked = 0
  for (const t of ambient.sort((a, b) => b.count - a.count)) {
    if (asked >= N.inatMaxQuestions) break
    if (t.count < N.inatMinCount || !t.common) continue
    if (detectedLower.has(t.common.toLowerCase())) continue // already confirmed at the node
    const [rel, phen] = await Promise.all([neutralRelationship(), neutralPhenology()])
    out.push({
      kind: 'survey_gap_question',
      components: { relationship_strength: rel, phenology_alignment: phen, data_absence: 1 },
      subject: { species: [t.common] },
      survey_gap: {
        question_focus: `${t.common} is verified nearby on iNaturalist but this node has never detected it. Is it present here?`,
        relationship_rationale:
          `Nearby research-grade observation (${t.count} records within ${N.inatRadiusKm}km) suggests ${t.common} could occur here. Relationship weighting held neutral in v1 (guild/diet + GloBI not yet available).`,
        answer_target: 'journal free-text',
      },
      evidence: {
        inat_common: t.common,
        inat_scientific: t.name,
        inat_count: t.count,
        iconic: t.iconic,
        radius_km: N.inatRadiusKm,
        threatened: t.threatened,
      },
    })
    asked++
  }

  return out
}

// ── shared helpers ─────────────────────────────────────────────────────────────
// Map a conservation status to a rarity contribution. Handles IUCN codes and common
// long-form labels; unknown non-LC values get a small default.
function conservationScore(status) {
  if (!status) return 0
  const s = String(status).trim().toLowerCase()
  if (['lc', 'least concern', 'none', 'not evaluated', 'ne'].includes(s)) return 0
  if (['nt', 'near threatened'].includes(s)) return 0.4
  if (['vu', 'vulnerable'].includes(s)) return 0.6
  if (['en', 'endangered'].includes(s)) return 0.8
  if (['cr', 'critically endangered'].includes(s)) return 1.0
  return 0.2
}

// Ecological-significance score in [0,1] from grounded trait fields (ref_species_traits),
// AXIS SPLIT: AVONET trophic_niche (diet) + primary_lifestyle (stratum) for all birds,
// plus curated indicator_status / sensitivity_flag / guild where present. No blended guild.
// The strongest present signal wins; returns null when no traits present so the caller
// falls back to the conservation+frequency proxy (additive).
function traitSignificance(t) {
  if (!t || (!t.trophic_niche && !t.primary_lifestyle && !t.guild && !t.indicator_status && !t.sensitivity_flag)) {
    return null
  }
  let s = 0
  if (t.sensitivity_flag) s = Math.max(s, 0.8)
  const INDICATOR = { // curated-only
    old_growth_indicator: 0.9, climate_sensitive: 0.8, habitat_specialist: 0.7,
    disturbance_indicator: 0.3, habitat_generalist: 0.2, none: 0.2,
  }
  if (t.indicator_status && INDICATOR[t.indicator_status] != null) s = Math.max(s, INDICATOR[t.indicator_status])
  const CURATED_GUILD = { // curated magora guilds only
    nectarivore: 0.7, bark_prober: 0.6, raptor: 0.6, aerial_insectivore: 0.5, frugivore: 0.5,
    aquatic: 0.5, foliage_gleaner: 0.4, ground_forager: 0.35, granivore: 0.35, omnivore: 0.25,
  }
  if (t.guild && CURATED_GUILD[t.guild] != null) s = Math.max(s, CURATED_GUILD[t.guild])
  const NICHE = { // AVONET Trophic.Niche (diet) — specialist diets score higher
    Nectarivore: 0.6, Vertivore: 0.6, 'Aquatic predator': 0.5, Scavenger: 0.5, Frugivore: 0.5,
    'Herbivore aquatic': 0.4, Invertivore: 0.4, 'Herbivore terrestrial': 0.35, Granivore: 0.35, Omnivore: 0.25,
  }
  if (t.trophic_niche && NICHE[t.trophic_niche] != null) s = Math.max(s, NICHE[t.trophic_niche])
  const LIFESTYLE = { Aerial: 0.4, Aquatic: 0.4 } // AVONET Primary.Lifestyle (stratum)
  if (t.primary_lifestyle && LIFESTYLE[t.primary_lifestyle] != null) s = Math.max(s, LIFESTYLE[t.primary_lifestyle])
  return clamp01(s)
}

// The stubbed seams return null ("unknown") -> neutral sub-score. This is where the rich
// relationship/phenology tier activates once the reference layer ships.
async function neutralRelationship(context = {}) {
  const v = await relationshipSource.strength(null, context)
  return v == null ? N.neutralScore : clamp01(v)
}
async function neutralPhenology(species = null, date = null, coords = null) {
  const v = await phenologySource.alignment(species, date, coords)
  return v == null ? N.neutralScore : clamp01(v)
}
