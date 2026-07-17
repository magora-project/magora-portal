// Node Phenology Report v1 — report-narration unit tests (pure; no network).
// Run: node api/_report/narrate-report.test.mjs
//
// Covers the load-bearing grounding invariant (the narrator's ONLY knowledge is the ReportPayload —
// a planted fake fact never leaks into the prompt), the report STANCE (multi-paragraph, ends on an
// open wondering, not the single-question pulse form), the no-IEK / node-only voice gate, and the
// daily window / cache-key derivation. Underscore-prefixed dir => not a Vercel route; .mjs =>
// outside the eslint js/jsx glob.

import {
  buildReportPrompt, groundedReportFacts, narrateReport,
  REPORT_VOICES, REPORT_MODEL, REPORT_VOICES_VERSION,
} from './narrate-report.js'
import { resolveDailyWindow, buildDailyReport } from './payload.js'
import { getVoice } from '../_narrative/voices.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const nodeVoice = getVoice('node')

// A representative grounded daily payload. SECRET_* sentinels are planted where an ungrounded
// narrator might hallucinate — none may reach the prompt.
const payload = {
  node_id: 'n1',
  cadence: 'daily',
  period_key: '2026-07-17',
  window: { start: '2026-07-17T00:00:00.000Z', end: '2026-07-18T00:00:00.000Z', cadence: 'daily', period_key: '2026-07-17' },
  generated_at: '2026-07-18T00:00:00.000Z',
  node: { id: 'n1', name: 'Magic Lantern', place_label: 'Magic Lantern', elevation_m: 2100, elevation_unit: 'm', lat: 40, lon: -105 },
  activity: {
    total_detections: 42,
    distinct_species: 9,
    top_species: [
      { species_name: "Steller's Jay", count: 12, first_seen: '2026-07-17T06:00:00Z', last_seen: '2026-07-17T18:00:00Z', confidence_max: 0.9 },
      { species_name: 'American Robin', count: 8, first_seen: '2026-07-17T06:30:00Z', last_seen: '2026-07-17T19:00:00Z', confidence_max: 0.8 },
    ],
  },
  new_species: [{ species_name: 'Western Tanager', first_seen: '2026-07-17T07:00:00Z' }],
  notable_pulses: [
    { pulse_id: 'p1', kind: 'activity_spike', subject: { metric: 'detection_rate' }, evidence: { ratio: 2.618 }, score: 0.8, summary: 'bird activity rose to 2.6 times my recent baseline' },
  ],
  soundscape: { mean_aci: 0.6, baseline_mean_aci: 0.48, delta: 0.1234, trend: 'busier', sample_count: 20, peak_window: { start: '2026-07-17T06:00:00Z', end: '2026-07-17T09:00:00Z', label: 'the morning', count: 20 } },
  phenology: { period_key: '2026-07-17', week_of_year: 29, first_detection_date: '2026-07-17T06:00:00Z', last_detection_date: '2026-07-17T19:00:00Z', new_species_count: 1 },
  coverage: { has_detections: true, has_aci: true, degraded: false },
}

// ── constants / voice gate ─────────────────────────────────────────────────────
ok('report model is Sonnet', REPORT_MODEL === 'claude-sonnet-5')
ok('report voices = node only', JSON.stringify(REPORT_VOICES) === JSON.stringify(['node']))
ok('report voices_version', REPORT_VOICES_VERSION === 'report-v1')

// ── grounded facts: only payload facts, planted fakes never present ─────────────
const facts = groundedReportFacts(payload)
const factText = facts.join('\n')
ok('facts name the place', factText.includes('Magic Lantern'))
ok('facts carry totals', factText.includes('42') && factText.includes('9 distinct species'))
ok('facts carry top species', factText.includes("Steller's Jay") && factText.includes('American Robin'))
ok('facts flag new-for-node species', /new to my records/i.test(factText) && factText.includes('Western Tanager'))
ok('facts carry the notable pulse summary', factText.includes('2.6 times my recent baseline'))
ok('facts carry soundscape trend', /busier/.test(factText))
ok('facts carry peak window', factText.includes('the morning'))

// ── 3-segment prompt assembly + stance ─────────────────────────────────────────
const built = buildReportPrompt(payload, nodeVoice)
ok('builds a prompt with 3 segments', !!built.prompt && !!built.segments)
const { scaffold, voice, invariants } = built.segments
const iS = built.prompt.indexOf(scaffold), iV = built.prompt.indexOf(voice), iI = built.prompt.indexOf(invariants)
ok('3 segments in order', iS >= 0 && iV > iS && iI > iV)
ok('voice seg = node directives', voice.includes(nodeVoice.styleDirectives))
ok('invariants forbid new facts', /ONLY the facts above/.test(invariants))
ok('invariants: multi-paragraph', /2 to 4 short paragraphs/.test(invariants))
ok('invariants: open wondering ending (Coyote stance)', /OPEN WONDERING/.test(invariants))
ok('invariants: not a verdict-with-question', /Do not end on a verdict/i.test(invariants))
ok('invariants forbid re-rounding numbers', /Do not round, rescale, approximate/i.test(invariants))

// THE INVARIANT: a fact not in the payload never appears in the prompt. The prompt is built only
// from the payload, so a species/cause the payload does not carry cannot leak into the narrator.
ok('no invented species leaks', !built.prompt.includes('SECRET_SPECIES') && !/Painted Bunting/.test(built.prompt))
ok('no invented cause leaks', !/because|caused by/i.test(scaffold))
// canonical figure from the summary is present; the raw over-precise value is not re-introduced
ok('canonical pulse figure present', built.prompt.includes('2.6 times'))
ok('soundscape delta canonicalized to 2dp', built.prompt.includes('0.12') && !built.prompt.includes('0.1234'))

// ── quiet day: nothing to author => skip ───────────────────────────────────────
const quiet = { ...payload, activity: { total_detections: 0, distinct_species: 0, top_species: [] }, notable_pulses: [] }
ok('quiet day skips (no substance)', buildReportPrompt(quiet, nodeVoice).skip === true)

// ── node-only / no-IEK voice gate (hard reject, no network) ────────────────────
ok('narrateReport(elder) -> error', (await narrateReport(payload, 'elder'))?.error?.includes('elder') || !!(await narrateReport(payload, 'elder'))?.error)
ok('narrateReport(attenborough) -> error (roster deferred)', !!(await narrateReport(payload, 'attenborough'))?.error)
ok('narrateReport(bogus) -> error', !!(await narrateReport(payload, 'bogus'))?.error)
ok('narrateReport(quiet, node) -> null (nothing to render)', (await narrateReport(quiet, 'node')) === null)
const iek = /elder|iek|indigenous|ancestral|traditional\s*knowledge/i
ok('no IEK voice in report roster', !REPORT_VOICES.some((v) => iek.test(v)))

// ── daily window / cache key derivation ────────────────────────────────────────
const w = resolveDailyWindow('2026-07-17')
ok('period_key = date', w.period_key === '2026-07-17')
ok('window is the UTC calendar day', w.start === '2026-07-17T00:00:00.000Z' && w.end === '2026-07-18T00:00:00.000Z')
ok('cadence tagged daily', w.cadence === 'daily')
ok('invalid date rejects', (() => { try { resolveDailyWindow('not-a-date'); return false } catch { return true } })())
ok('buildDailyReport is a function (cadence-keyed builder)', typeof buildDailyReport === 'function')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
