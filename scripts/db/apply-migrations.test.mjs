// Tests for scripts/db/apply-migrations.mjs and scripts/db/pg.mjs (no database needed).
// Run: node scripts/db/apply-migrations.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { listMigrationFiles, applyFiles, managesOwnTransaction, lineColumn, parseArgs, OPEN_PROBE } from './apply-migrations.mjs'
import { connect, localProblem, targetLabel, withRootCert } from './pg.mjs'

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
// openAfterOwn: whether a transaction block is open after an own-transaction file ran, which the
// SAVEPOINT probe reports (outside a block, PostgreSQL refuses SAVEPOINT with 25P01).
const fakeClient = (failOn, { openAfterOwn = false } = {}) => {
  const log = []
  return {
    log,
    query: async (q) => {
      log.push(q)
      if (failOn && q === failOn) { const e = new Error('boom'); e.code = '42601'; e.position = '4'; throw e }
      if (q === OPEN_PROBE && !openAfterOwn) { const e = new Error('SAVEPOINT can only be used in transaction blocks'); e.code = '25P01'; throw e }
    },
  }
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
  ok('a file with its own transaction is not wrapped; the open-transaction probe follows it',
    JSON.stringify(c.log) === JSON.stringify(['begin;\nselect 1;\ncommit;\n', OPEN_PROBE]))
}
{
  const c = fakeClient(null, { openAfterOwn: true })
  const seen = []
  const msg = await rejects(applyFiles(c, ['open.sql', 'next.sql'], { read: (p) => (p === 'open.sql' ? 'begin;\ncreate table public.commit_probe(id int);\n' : 'ok'), onEach: (p) => seen.push(p) }))
  ok('a file that leaves a transaction open fails, naming the file', msg?.startsWith('open.sql: open-transaction: the file leaves a transaction open'))
  ok('the open transaction is rolled back, not reported, and the next file does not run',
    c.log.at(-1) === 'ROLLBACK' && seen.length === 0 && !c.log.includes('ok'))
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
{
  const prod = 'postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full'
  const out = withRootCert(prod, { PGSSLROOTCERT: '/abs/prod-ca.crt' })
  ok('withRootCert adds sslrootcert to a verify-full URL', new URL(out).searchParams.get('sslrootcert') === '/abs/prod-ca.crt' && new URL(out).searchParams.get('sslmode') === 'verify-full')
  ok('withRootCert leaves a URL with no sslmode alone', withRootCert('postgresql://postgres:pw@127.0.0.1:54322/postgres', { PGSSLROOTCERT: '/abs/x' }) === 'postgresql://postgres:pw@127.0.0.1:54322/postgres')
  ok('withRootCert without PGSSLROOTCERT is the identity', withRootCert(prod, {}) === prod)
  ok('withRootCert refuses a relative path', (() => { try { withRootCert(prod, { PGSSLROOTCERT: 'ca.crt' }); return false } catch { return true } })())
}
ok('targetLabel local',targetLabel('postgresql://postgres:pw@localhost:54322/postgres') === 'local')
ok('targetLabel ambiguous -> unknown', targetLabel('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres') === 'unknown')

console.log(`apply-migrations: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
