// Self-test for scripts/ci/check-migrations.mjs. Pure cases plus CLI runs on temp-dir trees.
// Run: node scripts/ci/check-migrations.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkMigrations, parseGrandfathered } from './check-migrations.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const check = (forward, rollbacks, grandfathered) =>
  checkMigrations({ forward, rollbacks: new Set(rollbacks), grandfathered: new Set(grandfathered) })

ok('paired migration -> ok', check(['2026_a.sql'], ['2026_a.rollback.sql'], []).length === 0)
ok('grandfathered, unpaired -> ok', check(['2026_a.sql'], [], ['2026_a.sql']).length === 0)
ok('new unpaired -> FAIL naming the rollback path',
  check(['2026_a.sql', '2026_b.sql'], [], ['2026_a.sql']).some((p) => p.includes('rollbacks/2026_b.rollback.sql')))
ok('misnamed rollback does not pair', check(['2026_b.sql'], ['2026_b.sql'], []).length === 1)
ok('stale grandfather entry -> FAIL', check([], [], ['2026_gone.sql']).some((p) => p.includes('2026_gone.sql')))
ok('grandfather list ignores comments, blanks and CRLF',
  JSON.stringify([...parseGrandfathered('# head\r\n\r\n2026_a.sql\r\n  2026_b.sql  \n')]) === JSON.stringify(['2026_a.sql', '2026_b.sql']))

const CLI = fileURLToPath(new URL('./check-migrations.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'check-migrations-selftest-'))
let lastStderr = ''
const tree = (name, files, { cli = CLI, links = {}, nodeArgs = [] } = {}) => {
  const root = join(tmp, name)
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  for (const [rel, target] of Object.entries(links)) symlinkSync(join(root, target), join(root, rel))
  const r = spawnSync(process.execPath, [...nodeArgs, cli, '--root', root], { encoding: 'utf8' })
  lastStderr = r.stderr
  return r.status
}
try {
  ok('CLI ok on a valid tree', tree('valid', {
    'supabase/migrations/1_old.sql': '',
    'supabase/migrations/2_new.sql': '',
    'supabase/migrations/rollbacks/2_new.rollback.sql': '',
    'scripts/ci/migrations-grandfathered.txt': '1_old.sql\n',
  }) === 0)
  ok('CLI FAIL on an unpaired new migration', tree('unpaired', {
    'supabase/migrations/1_old.sql': '',
    'supabase/migrations/2_new.sql': '',
    'scripts/ci/migrations-grandfathered.txt': '1_old.sql\n',
  }) === 1)
  // The message pins the guard: without it an uncaught ENOENT also exits 1.
  ok('CLI FAIL (fail closed) without a grandfather list', tree('nolist', {
    'supabase/migrations/1_old.sql': '',
  }) === 1 && lastStderr.includes('check-migrations: FAIL (could not judge):'))
  ok('CLI FAIL (fail closed) without a migrations dir', tree('nodir', {
    'scripts/ci/migrations-grandfathered.txt': '',
  }) === 1 && lastStderr.includes('check-migrations: FAIL (could not judge):'))
  ok('CLI FAIL on a symlinked migration (refused, not skipped)', tree('linked', {
    'supabase/migrations/1_old.sql': '',
    'scripts/ci/migrations-grandfathered.txt': '1_old.sql\n',
    'elsewhere/2_new.sql': '',
  }, { links: { 'supabase/migrations/2_new.sql': 'elsewhere/2_new.sql' } }) === 1)
  symlinkSync(join(CLI, '..'), join(tmp, 'ci-link'), 'junction')
  ok('CLI run through a symlinked path still judges', tree('unpaired-via-link', {
    'supabase/migrations/1_old.sql': '',
  }, { cli: join(tmp, 'ci-link', 'check-migrations.mjs') }) === 1)
  ok('CLI run through a symlinked path with --preserve-symlinks-main still judges', tree('unpaired-via-link-preserve', {
    'supabase/migrations/1_old.sql': '',
  }, { cli: join(tmp, 'ci-link', 'check-migrations.mjs'), nodeArgs: ['--preserve-symlinks-main'] }) === 1)
  ok('CLI FAIL (fail closed) on zero migrations', tree('empty-tree', {
    'supabase/migrations/rollbacks/.keep': '',
    'scripts/ci/migrations-grandfathered.txt': '',
  }) === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
