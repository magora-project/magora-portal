// Tests for scripts/db/privilege-check.mjs (pure functions; no database).
// Run: node scripts/db/privilege-check.test.mjs
import { readFileSync } from 'node:fs'
import {
  judge, parseExecuteAllowlist, executeAllowed, positiveCheck, quoteQualified, DEFAULT_ALLOWLIST, REFRESH_ROLE,
} from './privilege-check.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const ROLE = { rolname: REFRESH_ROLE, rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true, rolreplication: false, rolbypassrls: true }
const clean = () => ({
  role: { ...ROLE }, memberOf: [], tablePrivileges: [{ name: 'public.t', privilege: 'SELECT' }], columnPrivileges: [],
  sequencePrivileges: [], execute: ['pg_catalog.abs(integer)'], schemaCreate: [], databaseCreate: false, owned: [],
})
const OPTS = { executeAllowlist: ['pg_catalog.*', 'information_schema.*'], copiedTables: ['public.t'] }
const one = (name, facts, needle, opts = OPTS) => {
  const v = judge(facts, opts)
  ok(name, v.length === 1 && v[0].includes(needle), JSON.stringify(v))
}

ok('clean facts -> []', judge(clean(), OPTS).length === 0, JSON.stringify(judge(clean(), OPTS)))

// One case per violation class.
for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
  const f = clean(); f.tablePrivileges.push({ name: 'public.t', privilege: p })
  one(`table ${p}`, f, `table public.t: ${p}`)
}
for (const p of ['INSERT', 'UPDATE', 'REFERENCES']) {
  const f = clean(); f.columnPrivileges.push({ name: 'public.t.owner', privilege: p })
  one(`column ${p}`, f, `column public.t.owner: ${p}`)
}
for (const p of ['UPDATE', 'USAGE']) {
  const f = clean(); f.sequencePrivileges.push({ name: 'public.s', privilege: p })
  one(`sequence ${p}`, f, `sequence public.s: ${p}`)
}
// The one accepted table privilege: UPDATE on pg_catalog.pg_settings, and nothing near it.
{ const f = clean(); f.tablePrivileges.push({ name: 'pg_catalog.pg_settings', privilege: 'UPDATE' }); ok('UPDATE on pg_catalog.pg_settings is accepted', judge(f, OPTS).length === 0) }
for (const p of ['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
  const f = clean(); f.tablePrivileges.push({ name: 'pg_catalog.pg_settings', privilege: p })
  one(`pg_settings ${p} is still a violation`, f, `table pg_catalog.pg_settings: ${p}`)
}
{ const f = clean(); f.tablePrivileges.push({ name: 'public.pg_settings', privilege: 'UPDATE' }); one('UPDATE on public.pg_settings is a violation', f, 'table public.pg_settings: UPDATE') }
{ const f = clean(); f.tablePrivileges.push({ name: 'pg_catalog.pg_class', privilege: 'UPDATE' }); one('UPDATE on another pg_catalog table is a violation', f, 'table pg_catalog.pg_class: UPDATE') }
{ const f = clean(); f.columnPrivileges.push({ name: 'pg_catalog.pg_settings.setting', privilege: 'UPDATE' }); one('column UPDATE on pg_settings is a violation', f, 'column pg_catalog.pg_settings.setting: UPDATE') }
{ const f = clean(); f.execute.push('public.f(integer)'); one('EXECUTE outside the allowlist', f, 'public.f(integer)') }
{ const f = clean(); f.execute.push('public.f(integer)'); ok('EXECUTE inside an exact allowlist line', judge(f, { ...OPTS, executeAllowlist: [...OPTS.executeAllowlist, 'public.f(integer)'] }).length === 0) }
{ const f = clean(); f.schemaCreate.push('public'); one('CREATE on a schema', f, 'CREATE on schema public') }
{ const f = clean(); f.databaseCreate = true; one('CREATE on the database', f, 'CREATE on the database') }
{ const f = clean(); f.owned.push({ kind: 'relation', name: 'public.x' }); one('owned object', f, 'owns relation public.x') }
{ const f = clean(); f.owned.push({ kind: 'large object', name: '16400' }); one('owned large object', f, 'owns large object 16400') }
{ const f = clean(); f.memberOf.push('authenticated'); one('role membership', f, 'member of authenticated') }
for (const attr of ['rolsuper', 'rolinherit', 'rolcreaterole', 'rolcreatedb', 'rolreplication']) {
  const f = clean(); f.role[attr] = true
  one(`attribute ${attr}`, f, attr)
}
{ const f = clean(); f.tablePrivileges = []; one('copied table without SELECT', f, 'copied table public.t: no SELECT') }
{ const f = clean(); f.role.rolname = 'postgres'; one('connected as another role', f, 'connected as postgres') }

// Write-capable functions: one case per SIGNATURE, listed here independently of judge's constant
// (read from PostgreSQL 17.6 on a local Supabase stack, 2026-11-07, plus the PostgreSQL 16 3-arg
// pg_logical_emit_message overloads). Each must be reported under a wildcard AND under an
// allowlist naming that exact signature. Removing any name from judge's list fails a case.
const WRITERS = [
  'pg_catalog.lo_creat(integer)',
  'pg_catalog.lo_create(oid)',
  'pg_catalog.lo_export(oid, text)',
  'pg_catalog.lo_from_bytea(oid, bytea)',
  'pg_catalog.lo_import(text)',
  'pg_catalog.lo_import(text, oid)',
  'pg_catalog.lo_open(oid, integer)',
  'pg_catalog.lo_put(oid, bigint, bytea)',
  'pg_catalog.lo_truncate(integer, integer)',
  'pg_catalog.lo_truncate64(integer, bigint)',
  'pg_catalog.lo_unlink(oid)',
  'pg_catalog.lowrite(integer, bytea)',
  'pg_catalog.pg_logical_emit_message(boolean, text, bytea, boolean)',
  'pg_catalog.pg_logical_emit_message(boolean, text, text, boolean)',
  'pg_catalog.pg_logical_emit_message(boolean, text, bytea)',
  'pg_catalog.pg_logical_emit_message(boolean, text, text)',
]
for (const sig of WRITERS) {
  const f = clean(); f.execute.push(sig)
  one(`${sig} under pg_catalog.*`, f, sig)
  one(`${sig} under an exact allowlist line`, f, sig, { ...OPTS, executeAllowlist: [...OPTS.executeAllowlist, sig] })
}
ok('a non-writer lo_ function is not flagged under the wildcard', (() => { const f = clean(); f.execute.push('pg_catalog.loread(integer, integer)'); return judge(f, OPTS).length === 0 })())

// Allowlist parsing.
{
  const r = parseExecuteAllowlist('pg_catalog.*  # catalog reads\ninformation_schema.*  # views\npublic.f(integer)  # reason\n')
  ok('allowlist parses wildcards and an exact signature', r.errors.length === 0 && r.entries.length === 3)
}
ok('wildcard for another schema is an error', parseExecuteAllowlist('public.*  # no\n').errors.length === 1)
ok('a line with no reason is an error', parseExecuteAllowlist('pg_catalog.*\n').errors.length === 1)
ok('a line with an empty reason is an error', parseExecuteAllowlist('pg_catalog.*  #  \n').errors.length === 1)
ok('a non-signature is an error', parseExecuteAllowlist('public.f  # no args\n').errors.length === 1)
ok('wildcard matches its schema only', executeAllowed('pg_catalog.abs(integer)', ['pg_catalog.*']) && !executeAllowed('pg_catalogx.abs(integer)', ['pg_catalog.*']))
ok('exact entry does not match another overload', !executeAllowed('public.f(text)', ['public.f(integer)']))
{
  const r = parseExecuteAllowlist(readFileSync(DEFAULT_ALLOWLIST, 'utf8'))
  ok('checked-in allowlist parses with no errors', r.errors.length === 0, JSON.stringify(r.errors))
}

// quoteQualified / positiveCheck.
ok('quoteQualified', quoteQualified('public.t') === '"public"."t"')
ok('quoteQualified refuses injection', (() => { try { quoteQualified('public.t; drop table x'); return false } catch { return true } })())
{
  const client = { query: async (sql) => {
    if (sql.includes('"public"."a"')) return { rows: [{ n: '3' }] }
    if (sql.includes('"public"."b"')) return { rows: [{ n: '5' }] }
    const e = new Error('denied'); e.code = '42501'; throw e
  } }
  const v = await positiveCheck(client, ['public.a', 'public.b', 'public.c', 'public.d'], { 'public.a': 3, 'public.b': 4, 'public.c': 1 })
  ok('positive: matching count passes', !v.some((x) => x.includes('public.a')))
  ok('positive: wrong count reported', v.some((x) => x.includes('public.b: read 5 rows, expected 4')))
  ok('positive: unreadable table reported', v.some((x) => x.includes('public.c: count failed: 42501')))
  ok('positive: four tables -> three violations', v.length === 3, JSON.stringify(v))
}

console.log(`privilege-check: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
