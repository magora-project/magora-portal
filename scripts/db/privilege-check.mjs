// Privilege check for the refresh login (Spec 2 plan Task 11, spec §5.10, success criterion 7).
//
// Connects AS magora_refresh, reads the catalog and attempts no write. It reports:
//   - INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table, at table or column level,
//     except UPDATE on pg_catalog.pg_settings (see ACCEPTED_TABLE_PRIVILEGE)
//   - UPDATE or USAGE on any sequence
//   - EXECUTE on any function, in any schema, outside the reviewed allowlist; and EXECUTE on any
//     function in WRITES_WITHOUT_TABLE_PRIVILEGE whatever the allowlist says
//   - CREATE on any schema or on the database
//   - any owned object
//   - any role membership
//   - any role attribute other than LOGIN and BYPASSRLS
//   - a copied table the login cannot SELECT
// The positive part reads each copied table with row_security = off. PostgreSQL refuses such a read
// when a row-level security policy would filter it, and refuses it when SELECT is missing, so a
// successful read shows the login reads every row, with no snapshot to drift. On the first run it
// also compares each count with a count a maintainer took just before it (--counts).
//
// CLI: node scripts/db/privilege-check.mjs --db-url-env NAME [--counts FILE | --tables FILE] [--allowlist FILE]
// FILE for --counts is JSON {"public.t": 123, ...}: the first run; its keys are the copied tables.
// FILE for --tables is JSON ["public.t", ...]: every refresh; the copied tables, with no counts.
// Exits non-zero on any violation. Never prints the URL.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { connect } from './pg.mjs'

export const REFRESH_ROLE = 'magora_refresh'
export const DEFAULT_ALLOWLIST = new URL('../../supabase/migrations/checks/refresh-execute-allowlist.txt', import.meta.url)

// Functions that write without any table privilege. EXECUTE on any of them is a violation that no
// allowlist line, wildcard or exact, can admit. Matched by schema-qualified NAME, so every overload
// (and any overload a later PostgreSQL adds) is covered.
//   - large-object writers: create, open for write, write, truncate, unlink, import
//   - lo_export writes a server file (not callable through PUBLIC by default; a later grant must
//     still not pass the wildcard)
//   - pg_logical_emit_message writes caller-supplied content to WAL
// default_transaction_read_only is a session default the login can switch off, not a boundary.
export const WRITES_WITHOUT_TABLE_PRIVILEGE = Object.freeze([
  'pg_catalog.lo_create',
  'pg_catalog.lo_creat',
  'pg_catalog.lo_from_bytea',
  'pg_catalog.lo_import',
  'pg_catalog.lo_open',
  'pg_catalog.lowrite',
  'pg_catalog.lo_put',
  'pg_catalog.lo_truncate',
  'pg_catalog.lo_truncate64',
  'pg_catalog.lo_unlink',
  'pg_catalog.lo_export',
  'pg_catalog.pg_logical_emit_message',
])

const TABLE_WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
// The one table privilege the check accepts (David, 2026-11-07). PostgreSQL grants UPDATE on the
// pg_settings view to PUBLIC on every database. An UPDATE there only calls set_config, a session
// setting that writes no data and that any login can do with SET anyway, and `postgres` does not
// own the view, so it cannot revoke the grant. Exactly this name and privilege, nothing else.
export const ACCEPTED_TABLE_PRIVILEGE = Object.freeze({ name: 'pg_catalog.pg_settings', privilege: 'UPDATE' })
const COLUMN_WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'REFERENCES']
const SEQUENCE_PRIVILEGES = ['UPDATE', 'USAGE']
const WILDCARD_SCHEMAS = new Set(['pg_catalog', 'information_schema'])
const ALLOWED_ATTRIBUTES = new Set(['rolcanlogin', 'rolbypassrls'])
const ATTRIBUTES = ['rolsuper', 'rolinherit', 'rolcreaterole', 'rolcreatedb', 'rolcanlogin', 'rolreplication', 'rolbypassrls']

// `schema.name(argtypes)` -> `schema.name`
export const functionName = (signature) => signature.slice(0, signature.indexOf('('))

// Each line is `<schema>.<function>(<argtypes>)  # <reason>`, or `<schema>.*  # <reason>` for
// pg_catalog and information_schema only. Blank lines and `#` comment lines are ignored.
export function parseExecuteAllowlist(text) {
  const entries = []
  const errors = []
  String(text).split(/\r?\n/).forEach((line, idx) => {
    const n = idx + 1
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const hash = line.indexOf('#')
    if (hash < 0 || line.slice(hash + 1).trim() === '') { errors.push(`line ${n}: no "# reason"`); return }
    const entry = line.slice(0, hash).trim()
    const wild = /^([A-Za-z_][A-Za-z0-9_]*)\.\*$/.exec(entry)
    if (wild) {
      if (!WILDCARD_SCHEMAS.has(wild[1])) { errors.push(`line ${n}: a wildcard is allowed only for pg_catalog and information_schema`); return }
      entries.push(entry)
      return
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*\.[^\s.(]+\(.*\)$/.test(entry)) { errors.push(`line ${n}: not <schema>.<function>(<argtypes>): ${entry}`); return }
    entries.push(entry)
  })
  return { entries, errors }
}

export function executeAllowed(signature, allowlist) {
  for (const entry of allowlist) {
    if (entry.endsWith('.*') ? signature.startsWith(entry.slice(0, -1)) : signature === entry) return true
  }
  return false
}

// facts -> violations (strings). Pure.
export function judge(facts, { executeAllowlist = [], copiedTables = [] } = {}) {
  const v = []
  if (facts.role?.rolname !== REFRESH_ROLE) v.push(`connected as ${facts.role?.rolname ?? 'unknown'}, not ${REFRESH_ROLE}`)
  for (const attr of ATTRIBUTES) {
    if (facts.role?.[attr] && !ALLOWED_ATTRIBUTES.has(attr)) v.push(`role attribute ${attr}`)
  }
  for (const m of facts.memberOf ?? []) v.push(`role membership: member of ${m}`)
  for (const { name, privilege } of facts.tablePrivileges ?? []) {
    if (name === ACCEPTED_TABLE_PRIVILEGE.name && privilege === ACCEPTED_TABLE_PRIVILEGE.privilege) continue
    if (TABLE_WRITE_PRIVILEGES.includes(privilege)) v.push(`table ${name}: ${privilege}`)
  }
  for (const { name, privilege } of facts.columnPrivileges ?? []) {
    if (COLUMN_WRITE_PRIVILEGES.includes(privilege)) v.push(`column ${name}: ${privilege}`)
  }
  for (const { name, privilege } of facts.sequencePrivileges ?? []) {
    if (SEQUENCE_PRIVILEGES.includes(privilege)) v.push(`sequence ${name}: ${privilege}`)
  }
  for (const sig of facts.execute ?? []) {
    if (WRITES_WITHOUT_TABLE_PRIVILEGE.includes(functionName(sig))) v.push(`EXECUTE on ${sig}: writes without table privilege; no allowlist line can admit it`)
    else if (!executeAllowed(sig, executeAllowlist)) v.push(`EXECUTE on ${sig}: not in the allowlist`)
  }
  for (const s of facts.schemaCreate ?? []) v.push(`CREATE on schema ${s}`)
  if (facts.databaseCreate) v.push('CREATE on the database')
  for (const { kind, name } of facts.owned ?? []) v.push(`owns ${kind} ${name}`)
  const selectable = new Set((facts.tablePrivileges ?? []).filter((p) => p.privilege === 'SELECT').map((p) => p.name))
  for (const t of copiedTables) if (!selectable.has(t)) v.push(`copied table ${t}: no SELECT`)
  return v.sort()
}

export async function collectPrivileges(client) {
  const rows = async (sql, params) => (await client.query(sql, params)).rows
  const [role] = await rows(`select rolname, ${ATTRIBUTES.join(', ')} from pg_roles where rolname = current_user`)
  const me = `(select oid from pg_roles where rolname = current_user)`
  const tablePrivileges = await rows(`
    select n.nspname || '.' || c.relname as name, p.privilege
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT', ${TABLE_WRITE_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]) as p(privilege)
     where c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege(c.oid, p.privilege)
     order by 1, 2`)
  // Column-level grants only: a privilege also held at table level is reported there.
  const columnPrivileges = await rows(`
    select n.nspname || '.' || c.relname || '.' || a.attname as name, p.privilege
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array[${COLUMN_WRITE_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]) as p(privilege)
     where a.attacl is not null and a.attnum > 0 and not a.attisdropped
       and has_column_privilege(c.oid, a.attnum, p.privilege)
       and not has_table_privilege(c.oid, p.privilege)
     order by 1, 2`)
  const sequencePrivileges = await rows(`
    select n.nspname || '.' || c.relname as name, p.privilege
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array[${SEQUENCE_PRIVILEGES.map((p) => `'${p}'`).join(', ')}]) as p(privilege)
     where c.relkind = 'S' and has_sequence_privilege(c.oid, p.privilege)
     order by 1, 2`)
  const execute = (await rows(`
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where has_function_privilege(p.oid, 'EXECUTE')
     order by 1`)).map((r) => r.sig)
  const schemaCreate = (await rows(`select nspname from pg_namespace where has_schema_privilege(oid, 'CREATE') order by 1`)).map((r) => r.nspname)
  const [{ databaseCreate }] = await rows(`select has_database_privilege(current_database(), 'CREATE') as "databaseCreate"`)
  const owned = await rows(`
    select 'relation' as kind, n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relowner = ${me}
    union all select 'function', n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proowner = ${me}
    union all select 'schema', nspname from pg_namespace where nspowner = ${me}
    union all select 'type', n.nspname || '.' || t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typowner = ${me}
    union all select 'database', datname from pg_database where datdba = ${me}
    union all select 'large object', oid::text from pg_largeobject_metadata where lomowner = ${me}
    order by 1, 2`)
  const memberOf = (await rows(`
    select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid where m.member = ${me} order by 1`)).map((r) => r.rolname)
  return { role, memberOf, tablePrivileges, columnPrivileges, sequencePrivileges, execute, schemaCreate, databaseCreate, owned }
}

// `public.t` -> `"public"."t"`; refuses anything that is not exactly schema.table.
export function quoteQualified(name) {
  const m = /^([^".\s]+)\.([^".\s]+)$/.exec(name)
  if (!m) throw new Error(`not a schema.table name: ${name}`)
  return `"${m[1]}"."${m[2]}"`
}

// expectedCounts: an object on the first run (each count must match); null or undefined on a refresh,
// where only the read itself is checked.
export async function positiveCheck(client, copiedTables, expectedCounts) {
  const v = []
  try {
    await client.query('set row_security = off')
  } catch (e) {
    return [`row_security = off refused: ${e?.code ?? e?.message}`]
  }
  for (const t of copiedTables) {
    let n
    try {
      n = Number((await client.query(`select count(*)::bigint as n from ${quoteQualified(t)}`)).rows[0].n)
    } catch (e) {
      v.push(`copied table ${t}: count failed: ${e?.code ?? e?.message}`)
      continue
    }
    if (expectedCounts == null) continue
    if (!(t in expectedCounts)) v.push(`copied table ${t}: no expected count`)
    else if (Number(expectedCounts[t]) !== n) v.push(`copied table ${t}: read ${n} rows, expected ${expectedCounts[t]}`)
  }
  return v
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const envName = argValue(argv, '--db-url-env')
  if (!envName) { console.error('privilege-check: --db-url-env is required'); return 2 }
  const allowlistPath = argValue(argv, '--allowlist') ?? DEFAULT_ALLOWLIST
  const { entries, errors } = parseExecuteAllowlist(readFileSync(allowlistPath, 'utf8'))
  if (errors.length) { console.error(`privilege-check: allowlist errors:\n  ${errors.join('\n  ')}`); return 2 }
  const countsPath = argValue(argv, '--counts')
  const tablesPath = argValue(argv, '--tables')
  if (countsPath && tablesPath) { console.error('privilege-check: give --counts (first run) or --tables (refresh), not both'); return 2 }
  const counts = countsPath ? JSON.parse(readFileSync(countsPath, 'utf8')) : null
  const tables = tablesPath ? JSON.parse(readFileSync(tablesPath, 'utf8')) : null
  if (tables !== null && (!Array.isArray(tables) || !tables.every((t) => typeof t === 'string'))) { console.error('privilege-check: --tables must be a JSON array of schema.table names'); return 2 }
  const copiedTables = (tables ?? Object.keys(counts ?? {})).slice().sort()
  const client = await connect(envName, { readOnly: true })
  let violations
  try {
    const facts = await collectPrivileges(client)
    violations = judge(facts, { executeAllowlist: entries, copiedTables })
    if (countsPath || tablesPath) violations.push(...await positiveCheck(client, copiedTables, counts))
  } finally {
    await client.end()
  }
  if (violations.length) {
    console.error(`privilege-check: FAIL (${violations.length} violations)\n  ${violations.join('\n  ')}`)
    return 1
  }
  console.log(`privilege-check: ok (${copiedTables.length} copied tables read)`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    console.error(`privilege-check: ${e.message}`)
    process.exitCode = 1
  })
}
