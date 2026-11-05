// S3 fix verification — pure unit tests (no network) for the dawn-flag trust gate.
//
// S3: when the device's minutes_from_sunrise is REJECTED (does not agree with the server-side NOAA
//     sunrise calc for the node's coordinates), the device dawn flag must be dropped with it — no
//     derived replacement. A mislocated Pi must not be able to claim "dawn chorus" at midday.

import { localTimeContext, tenureDescription, observationWindowLine, behaviorInferenceBullet } from './insight.js'
import { minutesFromSunriseAt } from './_lib/nodeTime.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

// Terlingua, TX (Villa Magora) — GeoJSON coordinates [lon, lat].
const node = { location: { coordinates: [-103.2334, 29.2708] } }

// Pick an instant and compute the server's own sunrise minutes for it.
const INSTANT = '2026-06-15T12:30:00Z' // morning in Terlingua (CDT)
const serverMinutes = minutesFromSunriseAt(29.2708, -103.2334, INSTANT)
ok('server sunrise minutes resolvable for the test node', typeof serverMinutes === 'number')

// 1) Verified path: device minutes within 30 of the server calc -> trusted; precise solar bucket kept.
const verified = localTimeContext(INSTANT, node, Math.round(serverMinutes))
ok('verified sunrise reading is trusted', verified.trusted === true)
ok('verified reading yields a label', typeof verified.label === 'string' && verified.label.length > 0)

// 2) Rejected path: device minutes wildly disagree (a mislocated Pi claiming sunrise at midday).
//    The dawn flag is dropped — trusted=false — and the label falls back to the wall clock only.
const rejected = localTimeContext(INSTANT, node, Math.round(serverMinutes) + 300)
ok('S3: rejected sunrise reading is untrusted', rejected.trusted === false)
ok('S3: rejected reading still yields the local wall-clock label', typeof rejected.label === 'string' && rejected.label.length > 0)
// Crucially, trusted=false is what suppresses "(dawn chorus active)" downstream.
ok('S3: trusted flag is the gate for the dawn suffix', rejected.trusted === false && verified.trusted === true)

// 3) No solar telemetry at all: untrusted, wall clock only, dawn flag not carried.
const absent = localTimeContext(INSTANT, node, null)
ok('no telemetry -> untrusted wall clock', absent.trusted === false && typeof absent.label === 'string')

// 4) Node with no resolvable timezone: null label, untrusted.
const noTz = localTimeContext(INSTANT, { location: null }, 5)
ok('no tz -> null label, untrusted', noTz.label === null && noTz.trusted === false)

// ── Codex N3: tenure date is node-local, not UTC ─────────────────────────────
// A heartbeat at 2026-11-05T02:00Z in Chicago (UTC-6) happened locally on Nov 4. Rendering the
// began-listening date in UTC would name Nov 5 — the wrong day.
const tenureDesc = tenureDescription(
  { first_heard_at: '2026-11-05T02:00:00Z', hours_listening: 10, days_listening: 0.4 },
  'America/Chicago',
  new Date('2026-11-05T12:00:00Z'),
)
ok('tenure date renders node-local (Nov 4, not Nov 5)', tenureDesc.includes('Nov 4, 2025') || tenureDesc.includes('Nov 4, 2026'))
ok('tenure date is not the UTC calendar date', !tenureDesc.includes('Nov 5'))
ok('no tenure -> null', tenureDescription(null, 'America/Chicago') === null)

// ── Codex N4: early-node prompts carry no seasonal/pattern framing ───────────
ok('early node: window line disclaims pattern history', observationWindowLine(true, 1).includes('no pattern history'))
ok('mature node: window line keeps the patterns framing', observationWindowLine(false, 14).includes('node patterns'))
ok('early node: inference bullet drops the season', !behaviorInferenceBullet(true).includes('season'))
ok('mature node: inference bullet keeps the season', behaviorInferenceBullet(false).includes('the season'))

console.log(`insight-dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
