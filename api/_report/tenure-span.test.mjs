// S1/S2 fix verification — pure unit tests (no network) for the observed-span refactor and the
// DST-safe peak-band anchor.
//
// S1: the query window is NEVER narrowed to first_heard_at, so a first-day node keeps its
//     midnight-stored pulses; tenure is carried separately in payload.observed.
// S2: peakBand anchors to LOCAL MIDNIGHT (the report day's window.start), not to first_heard_at,
//     and resolves the band's wall-clock start through the timezone so DST transitions are correct.

import { observedSpan, peakBand, localHourUtc, resolveDailyWindow } from './payload.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const CHICAGO = 'America/Chicago'

// ── observedSpan (S1) ────────────────────────────────────────────────────────
// A full-cadence window is NOT narrowed: the query keeps midnight-stored pulses.
const fullWindow = resolveDailyWindow('2026-11-04', CHICAGO)
const NOW = new Date('2026-11-05T12:00:00Z')

// Node with no tenure: observed == window, not clipped.
const noTenure = observedSpan(fullWindow, { first_heard_at: null }, NOW)
ok('no tenure: observed.start == window.start', noTenure.start === fullWindow.start)
ok('no tenure: not clipped', noTenure.clipped === false)

// First-day node (heartbeat at 19:22 UTC = 13:22 local): the QUERY window keeps local midnight
// (so the midnight-stored pulse is included); only `observed` is clipped to first_heard_at.
const firstDay = observedSpan(fullWindow, { first_heard_at: '2026-11-04T19:22:00Z' }, NOW)
ok('S1: window.start unchanged (still local midnight)', fullWindow.start === resolveDailyWindow('2026-11-04', CHICAGO).start)
ok('S1: observed.start clipped to first_heard_at', firstDay.start === '2026-11-04T19:22:00Z')
ok('S1: observed flagged clipped', firstDay.clipped === true)
ok('S1: observed.start != window.start', firstDay.start !== fullWindow.start)

// observed.end never extends past now (generation time) for an on-demand report.
const futureEnd = observedSpan({ start: '2026-11-04T00:00:00Z', end: '2026-11-05T00:00:00Z', cadence: 'daily' }, { first_heard_at: null }, new Date('2026-11-04T10:00:00Z'))
ok('observed.end capped at now', futureEnd.end === '2026-11-04T10:00:00.000Z')

// ── peakBand DST-safety (S2) ─────────────────────────────────────────────────
// Helper: histogram with a single 3-hour block of activity at local hour `h`.
const histAt = (h, n = 100) => { const a = new Array(24).fill(0); a[h] = n; a[(h + 1) % 24] = n; a[(h + 2) % 24] = n; return a }

// Partial first day (the S2 bug): node starts 13:22 local on 2026-11-04, peak at 14:00 local.
// dayStart (window.start) is local midnight, NOT first_heard_at. The band must anchor to midnight.
const partialMidnight = resolveDailyWindow('2026-11-04', CHICAGO).start
const peak14 = peakBand(histAt(14), partialMidnight, CHICAGO)
// 14:00 local in Chicago (CST, UTC-6) = 20:00 UTC.
ok('S2: partial first day peak anchors to local midnight, hour 14 = 20:00 UTC', peak14.start === '2026-11-04T20:00:00.000Z')
ok('S2: peak label reflects the local hour band (14:00 -> afternoon)', peak14.label === 'the afternoon')

// DST spring-forward day (US): 2026-03-08 in America/Chicago. Local 02:00 does not exist; clocks
// jump 02:00→03:00 (CST→CDT), so 08:00 local (CDT, UTC-5) is only 7 elapsed UTC hours after the
// 06:00-UTC midnight. Anchoring through the tz gives 13:00 UTC; a naive elapsed-hours add of 8h
// would give 14:00 UTC — one hour late. This is exactly the S2 corruption the fix prevents.
const dstMidnight = resolveDailyWindow('2026-03-08', CHICAGO).start
const dstPeak = peakBand(histAt(8), dstMidnight, CHICAGO)
ok('S2: DST spring-forward local 08:00 = 13:00 UTC', dstPeak.start === '2026-03-08T13:00:00.000Z')
// Sanity: the wall-clock start is resolved via the zone, not an elapsed-UTC-hours add. On this
// spring-forward day a naive +8h would give 14:00 UTC (one hour late); the correct answer is 13:00.
ok('S2: DST start is not the naive +8h UTC offset', dstPeak.start !== new Date(new Date(dstMidnight).getTime() + 8 * 3600000).toISOString())

// DST fall-back day (US): 2026-11-01 in America/Chicago (the ambiguous repeated hour). The
// resolver must still produce a valid instant for a post-transition local hour.
const fallMidnight = resolveDailyWindow('2026-11-01', CHICAGO).start
const fallPeak = peakBand(histAt(10), fallMidnight, CHICAGO)
// After the 02:00 fall-back Chicago is CST (UTC-6); 10:00 local -> 16:00 UTC.
ok('S2: DST fall-back local 10:00 = 16:00 UTC', fallPeak.start === '2026-11-01T16:00:00.000Z')

// localHourUtc: without a tz it degrades to the legacy fixed-offset behavior (midnight + h hours).
const noTz = localHourUtc('2026-11-04T00:00:00.000Z', 5, null)
ok('no-tz fallback = midnight + 5h', noTz === '2026-11-04T05:00:00.000Z')

// peakBand with no dayStart (seasonal/annual) returns label-only.
const labelOnly = peakBand(histAt(6), null, null)
ok('seasonal/annual peak is label-only (no instants)', labelOnly.start === null && labelOnly.end === null && typeof labelOnly.label === 'string')

// peakBand returns null on an empty histogram.
ok('empty histogram -> null', peakBand(new Array(24).fill(0), partialMidnight, CHICAGO) === null)

console.log(`tenure-span: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
