// Node Phenology Report v1.1 — seasonal / annual / cron unit tests (pure; no network).
// Run: node api/_report/report-v11.test.mjs
//
// Covers: hemisphere-aware meteorological season resolution + period_key round-trips; cadence
// dispatch; cadence-aware grounded narration (seasonal arrivals/departures/week-over-week; annual
// seasonal-breakdown/milestone) with the grounding invariant held across cadences (a planted fake
// fact never leaks); and the cron's completed-period reference. The read-only-seasonal and
// alert-suppression behaviors are exercised in the live cron verification (they need a live
// pulseBatch/DB); here we assert the pure contracts that guard them.

import {
  resolveSeasonalWindow, resolveAnnualWindow, resolvePeriodKey, buildReport,
  buildSeasonalReport, buildAnnualReport, REPORT_CADENCES,
} from './payload.js'
import { groundedReportFacts, buildReportPrompt, narrateReport } from './narrate-report.js'
import { completedPeriodRef } from '../report-cron.js'
import { getVoice } from '../_narrative/voices.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const nodeVoice = getVoice('node')

// ── hemisphere-aware meteorological seasons ────────────────────────────────────
const nSummer = resolveSeasonalWindow('2026-summer', 45) // N: JJA
ok('N summer = JJA window', nSummer.start === '2026-06-01T00:00:00.000Z' && nSummer.end === '2026-09-01T00:00:00.000Z')
ok('N summer period_key', nSummer.period_key === '2026-summer')
const sSummer = resolveSeasonalWindow('2026-summer', -33) // S: DJF (Dec 2025 → Mar 2026)
ok('S summer = DJF window (spans year)', sSummer.start === '2025-12-01T00:00:00.000Z' && sSummer.end === '2026-03-01T00:00:00.000Z')
ok('S summer period_key still 2026-summer', sSummer.period_key === '2026-summer')

// from a date within the season
const fromJul = resolveSeasonalWindow('2026-07-15', 45)
ok('N July date → summer', fromJul.period_key === '2026-summer' && fromJul.start === '2026-06-01T00:00:00.000Z')
const fromJan = resolveSeasonalWindow('2026-01-15', 45) // N winter = DJF, season year 2026
ok('N Jan date → 2026-winter DJF', fromJan.period_key === '2026-winter' && fromJan.start === '2025-12-01T00:00:00.000Z' && fromJan.end === '2026-03-01T00:00:00.000Z')
const fromDec = resolveSeasonalWindow('2026-12-10', 45) // Dec → winter of NEXT season year (2027)
ok('N Dec date → 2027-winter', fromDec.period_key === '2027-winter')

// ── annual ─────────────────────────────────────────────────────────────────────
const yr = resolveAnnualWindow('2026')
ok('annual window', yr.start === '2026-01-01T00:00:00.000Z' && yr.end === '2027-01-01T00:00:00.000Z' && yr.period_key === '2026')
ok('annual from date', resolveAnnualWindow('2026-07-15').period_key === '2026')

// ── resolvePeriodKey (cache key derivation) ─────────────────────────────────────
ok('key daily', resolvePeriodKey('daily', '2026-07-15') === '2026-07-15')
ok('key seasonal (needs lat)', resolvePeriodKey('seasonal', '2026-07-15', 45) === '2026-summer')
ok('key seasonal S hemisphere', resolvePeriodKey('seasonal', '2026-07-15', -33) === '2026-winter')
ok('key annual', resolvePeriodKey('annual', '2026-07-15') === '2026')
ok('period keys are deterministic (idempotency)', resolvePeriodKey('seasonal', '2026-07-15', 45) === resolvePeriodKey('seasonal', '2026-08-30', 45))

// ── cadence dispatch ────────────────────────────────────────────────────────────
ok('REPORT_CADENCES', JSON.stringify(REPORT_CADENCES) === JSON.stringify(['daily', 'seasonal', 'annual']))
ok('buildReport dispatches (functions)', typeof buildSeasonalReport === 'function' && typeof buildAnnualReport === 'function')
ok('buildReport rejects unknown cadence', (() => { try { buildReport('n', 'decade'); return false } catch { return true } })())

// ── seasonal payload → cadence-aware grounded narration ─────────────────────────
const seasonal = {
  node_id: 'n', cadence: 'seasonal', period_key: '2026-summer',
  window: { start: '2026-06-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z', cadence: 'seasonal', period_key: '2026-summer' },
  generated_at: '2026-09-01T00:00:00.000Z',
  node: { id: 'n', name: 'birdnode11', place_label: 'birdnode11', elevation_m: null, elevation_unit: 'ft', lat: 45, lon: -110 },
  activity: { total_detections: 5000, distinct_species: 42, top_species: [{ species_name: 'Song Sparrow', count: 1200, first_seen: '2026-06-01T06:00:00Z', last_seen: '2026-08-30T18:00:00Z', confidence_max: 0.94 }] },
  new_species: [{ species_name: 'Western Tanager', first_seen: '2026-06-15T07:00:00Z' }],
  notable_pulses: [{ pulse_id: 'p', kind: 'activity_spike', subject: {}, evidence: { ratio: 2.6 }, score: 0.8, summary: 'bird activity rose to 2.6 times my recent baseline' }],
  soundscape: { mean_aci: 0.6, baseline_mean_aci: 0.5, delta: 0.1, trend: 'busier', sample_count: 1000, peak_window: { start: null, end: null, label: 'the morning', count: 800 }, edge_days: 14 },
  phenology: {
    period_key: '2026-summer', season: 'summer', season_year: 2026,
    arrivals: [{ species_name: 'Yellow Warbler', first_seen: '2026-06-02T06:00:00Z' }],
    departures: [{ species_name: 'Pine Siskin', last_seen: '2026-06-20T06:00:00Z' }],
    weekly: [{ week_start: '2026-06-01', detections: 300, distinct_species: 20 }, { week_start: '2026-08-24', detections: 450, distinct_species: 28 }],
    first_detection_date: '2026-06-01T06:00:00Z', last_detection_date: '2026-08-30T18:00:00Z', new_species_count: 1,
  },
  coverage: { has_detections: true, has_aci: true, degraded: false },
}
const sFacts = groundedReportFacts(seasonal).join('\n')
ok('seasonal: record framing', sFacts.includes('my record of summer 2026'))
ok('seasonal: span "across this season"', sFacts.includes('across this season'))
ok('seasonal: arrivals w/ dates', /earliest voices of the season/.test(sFacts) && sFacts.includes('Yellow Warbler') && sFacts.includes('June 2'))
ok('seasonal: departures', /last heard earliest/.test(sFacts) && sFacts.includes('Pine Siskin'))
ok('seasonal: week-over-week', sFacts.includes('300 detections') && sFacts.includes('450') && sFacts.includes('20 species') && sFacts.includes('28'))
ok('seasonal: new-of-season phrase', /before this season/.test(sFacts) && sFacts.includes('Western Tanager'))
const sPrompt = buildReportPrompt(seasonal, nodeVoice)
ok('seasonal: scaffold header THIS SEASON', sPrompt.segments.scaffold.includes('WHAT I NOTICED THIS SEASON'))
ok('seasonal: spanNoun "a season"', sPrompt.segments.scaffold.includes('report of a season'))
ok('seasonal: 2-4 paragraphs', /2 to 4 short paragraphs/.test(sPrompt.segments.invariants))
ok('seasonal: open-wondering rule intact', /OPEN WONDERING/.test(sPrompt.segments.invariants))

// ── annual payload → cadence-aware grounded narration ───────────────────────────
const annual = {
  node_id: 'n', cadence: 'annual', period_key: '2026',
  window: { start: '2026-01-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z', cadence: 'annual', period_key: '2026' },
  generated_at: '2027-01-01T00:00:00.000Z',
  node: { id: 'n', name: 'birdnode11', place_label: 'birdnode11', elevation_m: null, elevation_unit: 'ft', lat: 45, lon: -110 },
  activity: { total_detections: 40000, distinct_species: 78, top_species: [{ species_name: 'Song Sparrow', count: 9000, first_seen: '2026-01-05T06:00:00Z', last_seen: '2026-12-20T18:00:00Z', confidence_max: 0.95 }] },
  new_species: [{ species_name: 'Western Tanager', first_seen: '2026-06-15T07:00:00Z' }],
  notable_pulses: [],
  soundscape: { mean_aci: 0.62, baseline_mean_aci: 0.55, delta: 0.07, trend: 'busier', sample_count: 1000, peak_window: { start: null, end: null, label: 'the morning', count: 5000 }, edge_days: 30 },
  phenology: {
    period_key: '2026', year: 2026,
    seasonal_breakdown: [{ season: 'winter', detections: 100, distinct_species: 10 }, { season: 'summer', detections: 5000, distinct_species: 42 }],
    milestone: { total_species_all_time: 87, new_species_this_year: 5 },
    first_detection_date: '2026-01-05T06:00:00Z', last_detection_date: '2026-12-20T18:00:00Z', new_species_count: 1,
  },
  coverage: { has_detections: true, has_aci: true, degraded: false },
}
const aFacts = groundedReportFacts(annual).join('\n')
ok('annual: record framing', aFacts.includes('my record of the year 2026'))
ok('annual: span "over the year"', aFacts.includes('over the year'))
ok('annual: seasonal breakdown', /season by season/.test(aFacts) && aFacts.includes('winter held 100 detections across 10 species') && aFacts.includes('summer held 5000'))
ok('annual: milestone', aFacts.includes('87 distinct species have now been recorded') && aFacts.includes('5 of them first heard this year'))
const aPrompt = buildReportPrompt(annual, nodeVoice)
ok('annual: scaffold header THIS YEAR', aPrompt.segments.scaffold.includes('WHAT I NOTICED THIS YEAR'))
ok('annual: spanNoun "a year"', aPrompt.segments.scaffold.includes('report of a year'))
ok('annual: 3-5 paragraphs (most narrative cadence)', /3 to 5 short paragraphs/.test(aPrompt.segments.invariants))

// ── THE INVARIANT across cadences: a fact not in the payload never leaks ─────────
for (const [name, p] of [['seasonal', seasonal], ['annual', annual]]) {
  const prompt = buildReportPrompt(p, nodeVoice).prompt
  ok(`${name}: no invented species leaks`, !/Great Blue Heron|SECRET_/.test(prompt))
  ok(`${name}: no invented cause leaks in scaffold`, !/because|caused by/i.test(buildReportPrompt(p, nodeVoice).segments.scaffold))
  ok(`${name}: numbers used verbatim rule`, /Do not round, rescale, approximate/.test(buildReportPrompt(p, nodeVoice).segments.invariants))
}

// ── voice gate unchanged across cadences (node only; elder/roster reject) ────────
ok('narrateReport(seasonal, elder) rejects', !!(await narrateReport(seasonal, 'elder'))?.error)
ok('narrateReport(annual, attenborough) rejects', !!(await narrateReport(annual, 'attenborough'))?.error)

// ── quiet period skips at every cadence ──────────────────────────────────────────
const quietSeasonal = { ...seasonal, activity: { total_detections: 0, distinct_species: 0, top_species: [] }, notable_pulses: [] }
ok('quiet seasonal skips', buildReportPrompt(quietSeasonal, nodeVoice).skip === true)

// ── cron completed-period reference ──────────────────────────────────────────────
ok('cron daily → yesterday', completedPeriodRef('daily', new Date('2026-07-17T10:00:00Z')) === '2026-07-16')
ok('cron annual → last year', completedPeriodRef('annual', new Date('2027-01-01T12:00:00Z')) === '2026')
const seasonalRef = completedPeriodRef('seasonal', new Date('2026-06-01T11:00:00Z')) // fires at MAM→JJA boundary
ok('cron seasonal → date inside just-ended season (MAM)', resolvePeriodKey('seasonal', seasonalRef, 45) === '2026-spring')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
