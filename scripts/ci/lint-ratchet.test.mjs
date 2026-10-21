// Self-test for scripts/ci/lint-ratchet.mjs: each fail-closed case, a rise, a fall, and an equal run.
// Feeds evaluate() what the CLI would observe; the one CLI case runs where ESLint cannot succeed.
// Run: node scripts/ci/lint-ratchet.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate } from './lint-ratchet.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const msg = (ruleId, extra = {}) => ({ ruleId, line: 1, message: 'm', severity: 2, ...extra })
const out = (...messages) => JSON.stringify([{ filePath: 'src/a.jsx', messages }])
const base = JSON.stringify({ 'no-unused-vars': 2, 'react-hooks/static-components': 1 })
const atBaseline = out(msg('no-unused-vars'), msg('no-unused-vars'), msg('react-hooks/static-components'))
const run = (o) => evaluate({ status: 1, stdout: atBaseline, stderr: '', baselineText: base, ...o })
// `reason`, when given, pins which guard fired: several malformed inputs also trip a later guard.
const couldNotJudge = (v, reason = '') => v.ok === false && /could not judge/.test(v.lines[0]) && v.lines[0].includes(reason)

// passing and failing directions
ok('equal to baseline -> ok', run({}).ok === true)
ok('equal run reports no rule moving', run({}).lines.length === 1)
ok('exit 0 with no findings -> ok', run({ status: 0, stdout: JSON.stringify([{ filePath: 'src/a.jsx', messages: [] }]) }).ok === true)
const fell = run({ stdout: out(msg('no-unused-vars'), msg('react-hooks/static-components')) })
ok('a fall -> ok', fell.ok === true)
ok('a fall prints a lower-the-baseline reminder', fell.lines.some((l) => /fell\s+no-unused-vars: 2 -> 1/.test(l)))
const rose = run({ stdout: out(msg('no-unused-vars'), msg('no-unused-vars'), msg('no-unused-vars'), msg('react-hooks/static-components')) })
ok('a rise -> FAIL', rose.ok === false && rose.lines.some((l) => /ROSE\s+no-unused-vars: 2 -> 3/.test(l)))
ok('a rule absent from the baseline counts as 0', run({ stdout: out(msg('no-unused-vars'), msg('no-unused-vars'), msg('react-hooks/static-components'), msg('eqeqeq')) }).ok === false)
ok('per rule: a fall in one rule does not pay for a rise in another',
  run({ stdout: out(msg('no-unused-vars'), msg('react-hooks/static-components'), msg('react-hooks/static-components')) }).ok === false)

// fail-closed cases
ok('ESLint failed to start -> FAIL', couldNotJudge(run({ spawnError: new Error('ENOENT') })))
ok('ESLint exit 2 (config error) -> FAIL', couldNotJudge(run({ status: 2, stdout: '' }), 'ESLint exited 2'))
ok('ESLint killed (status null) -> FAIL', couldNotJudge(run({ status: null })))
ok('output not JSON -> FAIL', couldNotJudge(run({ stdout: 'Oops! Something went wrong' })))
ok('output JSON but not an array -> FAIL', couldNotJudge(run({ stdout: '{}' })))
ok('empty result array (nothing linted) -> FAIL', couldNotJudge(run({ status: 0, stdout: '[]' })))
ok('result entry without messages -> FAIL', couldNotJudge(run({ stdout: '[{}]' }), 'without a messages array'))
ok('result entry with null messages -> FAIL', couldNotJudge(run({ stdout: '[{"filePath":"x","messages":null}]' }), 'without a messages array'))
ok('null result entry -> FAIL', couldNotJudge(run({ stdout: '[null]' }), 'without a messages array'))
ok('fatal parse error -> FAIL', couldNotJudge(run({ stdout: out(msg(null, { fatal: true })) })))
ok('rule-less diagnostic -> FAIL', couldNotJudge(run({ stdout: out(msg(null)) })))
ok('missing baseline -> FAIL', couldNotJudge(run({ baselineText: null }), 'is missing'))
ok('baseline not JSON -> FAIL', couldNotJudge(run({ baselineText: '{' })))
ok('baseline an array -> FAIL', couldNotJudge(run({ baselineText: '[]' })))
ok('baseline negative count -> FAIL', couldNotJudge(run({ baselineText: '{"x": -1}' })))
ok('baseline non-integer count -> FAIL', couldNotJudge(run({ baselineText: '{"x": "3"}' })))

// One CLI case: run through a symlinked path from an empty directory (no ESLint config, no
// baseline). main() must still run and fail; it once compared unresolved paths and exited 0.
const tmp = mkdtempSync(join(tmpdir(), 'lint-ratchet-selftest-'))
try {
  symlinkSync(join(fileURLToPath(import.meta.url), '..'), join(tmp, 'ci-link'), 'junction')
  ok('CLI run through a symlinked path still judges',
    spawnSync(process.execPath, [join(tmp, 'ci-link', 'lint-ratchet.mjs')], { cwd: tmp, stdio: 'ignore' }).status === 1)
  ok('CLI run through a symlinked path with --preserve-symlinks-main still judges',
    spawnSync(process.execPath, ['--preserve-symlinks-main', join(tmp, 'ci-link', 'lint-ratchet.mjs')], { cwd: tmp, stdio: 'ignore' }).status === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
