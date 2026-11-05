// Report narration tenure/local-time framing — pure unit tests (no network), pinned against the
// 2026-11-05 TaskDef: period_key renders the node's LOCAL calendar date unshifted; a window
// clipped to first_heard_at states its real span; "new to my records" is suppressed on day one.
import { groundedReportFacts } from './narrate-report.js'

function ok(condition, message) { if (!condition) throw new Error(message) }

function dailyPayload(overrides = {}) {
  return {
    node_id: 'n', cadence: 'daily', period_key: '2026-11-04',
    window: { start: '2026-11-04T06:00:00.000Z', end: '2026-11-05T06:00:00.000Z', cadence: 'daily', period_key: '2026-11-04' },
    time_zone: 'America/Chicago',
    tenure: { first_heard_at: '2026-10-01T00:00:00Z', hours_listening: 800, days_listening: 34 },
    generated_at: '2026-11-05T02:00:00.000Z',
    node: { id: 'n', name: 'Villa Magora', place_label: 'Villa Magora', elevation_m: null, elevation_unit: 'ft', lat: 29.27, lon: -103.23 },
    activity: { total_detections: 0, distinct_species: 0, top_species: [] },
    new_species: [],
    notable_pulses: [],
    soundscape: {},
    human_activity: { count: 0, distinct_types: 0, types: [] },
    phenology: { period_key: '2026-11-04', week_of_year: 45 },
    coverage: { has_detections: false, has_aci: true, degraded: true },
    ...overrides,
  }
}

// 1. period_key is the node's local date; it must not shift back a day in a western zone.
const facts = groundedReportFacts(dailyPayload())
ok(facts.some((l) => l.includes('my record of November 4, 2026')), 'local period_key renders unshifted (Nov 4, not Nov 3)')

// 2. Clipped daily window (start == first_heard_at) states the real span in hours, capped at
// generated_at — the period end is in the future for an on-demand report and must not count.
const clipped = groundedReportFacts(dailyPayload({
  window: { start: '2026-11-04T19:22:00.000Z', end: '2026-11-05T06:00:00.000Z', cadence: 'daily', period_key: '2026-11-04' },
  tenure: { first_heard_at: '2026-11-04T19:22:00.000Z', hours_listening: 10.6, days_listening: 0.44 },
  generated_at: '2026-11-05T02:00:00.000Z', // 6.6h after first heartbeat; period ends 06:00
}))
ok(clipped.some((l) => l.includes('6.6 hours of listening')), 'clipped span caps at generated_at, not the future period end')
ok(!clipped.some((l) => l.includes('across the day')), 'clipped window does not claim a full day')

// 3. First-day node: "new to my records" framing is suppressed even with new species.
const firstDay = groundedReportFacts(dailyPayload({
  tenure: { first_heard_at: '2026-11-04T19:22:00.000Z', hours_listening: 10.6, days_listening: 0.44 },
  new_species: [{ species_name: 'Virginia Rail', first_seen: '2026-11-04T20:21:00Z' }],
}))
ok(!firstDay.some((l) => /new to my records/i.test(l)), 'first day suppresses new-to-my-records')

// 4. After the first day the phrase returns.
const secondDay = groundedReportFacts(dailyPayload({
  tenure: { first_heard_at: '2026-11-03T19:22:00.000Z', hours_listening: 30, days_listening: 1.25 },
  new_species: [{ species_name: 'Virginia Rail', first_seen: '2026-11-04T20:21:00Z' }],
}))
ok(secondDay.some((l) => /new to my records/i.test(l)), 'second day restores new-to-my-records')

// 5. Clipped seasonal window states the span in days up to generated_at, not the whole season.
const seasonal = groundedReportFacts(dailyPayload({
  cadence: 'seasonal', period_key: '2026-autumn',
  window: { start: '2026-10-20T00:00:00Z', end: '2026-12-01T00:00:00.000Z', cadence: 'seasonal', period_key: '2026-autumn' },
  tenure: { first_heard_at: '2026-10-20T00:00:00Z', hours_listening: 1000, days_listening: 42 },
  phenology: { period_key: '2026-autumn', season: 'autumn', season_year: 2026 },
}))
// generated_at is 2026-11-05: Oct 20 → Nov 5 = 16 days; the unelapsed remainder of the season
// (through Dec 1) must not be claimed as listening.
ok(seasonal.some((l) => l.includes('16 days since I began listening')), 'clipped season states days since first heartbeat, capped at generated_at')
ok(!seasonal.some((l) => l.includes('across this season I')), 'clipped season does not claim the full season span')

console.log('report-tenure narration tests passed')
