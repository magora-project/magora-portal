// Node Phenology Report — label-quality classifier + partition-narration tests (pure; no network).
// Run: node api/_report/labels.test.mjs
//
// Covers: classifyLabel across the three classes (taxonomy-derived + curated fallback + the
// bias-to-voice default); and that the narration reframes anthropophony as ambient human-activity
// context while biophony stays a voice — grounded only in the human_activity field.

import { classifyLabel, isVoice, ANTHROPOPHONY_LABELS } from './labels.js'
import { groundedReportFacts, buildReportPrompt } from './narrate-report.js'
import { getVoice } from '../_narrative/voices.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

// ── classifier: birds ──────────────────────────────────────────────────────────
ok('robin (ebird_code) -> bird', classifyLabel({ common_name: 'American Robin', ebird_code: 'amerob', scientific_name: 'Turdus migratorius' }) === 'bird')
ok('ebird_code wins over null sci', classifyLabel({ common_name: 'Song Sparrow', ebird_code: 'sonspa', scientific_name: null }) === 'bird')
ok('taxon_class Aves -> bird', classifyLabel({ common_name: 'Some Bird', taxon_class: 'Aves' }) === 'bird')

// ── classifier: biophony (real organisms, binomial sci, no ebird_code) ──────────
ok('katydid -> biophony', classifyLabel({ common_name: 'Fork-tailed Bush Katydid', ebird_code: null, scientific_name: 'Scudderia furcata' }) === 'biophony')
ok('gray wolf -> biophony (wild canid)', classifyLabel({ common_name: 'Gray Wolf', scientific_name: 'Canis lupus' }) === 'biophony')
ok('bullfrog -> biophony', classifyLabel({ common_name: 'American Bullfrog', scientific_name: 'Lithobates catesbeianus' }) === 'biophony')
ok('coyote -> biophony', classifyLabel({ common_name: 'Coyote', scientific_name: 'Canis latrans' }) === 'biophony')

// ── classifier: anthropophony (curated set; taxonomy absent or noise) ───────────
ok('Human non-vocal -> anthropophony', classifyLabel({ common_name: 'Human non-vocal', scientific_name: 'Human non-vocal' }) === 'anthropophony')
ok('Engine (no row) -> anthropophony', classifyLabel({ common_name: 'Engine' }) === 'anthropophony')
ok('Siren (no row) -> anthropophony', classifyLabel({ common_name: 'Siren' }) === 'anthropophony')
ok('case-insensitive curated match', classifyLabel({ common_name: 'HUMAN NON-VOCAL' }) === 'anthropophony')
ok('Dog: curated wins even with a binomial sci', classifyLabel({ common_name: 'Dog', scientific_name: 'Canis familiaris' }) === 'anthropophony')

// ── the bias: ambiguous ALWAYS -> biophony (a voice), never silenced ────────────
ok('unknown but binomial sci -> biophony', classifyLabel({ common_name: 'Mystery Beetle', scientific_name: 'Xylocopa mysterius' }) === 'biophony')
ok('unknown, no signal at all -> biophony (bias to voice)', classifyLabel({ common_name: 'Totally Unknown Label' }) === 'biophony')
ok('empty -> biophony (never silences)', classifyLabel({}) === 'biophony')

// ── isVoice ──────────────────────────────────────────────────────────────────────
ok('isVoice(bird)', isVoice('bird') === true)
ok('isVoice(biophony)', isVoice('biophony') === true)
ok('isVoice(anthropophony) false', isVoice('anthropophony') === false)
ok('curated set has the known BirdNET noise classes', ANTHROPOPHONY_LABELS.has('human non-vocal') && ANTHROPOPHONY_LABELS.has('engine') && ANTHROPOPHONY_LABELS.has('siren'))

// ── narration: anthropophony reframed as context; biophony stays a voice ────────
const nodeVoice = getVoice('node')
const payload = {
  node_id: 'n', cadence: 'daily', period_key: '2026-07-10',
  window: { start: '2026-07-10T00:00:00.000Z', end: '2026-07-11T00:00:00.000Z', cadence: 'daily', period_key: '2026-07-10' },
  generated_at: '2026-07-11T00:00:00.000Z',
  node: { id: 'n', name: 'birdnode11', place_label: 'birdnode11', elevation_m: null, elevation_unit: 'ft', lat: 45, lon: -110 },
  activity: {
    total_detections: 100, distinct_species: 3,
    // a biophony voice (katydid) sits among the top species — it MUST be narrated as a voice
    top_species: [
      { species_name: 'Song Sparrow', count: 60, first_seen: '2026-07-10T06:00:00Z', last_seen: '2026-07-10T18:00:00Z', confidence_max: 0.9 },
      { species_name: 'Fork-tailed Bush Katydid', count: 30, first_seen: '2026-07-10T21:00:00Z', last_seen: '2026-07-10T23:00:00Z', confidence_max: 0.7 },
    ],
  },
  new_species: [],
  notable_pulses: [],
  soundscape: { mean_aci: 0.5, baseline_mean_aci: 0.5, delta: 0, trend: 'steady', sample_count: 100, peak_window: { start: null, end: null, label: 'the morning', count: 60 } },
  human_activity: { count: 12, distinct_types: 1, types: [{ label: 'Human non-vocal', count: 12 }] },
  phenology: { period_key: '2026-07-10', week_of_year: 28, first_detection_date: '2026-07-10T06:00:00Z', last_detection_date: '2026-07-10T23:00:00Z', new_species_count: 0 },
  coverage: { has_detections: true, has_aci: true, degraded: false },
}
const facts = groundedReportFacts(payload).join('\n')
ok('katydid (biophony) kept as a voice in top species', /species I heard most:.*Fork-tailed Bush Katydid/.test(facts))
ok('human noise reframed as human-presence context', /human presence/.test(facts) && /human or machine noise/.test(facts) && facts.includes('Human non-vocal'))
ok('human noise NOT in the species-most line', !/species I heard most:[^\n]*Human non-vocal/.test(facts))
const prompt = buildReportPrompt(payload, nodeVoice)
ok('invariant: human noise is ambient context, never a voice', /human or machine noise \(human presence\)/i.test(prompt.segments.invariants) || /never name it as one of your voices/i.test(prompt.segments.invariants))
ok('prompt still ends-on-wondering rule intact', /OPEN WONDERING/.test(prompt.segments.invariants))

// no human_activity -> no context line
const quietHuman = { ...payload, human_activity: { count: 0, distinct_types: 0, types: [] } }
ok('no human activity -> no human-presence line', !/human presence/.test(groundedReportFacts(quietHuman).join('\n')))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
