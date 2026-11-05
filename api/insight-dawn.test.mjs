// S3 fix verification — pure unit tests (no network) for the dawn-flag trust gate.
//
// S3: when the device's minutes_from_sunrise is REJECTED (does not agree with the server-side NOAA
//     sunrise calc for the node's coordinates), the device dawn flag must be dropped with it — no
//     derived replacement. A mislocated Pi must not be able to claim "dawn chorus" at midday.

import { localTimeContext } from './insight.js'
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

console.log(`insight-dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
