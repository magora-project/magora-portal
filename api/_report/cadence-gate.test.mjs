// Cadence tenure gating — pure unit tests (no network). Pins the thresholds from the
// 2026-11-05 node tenure TaskDef: seasonal requires ≥14 days of tenure in that season,
// annual requires ≥60 days in that year, daily is never gated.
import { cadenceTenureGate } from './generate.js'

function ok(condition, message) { if (!condition) throw new Error(message) }

const NOW = new Date('2026-11-05T12:00:00Z')

// Daily is never gated, even with no heartbeat history.
ok(cadenceTenureGate('daily', '2026-11-04', { first_heard_at: null }, 0, NOW) === null, 'daily ungated with no tenure')

// Missing first_heard_at counts as ZERO tenure — never a bypass. A node with no heartbeat or
// detection history is gated on seasonal/annual (422 on-demand; cron names it in cadenceSkipped).
ok(/seasonal report requires 14 days/.test(cadenceTenureGate('seasonal', '2026-autumn', { first_heard_at: null }, 29, NOW) || ''), 'seasonal gated when first_heard_at is null')
ok(/annual report requires 60 days/.test(cadenceTenureGate('annual', '2026', { first_heard_at: null }, 29, NOW) || ''), 'annual gated when first_heard_at is null')
ok(/seasonal report requires 14 days/.test(cadenceTenureGate('seasonal', '2026-autumn', { first_heard_at: null }, -33, NOW) || ''), 'seasonal gated on null tenure in the southern hemisphere too')

// A node ~1 day old (Villa Magora) cannot author the season or the year.
const villa = { first_heard_at: '2026-11-04T19:22:00Z' }
ok(/seasonal report requires 14 days/.test(cadenceTenureGate('seasonal', '2026-autumn', villa, 29, NOW) || ''), 'seasonal gated at <1 day')
ok(/annual report requires 60 days/.test(cadenceTenureGate('annual', '2026', villa, 29, NOW) || ''), 'annual gated at <1 day')
ok(cadenceTenureGate('daily', '2026-11-04', villa, 29, NOW) === null, 'daily allowed at <1 day')

// A long-running northern node (Casa Colibri) passes all gates.
const casa = { first_heard_at: '2026-06-01T00:00:00Z' }
ok(cadenceTenureGate('seasonal', '2026-autumn', casa, 43, NOW) === null, 'seasonal allowed with >=14 days in season')
ok(cadenceTenureGate('annual', '2026', casa, 43, NOW) === null, 'annual allowed with >=60 days in year')

// Season boundary: 13 days into the season is gated, 14 is not.
const sept22 = { first_heard_at: '2026-09-10T00:00:00Z' } // autumn (N) starts Sep 1
ok(cadenceTenureGate('seasonal', '2026-autumn', sept22, 45, new Date('2026-09-23T00:00:00Z')) !== null, 'seasonal gated at 13 days in season')
ok(cadenceTenureGate('seasonal', '2026-autumn', sept22, 45, new Date('2026-09-24T00:00:01Z')) === null, 'seasonal allowed at 14 days in season')

// Southern hemisphere: 'winter' maps to JJA.
const southYoung = { first_heard_at: '2026-07-20T00:00:00Z' } // S winter (JJA) started Jun 1
ok(cadenceTenureGate('seasonal', '2026-winter', southYoung, -33, new Date('2026-08-01T00:00:00Z')) !== null, 'S winter gated at 12 days in JJA')
ok(cadenceTenureGate('seasonal', '2026-winter', southYoung, -33, new Date('2026-08-05T00:00:00Z')) === null, 'S winter allows >=14 days in JJA')

console.log('cadence-gate tests passed')
