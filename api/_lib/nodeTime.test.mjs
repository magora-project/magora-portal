import { nodeTimeZone, toNodeLocal, nodeDayWindow, minutesFromSunriseAt } from './nodeTime.js'

function ok(condition, message) { if (!condition) throw new Error(message) }

ok(nodeTimeZone({ location: { coordinates: [-103.2334, 29.2708] } }) === 'America/Chicago', 'Terlingua zone')
ok(nodeTimeZone({ location: { coordinates: [-110.8243, 45.0318] } }) === 'America/Denver', 'Gardiner zone')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').date === '2026-07-04', 'Terlingua local date')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').hour === 13, 'Terlingua local hour')
ok(JSON.stringify(nodeDayWindow('2026-03-08', 'America/Chicago')) === JSON.stringify(['2026-03-08T06:00:00.000Z', '2026-03-09T05:00:00.000Z']), 'spring DST day is 23 hours')
ok(JSON.stringify(nodeDayWindow('2026-11-01', 'America/Chicago')) === JSON.stringify(['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z']), 'fall DST day is 25 hours')
ok(nodeTimeZone({ location: { coordinates: [0, 0] } }) === 'Etc/GMT', 'solar fallback has valid fallback shape')

// Solar fallback sign: Etc/GMT is POSIX-inverted, so a western longitude yields Etc/GMT+N (UTC-N).
// tz-lookup throws on out-of-range latitude, which exercises the fallback path.
ok(nodeTimeZone({ location: { coordinates: [-105, 91] } }) === 'Etc/GMT+7', 'western longitude falls back to Etc/GMT+7 (UTC-7)')
ok(nodeTimeZone({ location: { coordinates: [105, 91] } }) === 'Etc/GMT-7', 'eastern longitude falls back to Etc/GMT-7 (UTC+7)')
ok(toNodeLocal('2026-07-04T19:00:00Z', 'Etc/GMT+7').hour === 12, 'Etc/GMT+7 is UTC-7')

// Server-side sunrise check (NOAA approximation). Terlingua sunrise on 2026-07-04 is ~05:00 MDT
// (11:00 UTC); Gardiner sunrise on 2026-01-15 is ~07:45 MST (14:45 UTC). Assertions use
// near-sunrise instants — the only range the value is used to validate Pi telemetry.
const julyMorning = minutesFromSunriseAt(29.2708, -103.2334, '2026-07-04T13:30:00Z')
ok(julyMorning > 60 && julyMorning < 300, 'Terlingua July mid-morning is 1-5h after sunrise')
const julyPreDawn = minutesFromSunriseAt(29.2708, -103.2334, '2026-07-04T09:30:00Z')
ok(julyPreDawn < -60 && julyPreDawn > -180, 'Terlingua July 09:30 UTC is 1-3h before sunrise')
const janPreDawn = minutesFromSunriseAt(45.0318, -110.8243, '2026-01-15T13:45:00Z')
ok(janPreDawn < -30 && janPreDawn > -120, 'Gardiner January 13:45 UTC is ~1h before sunrise')
ok(minutesFromSunriseAt(89, 0, '2026-06-21T12:00:00Z') === null, 'polar day has no sunrise')
ok(minutesFromSunriseAt(NaN, 0, '2026-07-04T12:00:00Z') === null, 'invalid input returns null')

console.log('nodeTime tests passed')
