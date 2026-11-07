// Tests for scripts/db/apply-migrations.mjs and scripts/db/pg.mjs (no database needed).
// Run: node scripts/db/apply-migrations.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { listMigrationFiles, applyFiles, managesOwnTransaction, lineColumn, parseArgs } from './apply-migrations.mjs'
import { connect, localProblem, targetLabel } from './pg.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const rejects = async (p) => { try { await p } catch (e) { return String(e?.message) } return null }

// listMigrationFiles
const dir = mkdtempSync(join(tmpdir(), 'mig-'))
try {
  mkdirSync(join(dir, 'rollbacks'))
  mkdirSync(join(dir, 'checks'))
  for (const f of ['20260626_a.sql', '20260625_baseline_prehistory.sql', 'README.md', 'rollbacks/20260626_a.rollback.sql', 'checks/schema-allowlist.txt']) {
    writeFileSync(join(dir, f), '-- x\n')
  }
  const listed = listMigrationFiles(dir).map((p) => basename(p))
  ok('lists exactly the two top-level .sql files, baseline first',
    JSON.stringify(listed) === JSON.stringify(['20260625_baseline_prehistory.sql', '20260626_a.sql']))
  writeFileSync(join(dir, '20260626_B.sql'), '')
  ok('byte order: uppercase sorts before lowercase',
    JSON.stringify(listMigrationFiles(dir).map((p) => basename(p)).slice(1)) === JSON.stringify(['20260626_B.sql', '20260626_a.sql']))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// managesOwnTransaction / lineColumn
ok('own transaction: begin; line', managesOwnTransaction('select 1;\nbegin;\nselect 2;\ncommit;\n'))
ok('own transaction: not inside a function body word', !managesOwnTransaction('create function f() returns void language plpgsql as $$ begin perform 1; end $$;'))
ok('lineColumn', JSON.stringify(lineColumn('ab\ncd\nef', 5)) === JSON.stringify({ line: 2, column: 2 }))

// applyFiles with a fake client
const fakeClient = (failOn) => {
  const log = []
  return { log, query: async (q) => { log.push(q); if (failOn && q === failOn) { const e = new Error('boom'); e.code = '42601'; e.position = '4'; throw e } } }
}
{
  const c = fakeClient()
  const seen = []
  await applyFiles(c, ['a.sql', 'b.sql'], { read: (p) => `-- ${p}`, onEach: (p) => seen.push(p) })
  ok('each file wrapped in its own transaction',
    JSON.stringify(c.log) === JSON.stringify(['BEGIN', '-- a.sql', 'COMMIT', 'BEGIN', '-- b.sql', 'COMMIT']))
  ok('onEach per file', seen.join() === 'a.sql,b.sql')
}
{
  const c = fakeClient('x\nyz')
  const msg = await rejects(applyFiles(c, ['dir/a.sql', 'dir/b.sql', 'dir/c.sql'], { read: (p) => (p.endsWith('b.sql') ? 'x\nyz' : 'ok') }))
  ok('stops at first error, names file, code and position', msg?.startsWith('b.sql: 42601 at line 2, column 2: boom'))
  ok('rolled back and did not run c.sql', c.log.at(-1) === 'ROLLBACK' && c.log.filter((q) => q === 'ok').length === 1)
}
{
  const c = fakeClient()
  await applyFiles(c, ['own.sql'], { read: () => 'begin;\nselect 1;\ncommit;\n' })
  ok('a file with its own transaction is not wrapped', JSON.stringify(c.log) === JSON.stringify(['begin;\nselect 1;\ncommit;\n']))
}

// parseArgs
ok('parseArgs', JSON.stringify(parseArgs(['--db-url-env', 'X', '--file', 'a.sql', '--file', 'b.sql'])) === JSON.stringify({ envName: 'X', files: ['a.sql', 'b.sql'] }))
ok('parseArgs: needs a file', (() => { try { parseArgs(['--db-url-env', 'X']) } catch { return true } return false })())

// pg.mjs guards: refused before any client is built.
const STG = 'postgresql://postgres:pw@db.mujiqtvwtsbaakfcsjkp.supabase.co:5432/postgres'
const PROD = 'postgresql://postgres:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co:5432/postgres'
let built = 0
class FakeClient {
  constructor() { built++ }
  async connect() { const e = new Error('nope postgresql://postgres:pw@db.mujiqtvwtsbaakfcsjkp.supabase.co'); e.code = '28P01'; throw e }
  async end() {}
}
{
  const msg = await rejects(connect('U', { writeTarget: 'staging', env: { U: PROD }, Client: FakeClient }))
  ok('staging writeTarget refuses production', msg?.includes('not the staging project') && built === 0)
  ok('refusal does not echo the URL', !msg?.includes('pw@'))
}
{
  const msg = await rejects(connect('U', { writeTarget: 'local', localPorts: [54322], env: { U: STG }, Client: FakeClient }))
  ok('local writeTarget refuses a remote host', msg?.includes('localhost') && built === 0)
}
ok('local: wrong port refused', localProblem('postgresql://postgres:pw@127.0.0.1:5432/postgres', [54322]) !== null)
ok('local: allowed port admitted', localProblem('postgresql://postgres:pw@127.0.0.1:54322/postgres', [54322]) === null)
ok('local: query override refused', localProblem('postgresql://postgres:pw@127.0.0.1:54322/postgres?host=db.wqxmmuwrfltpaxnuddwk.supabase.co', [54322]) !== null)
ok('local: no ports given refused', localProblem('postgresql://postgres:pw@localhost:54322/postgres') !== null)
{
  const msg = await rejects(connect('U', { env: { U: STG }, Client: FakeClient }))
  ok('no writeTarget and not readOnly is refused', msg?.includes('must be readOnly') && built === 0)
}
{
  const msg = await rejects(connect('U', { writeTarget: 'staging', env: { U: STG }, Client: FakeClient }))
  ok('connect error names the ref and code only', msg === 'connect failed: mujiqtvwtsbaakfcsjkp: 28P01')
}
ok('missing env var', (await rejects(connect('NOPE', { readOnly: true, env: {} }))) === 'NOPE is required')
ok('targetLabel local', targetLabel('postgresql://postgres:pw@localhost:54322/postgres') === 'local')
ok('targetLabel ambiguous -> unknown', targetLabel('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres') === 'unknown')

console.log(`apply-migrations: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
