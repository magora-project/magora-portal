import { reportCadencesForTenure } from './report.js'

function ok(value, message) { if (!value) throw new Error(message) }
const ids = (firstHeardAt, now) => reportCadencesForTenure(firstHeardAt, now).map((c) => c.id).join(',')

const NOW = new Date('2026-11-05T12:00:00Z') // autumn (SON) began 2026-09-01; year began 2026-01-01

// Villa Magora (first heartbeat 2026-11-04): hides Season and Year.
ok(ids('2026-11-04T19:22:00Z', NOW) === 'daily', 'Villa Magora hides Season and Year')

// Casa Colibri (listening since June): keeps Season and Year.
ok(ids('2026-06-01T00:00:00Z', NOW) === 'daily,seasonal,annual', 'Casa Colibri keeps Season and Year')

// No heartbeat history at all: daily only.
ok(ids(null, NOW) === 'daily', 'no tenure hides Season and Year')

// In-period semantics: a node with 20 lifetime days but only 13 days into the season is gated
// server-side; the selector mirrors that (season boundary Sep 1, node began Sep 10).
const sep23 = new Date('2026-09-23T12:00:00Z')
ok(ids('2026-09-10T00:00:00Z', sep23) === 'daily', '13 days into the season hides Season')
const sep24 = new Date('2026-09-24T12:00:01Z')
ok(ids('2026-09-10T00:00:00Z', sep24) === 'daily,seasonal', '14 days into the season shows Season')

// Annual gate: 58 days into the year is hidden, 60 is shown. (At these dates the season — MAM
// from Mar 1 — has only 3–5 days of tenure, so Season stays hidden even though Year appears.)
ok(ids('2026-01-05T00:00:00Z', new Date('2026-03-04T12:00:00Z')) === 'daily', '58 days into the year hides Year')
ok(ids('2026-01-05T00:00:00Z', new Date('2026-03-06T00:00:01Z')) === 'daily,annual', '60 days into the year shows Year')

console.log('report cadence tenure tests passed')
