// Self-test for scripts/ci/label-gate.mjs. Pure; the API is a stub, no network.
// Run: node scripts/ci/label-gate.test.mjs
import { evaluateLabels, fetchLabels } from './label-gate.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

ok('exactly one depth label -> ok', evaluateLabels(['standard']).ok === true)
ok('one depth label among others -> ok', evaluateLabels(['dependencies', 'subtle-correctness']).ok === true)
ok('zero labels -> FAIL', evaluateLabels([]).ok === false)
ok('only non-depth labels -> FAIL', evaluateLabels(['dependencies']).ok === false)
ok('two depth labels -> FAIL naming both', (() => {
  const v = evaluateLabels(['mechanical', 'standard'])
  return v.ok === false && /mechanical, standard/.test(v.line)
})())
ok('near-miss name is not a depth label', evaluateLabels(['Standard']).ok === false)

const stub = (pages, status = 200) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'))
  return { ok: status === 200, status, json: async () => pages[page - 1] ?? [] }
}
const full = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }))
ok('paginates past 100 labels', (await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([full, [{ name: 'standard' }]]) })).length === 101)
let threw = false
try { await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([], 403) }) } catch { threw = true }
ok('API error throws (fails closed)', threw)
threw = false
try { await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }) } catch { threw = true }
ok('non-array response throws', threw)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
