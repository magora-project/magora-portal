// Integration test for scripts/db/privilege-check.mjs (Spec 2 plan Task 11 Step 5). Run by
// `npm run test:db` against a throwaway local stack. Self-contained: it needs no baseline.
//
// 1. Applies roles.sql, creates public.t and grants SELECT on it to magora_refresh.
// 2. Runs the check as magora_refresh. Its EXECUTE violations on this bare stack become the
//    fixture's allowlist, except write-capable functions, which no allowlist may hold: they stay in
//    a recorded baseline of violations.
// 3. Tries lo_create as magora_refresh in a read-write transaction (rolled back). If it succeeds,
//    the check must have reported lo_create.
// 4. Each sabotage must add exactly one violation beyond the baseline, and its undo must remove it.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect } from './pg.mjs'
import { collectPrivileges, judge, functionName, WRITES_WITHOUT_TABLE_PRIVILEGE, REFRESH_ROLE } from './privilege-check.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const port = Number(process.env.MAGORA_LOCAL_DB_PORT)
const admin = await connect('MAGORA_LOCAL_DB_URL', { writeTarget: 'local', localPorts: [port] })
const a = (sql) => admin.query(sql)

const password = randomBytes(18).toString('hex')
const refreshUrl = new URL(process.env.MAGORA_LOCAL_DB_URL)
refreshUrl.username = REFRESH_ROLE
refreshUrl.password = password
const asRefresh = () => connect('R', { writeTarget: 'local', localPorts: [port], env: { R: refreshUrl.toString() } })

const TEARDOWN = `
  drop table if exists public.t;
  drop sequence if exists public.itest_s;
  do $$ begin
    if exists (select 1 from pg_roles where rolname = 'magora_refresh') then
      revoke create on schema public from magora_refresh;
      revoke authenticated from magora_refresh;
      alter role magora_refresh password null;
    end if;
  end $$;
`

const check = async (opts) => {
  const c = await asRefresh()
  try { return judge(await collectPrivileges(c), opts) } finally { await c.end() }
}

try {
  await a(TEARDOWN)
  await a(readFileSync(new URL('../../supabase/setup/roles.sql', import.meta.url), 'utf8'))
  await a(`alter role magora_refresh password '${password}'`)
  await a('create table public.t (id int primary key, owner uuid)')
  await a('grant select on public.t to magora_refresh')
  await a('create sequence public.itest_s')

  // First run with only the wildcards: derive the bare-stack allowlist and baseline.
  const first = await check({ executeAllowlist: [], copiedTables: ['public.t'] })
  const executeSigs = first.filter((v) => v.startsWith('EXECUTE on ')).map((v) => v.slice('EXECUTE on '.length, v.indexOf(': ')))
  const writers = executeSigs.filter((s) => WRITES_WITHOUT_TABLE_PRIVILEGE.includes(functionName(s)))
  const allowlist = executeSigs.filter((s) => !writers.includes(s))
  const opts = { executeAllowlist: allowlist, copiedTables: ['public.t'] }
  const baseline = await check(opts)
  console.log(`  bare stack: ${executeSigs.length} EXECUTE violations, ${writers.length} write-capable:`)
  for (const s of writers) console.log(`    ${s}`)
  ok('the bare-stack allowlist absorbed no write-capable function', allowlist.every((s) => !WRITES_WITHOUT_TABLE_PRIVILEGE.includes(functionName(s))))
  ok('baseline holds exactly the write-capable functions', baseline.length === writers.length && baseline.every((v) => v.includes('writes without table privilege')), JSON.stringify(baseline))

  // Can the login actually write a large object? default_transaction_read_only is only a default.
  {
    const c = await asRefresh()
    try {
      await c.query('begin; set transaction read write')
      await c.query('select lo_create(0)')
      console.log('  lo_create as magora_refresh: SUCCEEDED (rolled back)')
      ok('lo_create succeeded, so the check reported it', baseline.some((v) => v.startsWith('EXECUTE on pg_catalog.lo_create(oid)')))
    } catch (e) {
      console.log(`  lo_create as magora_refresh: refused (${e.code}: ${e.message})`)
      ok('lo_create refused', true)
    } finally {
      try { await c.query('rollback') } catch { /* already aborted */ }
      await c.end()
    }
  }

  const CASES = [
    ['GRANT INSERT on the table', 'grant insert on public.t to magora_refresh', 'revoke insert on public.t from magora_refresh', 'table public.t: INSERT'],
    ['GRANT UPDATE on one column', 'grant update (owner) on public.t to magora_refresh', 'revoke update (owner) on public.t from magora_refresh', 'column public.t.owner: UPDATE'],
    ['GRANT authenticated (membership)', 'grant authenticated to magora_refresh', 'revoke authenticated from magora_refresh', 'member of authenticated'],
    ['GRANT CREATE on schema public', 'grant create on schema public to magora_refresh', 'revoke create on schema public from magora_refresh', 'CREATE on schema public'],
    ['GRANT USAGE on a sequence', 'grant usage on sequence public.itest_s to magora_refresh', 'revoke usage on sequence public.itest_s from magora_refresh', 'sequence public.itest_s: USAGE'],
    ['REVOKE SELECT on a copied table', 'revoke select on public.t from magora_refresh', 'grant select on public.t to magora_refresh', 'copied table public.t: no SELECT'],
  ]
  for (const [name, sabotage, undo, needle] of CASES) {
    await a(sabotage)
    const added = (await check(opts)).filter((v) => !baseline.includes(v))
    ok(`${name}: exactly one new violation naming it`, added.length === 1 && added[0].includes(needle), JSON.stringify(added))
    await a(undo)
    const after = (await check(opts)).filter((v) => !baseline.includes(v))
    ok(`${name}: none after undo`, after.length === 0, JSON.stringify(after))
  }
} finally {
  try { await a(TEARDOWN) } catch (e) { fail++; console.log('  FAIL teardown', e.message) }
  await admin.end()
}

console.log(`privilege-check itest: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
