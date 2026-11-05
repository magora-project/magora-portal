import { nodeTimeZone, toNodeLocal, nodeDayWindow } from './nodeTime.js'

function ok(condition, message) { if (!condition) throw new Error(message) }

ok(nodeTimeZone({ location: { coordinates: [-103.2334, 29.2708] } }) === 'America/Chicago', 'Terlingua zone')
ok(nodeTimeZone({ location: { coordinates: [-110.8243, 45.0318] } }) === 'America/Denver', 'Gardiner zone')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').date === '2026-07-04', 'Terlingua local date')
ok(toNodeLocal('2026-07-04T18:30:00Z', 'America/Chicago').hour === 13, 'Terlingua local hour')
ok(JSON.stringify(nodeDayWindow('2026-03-08', 'America/Chicago')) === JSON.stringify(['2026-03-08T06:00:00.000Z', '2026-03-09T05:00:00.000Z']), 'spring DST day is 23 hours')
ok(JSON.stringify(nodeDayWindow('2026-11-01', 'America/Chicago')) === JSON.stringify(['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z']), 'fall DST day is 25 hours')
ok(nodeTimeZone({ location: { coordinates: [0, 0] } }) === 'Etc/GMT', 'solar fallback has valid fallback shape')

console.log('nodeTime tests passed')
