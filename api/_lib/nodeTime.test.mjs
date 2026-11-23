import { nodeTimeZone, toNodeLocal, nodeDayWindow, minutesFromSunriseAt } from './nodeTime.js'

function ok(condition, message) { if (!condition) throw new Error(message) }

ok(nodeTimeZone({ location: { coordinates: [-103.2334, 29.2708] } }) === 'America/Chicago', 'Terlingua zone')
ok(nodeTimeZone({ location: { coordinates: [-110.8243, 45.0318] } }) === 'America/Denver', 'Gardiner zone')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').date === '2026-07-04', 'Terlingua local date')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').hour === 13, 'Terlingua local hour')
ok(JSON.stringify(nodeDayWindow('2026-03-08', 'America/Chicago')) === JSON.stringify(['2026-03-08T06:00:00.000Z', '2026-03-09T05:00:00.000Z']), 'spring DST day is 23 hours')
ok(JSON.stringify(nodeDayWindow('2026-11-01', 'America/Chicago')) === JSON.stringify(['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z']), 'fall DST day is 25 hours')

// Nonexistent local midnight: zones that spring forward AT 00:00 skip local midnight entirely.
// The window must start at the first valid instant of the requested local date (01:00), not
// oscillate or land on the prior day.
// America/Havana 2026-03-08: clocks jump 00:00→01:00 (CST→CDT). First valid instant = 05:00 UTC.
const havana = nodeDayWindow('2026-03-08', 'America/Havana')
ok(havana[0] === '2026-03-08T05:00:00.000Z', 'Havana skipped-midnight day starts at first valid instant (01:00 local = 05:00 UTC)')
ok(toNodeLocal(havana[0], 'America/Havana').date === '2026-03-08', 'Havana start is on the requested local date')
ok(toNodeLocal(havana[0], 'America/Havana').hour === 1, 'Havana start is 01:00 local (midnight does not exist)')
ok(havana[1] === '2026-03-09T04:00:00.000Z', 'Havana day ends at the next local midnight (00:00 CDT = 04:00 UTC)')
// America/Santiago 2026-09-06: clocks jump 00:00→01:00 (CLT→CLST). First valid instant = 04:00 UTC.
const santiago = nodeDayWindow('2026-09-06', 'America/Santiago')
ok(santiago[0] === '2026-09-06T04:00:00.000Z', 'Santiago skipped-midnight day starts at first valid instant (01:00 local = 04:00 UTC)')
ok(toNodeLocal(santiago[0], 'America/Santiago').date === '2026-09-06', 'Santiago start is on the requested local date')
ok(toNodeLocal(santiago[0], 'America/Santiago').hour === 1, 'Santiago start is 01:00 local')
ok(santiago[1] === '2026-09-07T03:00:00.000Z', 'Santiago day ends at the next local midnight (00:00 CLST = 03:00 UTC)')
// The day after a skipped midnight is normal again (exact convergence, no drift).
ok(nodeDayWindow('2026-03-09', 'America/Havana')[0] === '2026-03-09T04:00:00.000Z', 'day after Havana transition is a normal midnight')
ok(nodeTimeZone({ location: { coordinates: [0, 0] } }) === 'Etc/GMT', 'solar fallback has valid fallback shape')

// Solar fallback sign: Etc/GMT is POSIX-inverted, so a western longitude yields Etc/GMT+N (UTC-N).
// tz-lookup throws on out-of-range latitude, which exercises the fallback path.
ok(nodeTimeZone({ location: { coordinates: [-105, 91] } }) === 'Etc/GMT+7', 'western longitude falls back to Etc/GMT+7 (UTC-7)')
ok(nodeTimeZone({ location: { coordinates: [105, 91] } }) === 'Etc/GMT-7', 'eastern longitude falls back to Etc/GMT-7 (UTC+7)')
ok(toNodeLocal('2026-07-04T19:00:00Z', 'Etc/GMT+7').hour === 12, 'Etc/GMT+7 is UTC-7')

// Gemini @f764465 P1 (reclassified: false positive). Claim: near the prime meridian the solar
// fallback returns `Etc/GMT+0` / `Etc/GMT-0`, which are "invalid" and crash Intl. Both names are
// valid IANA links to Etc/GMT, and every longitude band near 0 yields a usable zone. lat 91 forces
// the fallback (tz-lookup throws); lon ±3.75 rounds to ±15 min, producing the +0 / -0 names.
ok(toNodeLocal('2026-07-04T12:00:00Z', 'Etc/GMT+0').hour === 12, 'Etc/GMT+0 is a valid zone (UTC)')
ok(toNodeLocal('2026-07-04T12:00:00Z', 'Etc/GMT-0').hour === 12, 'Etc/GMT-0 is a valid zone (UTC)')
ok(nodeTimeZone({ location: { coordinates: [-3.75, 91] } }) === 'Etc/GMT+0', 'fallback at lon -3.75 yields Etc/GMT+0')
ok(nodeTimeZone({ location: { coordinates: [3.75, 91] } }) === 'Etc/GMT-0', 'fallback at lon +3.75 yields Etc/GMT-0')
for (let lon = -5.5; lon <= 5.5; lon += 0.25) { // every lon whose solar offset rounds to 0 h
  const zone = nodeTimeZone({ location: { coordinates: [lon, 91] } })
  ok(toNodeLocal('2026-07-04T12:00:00Z', zone).hour === 12, `fallback zone at lon ${lon} (${zone}) formats as UTC`)
}
// Open ocean near the meridian: tz-lookup returns an Etc zone rather than throwing.
ok(/^Etc\/GMT/.test(nodeTimeZone({ location: { coordinates: [-3, 0] } })), 'ocean at lon -3 resolves to an Etc zone without throwing')

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
