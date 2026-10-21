// Self-test for scripts/run-tests.mjs: the runner must fail on a failing test, on a child that
// cannot launch, and on finding zero tests. Fixtures live in a temp dir, never in the repo.
// Run: node scripts/run-tests.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTests, runTests } from './run-tests.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const RUNNER = fileURLToPath(new URL('./run-tests.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'run-tests-selftest-'))
const write = (rel, body) => {
  const p = join(tmp, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

try {
  write('good/a.test.mjs', 'process.exit(0)\n')
  write('good/nested/b.test.mjs', 'process.exit(0)\n')
  write('good/node_modules/pkg/c.test.mjs', 'process.exit(1)\n')
  write('good/.claude/worktrees/x/d.test.mjs', 'process.exit(1)\n')
  write('good/not-a-test.mjs', 'process.exit(1)\n')
  write('bad/a.test.mjs', 'process.exit(0)\n')
  write('bad/b.test.mjs', 'process.exit(3)\n')
  mkdirSync(join(tmp, 'empty'))

  const good = join(tmp, 'good')
  ok('finds nested tests, skips node_modules and .claude, sorted',
    JSON.stringify(findTests(good)) === JSON.stringify(['a.test.mjs', 'nested/b.test.mjs']))

  const allPass = runTests(findTests(good), { root: good, stdio: 'ignore' })
  ok('all passing -> ok', allPass.ok === true)

  const bad = join(tmp, 'bad')
  const oneFails = runTests(findTests(bad), { root: bad, stdio: 'ignore' })
  ok('one failing -> not ok', oneFails.ok === false)
  ok('failure names the file and exit code', oneFails.failures.some((f) => f.includes('b.test.mjs') && f.includes('exited 3')))

  const none = runTests(findTests(join(tmp, 'empty')), { root: join(tmp, 'empty'), stdio: 'ignore' })
  ok('zero tests -> not ok', none.ok === false && /no \*\.test\.mjs/.test(none.failures[0]))

  const noLaunch = runTests(['a.test.mjs'], { root: good, nodePath: join(tmp, 'no-such-node'), stdio: 'ignore' })
  ok('launch failure -> not ok', noLaunch.ok === false && /failed to launch/.test(noLaunch.failures[0]))

  const cliEmpty = spawnSync(process.execPath, [RUNNER, '--root', join(tmp, 'empty')], { stdio: 'ignore' })
  ok('CLI exits non-zero on zero tests', cliEmpty.status === 1)
  const cliBad = spawnSync(process.execPath, [RUNNER, '--root', bad], { stdio: 'ignore' })
  ok('CLI exits non-zero on a failing test', cliBad.status === 1)
  const cliGood = spawnSync(process.execPath, [RUNNER, '--root', good], { stdio: 'ignore' })
  ok('CLI exits zero when all pass', cliGood.status === 0)

  write('linked/a.test.mjs', 'process.exit(0)\n')
  symlinkSync(join(tmp, 'bad', 'b.test.mjs'), join(tmp, 'linked', 'b.test.mjs'))
  let threw = false
  try { findTests(join(tmp, 'linked')) } catch { threw = true }
  ok('a symlinked test is refused, not skipped', threw)
  // The message pins the guard: without it the uncaught throw also exits 1.
  const cliLinked = spawnSync(process.execPath, [RUNNER, '--root', join(tmp, 'linked')], { encoding: 'utf8' })
  ok('CLI exits non-zero on a symlinked test',
    cliLinked.status === 1 && cliLinked.stderr.includes('run-tests: FAIL (could not judge):'))

  // Run through a symlinked path: main() must still run (it once compared unresolved paths).
  symlinkSync(join(RUNNER, '..'), join(tmp, 'scripts-link'), 'junction')
  ok('CLI run through a symlinked path still judges',
    spawnSync(process.execPath, [join(tmp, 'scripts-link', 'run-tests.mjs'), '--root', join(tmp, 'empty')], { stdio: 'ignore' }).status === 1)
  ok('CLI run through a symlinked path with --preserve-symlinks-main still judges',
    spawnSync(process.execPath, ['--preserve-symlinks-main', join(tmp, 'scripts-link', 'run-tests.mjs'), '--root', join(tmp, 'empty')], { stdio: 'ignore' }).status === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
