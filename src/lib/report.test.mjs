import { reportCadencesForTenure } from './report.js'

function ok(value, message) { if (!value) throw new Error(message) }
const villaIds = reportCadencesForTenure(0.8).map((c) => c.id)
const casaIds = reportCadencesForTenure(75).map((c) => c.id)
ok(villaIds.join(',') === 'daily', 'Villa Magora hides Season and Year')
ok(casaIds.join(',') === 'daily,seasonal,annual', 'Casa Colibri keeps Season and Year')
console.log('report cadence tenure tests passed')
