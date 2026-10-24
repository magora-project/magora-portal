// Self-test for scripts/ci/label-gate.mjs. Pure; the API is a stub, no network.
// Run: node scripts/ci/label-gate.test.mjs
import { evaluateLabels, fetchLabels, main } from './label-gate.mjs'

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
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }
ok('API error throws (fails closed) with the status', /403/.test(await errOf(() => fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([], 403) })) ?? ''))
ok('non-array response throws a non-array error', /non-array/.test(await errOf(() => fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })) ?? ''))

// main(): the fail-closed entry point. Console output is captured so test output stays pristine.
const goodEnv = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '1' }
const quiet = async (fn) => {
  const { log, error } = console
  const lines = []
  console.log = console.error = (...a) => { lines[lines.length] = a.join(' ') }
  try { return { code: await fn(), lines } } finally { console.log = log; console.error = error }
}
const m1 = await quiet(() => main({ env: {} }))
ok('main: missing env -> 1', m1.code === 1 && /required/.test(m1.lines.join()))
const m2 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([], 403) }))
ok('main: API error -> 1 (could not judge)', m2.code === 1 && /could not judge/.test(m2.lines.join()))
const m3 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([[{ name: 'standard' }]]) }))
ok('main: one depth label -> 0', m3.code === 0)
const m4 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([[{ name: 'dependencies' }]]) }))
ok('main: no depth label -> 1', m4.code === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
