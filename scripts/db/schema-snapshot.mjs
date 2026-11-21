// Catalog-only schema snapshot, diff and allowlist (Spec 2 plan Task 10, spec §5.2, §5.3).
//
// A snapshot is a flat object keyed `<kind>:<qualified name>` whose values are canonical
// definitions. It reads catalogs only (plus storage.buckets rows), so the refresh login, which holds
// SELECT on copied tables only, can take one. pg_dump --schema-only cannot: it locks every table.
//
// CLI:
//   node scripts/db/schema-snapshot.mjs snapshot --db-url-env NAME --out FILE
//   node scripts/db/schema-snapshot.mjs compare A.json B.json --allowlist supabase/migrations/checks/schema-allowlist.txt
// `compare` exits 0 only when no difference falls outside the allowlist. It prints keys, and prints
// definitions only for objects in `public`, `storage` and `auth`.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { connect } from './pg.mjs'

// ---------- canonical values ----------

// JSON with object keys sorted at every depth, so equal values serialize identically.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// Parse one aclitem's text form, `grantee=privs/grantor`, where an empty grantee is PUBLIC and a
// name may be double-quoted with "" as the escape.
export function parseAclItem(item) {
  let i = 0
  let grantee = ''
  if (item[0] === '"') {
    i = 1
    for (;;) {
      if (i >= item.length) throw new Error(`bad aclitem: ${item}`)
      if (item[i] === '"') {
        if (item[i + 1] === '"') { grantee += '"'; i += 2; continue }
        i++
        break
      }
      grantee += item[i++]
    }
  } else {
    while (i < item.length && item[i] !== '=') grantee += item[i++]
  }
  if (item[i] !== '=') throw new Error(`bad aclitem: ${item}`)
  i++
  const m = /^([A-Za-z*]*)\//.exec(item.slice(i))
  if (!m) throw new Error(`bad aclitem: ${item}`)
  const privs = []
  for (const ch of m[1]) {
    if (ch === '*') { if (privs.length) privs[privs.length - 1] += '*' } else privs.push(ch)
  }
  return { grantee: grantee === '' ? 'PUBLIC' : grantee, privs }
}

// Normalize an ACL (array of aclitem text) to sorted `grantee=privs` strings. Grantors are dropped
// and one grantee's privileges from several grantors are merged, so neither grantee order nor which
// role granted creates a difference. `null` means "no ACL" and stays distinct from [].
export function normalizeAcl(acl) {
  if (acl == null) return null
  const byGrantee = new Map()
  for (const item of acl) {
    const { grantee, privs } = parseAclItem(item)
    const set = byGrantee.get(grantee) ?? new Map()
    for (const p of privs) {
      const base = p[0]
      const grantable = p.endsWith('*')
      set.set(base, (set.get(base) ?? false) || grantable)
    }
    byGrantee.set(grantee, set)
  }
  return [...byGrantee.entries()]
    .map(([g, set]) => `${g}=${[...set.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, star]) => p + (star ? '*' : '')).join('')}`)
    .filter((s) => !s.endsWith('='))
    .sort()
}

const TRUE_WORDS = new Set(['true', 'on', 'yes', '1'])
const FALSE_WORDS = new Set(['false', 'off', 'no', '0'])
const VIEW_BOOLEAN_OPTIONS = ['security_barrier', 'security_invoker']

// A view's reloptions decide whose permissions and RLS apply (security_invoker), whether quals can
// leak through (security_barrier), and what WITH CHECK OPTION enforces. Normalized so an option
// set to its default equals the option being absent: both booleans default to false and
// check_option defaults to none. Unknown options are kept verbatim.
export function normalizeViewOptions(reloptions) {
  const out = { check_option: 'none', security_barrier: false, security_invoker: false }
  for (const raw of reloptions ?? []) {
    const eq = raw.indexOf('=')
    const name = (eq < 0 ? raw : raw.slice(0, eq)).toLowerCase()
    const value = eq < 0 ? 'true' : raw.slice(eq + 1)
    if (VIEW_BOOLEAN_OPTIONS.includes(name)) {
      const v = value.toLowerCase()
      out[name] = TRUE_WORDS.has(v) ? true : FALSE_WORDS.has(v) ? false : value
    } else if (name === 'check_option') out.check_option = value.toLowerCase()
    else out[name] = value
  }
  return out
}

// A function's pg_get_functiondef text, with two differences that change nothing removed (David,
// 2026-11-21, Spec 2 Task 12): CRLF line endings become LF, and the blank space just inside the
// body's dollar quotes is trimmed. Production holds bodies saved with CRLF and some with the body on
// one line, while the repo's migrations replay them with LF. Blank space anywhere else in the body
// still counts. Accepted cost: a change that only adds or removes a CR inside a string literal is
// not seen.
export function normalizeFunctionDef(def) {
  if (def == null) return def
  const d = def.replace(/\r\n/g, '\n')
  const m = /^AS (\$[A-Za-z0-9_]*\$)/m.exec(d)
  if (!m) return d
  const open = m.index + m[0].length
  const close = d.lastIndexOf(m[1])
  if (close <= open) return d
  return d.slice(0, open) + d.slice(open, close).trim() + d.slice(close)
}

// Table reloptions (fillfactor, autovacuum_*): sorted, verbatim.
export const normalizeTableOptions = (reloptions) => [...(reloptions ?? [])].sort()

// ---------- diff and allowlist ----------

export function diffSnapshots(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const out = []
  for (const key of keys) {
    if (a[key] === b[key]) continue
    const d = { key }
    if (key in a) d.a = a[key]
    if (key in b) d.b = b[key]
    out.push(d)
  }
  return out
}

// The schema a key's qualified name sits in: the part before the first '.', or null when the name
// has no schema (extensions, publications, queues, buckets). A `schema:` key names its schema
// itself, so `schema:public` is in public.
export function schemaOfKey(key) {
  const colon = key.indexOf(':')
  if (colon < 0) return null
  const name = key.slice(colon + 1)
  if (key.slice(0, colon) === 'schema') return name
  const dot = name.indexOf('.')
  return dot < 0 ? null : name.slice(0, dot)
}

// `*` is the schema of a global default-privilege entry, which applies in `public` too.
const UNALLOWABLE_SCHEMAS = new Set(['public', '*'])
const KEY_SHAPE = /^[a-z][a-z-]*:\S/

// Each line is `<key>  # <reason>`. Blank lines and lines starting with `#` are ignored. A line with
// no reason is an error, and so is any key in schema `public` (spec criterion 9).
export function parseAllowlist(text) {
  const keys = new Set()
  const errors = []
  String(text).split(/\r?\n/).forEach((line, idx) => {
    const n = idx + 1
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const hash = line.indexOf('#')
    if (hash < 0) { errors.push(`line ${n}: no "# reason"`); return }
    const key = line.slice(0, hash).trim()
    const reason = line.slice(hash + 1).trim()
    if (reason === '') { errors.push(`line ${n}: empty reason`); return }
    if (!KEY_SHAPE.test(key)) { errors.push(`line ${n}: not a snapshot key: ${key}`); return }
    const schema = schemaOfKey(key)
    if (UNALLOWABLE_SCHEMAS.has(schema)) {
      errors.push(`line ${n}: ${key} is in schema ${schema === '*' ? '* (global default privileges, which apply in public)' : 'public'}; the allowlist may name no object in public`)
      return
    }
    keys.add(key)
  })
  return { keys, errors }
}

export function applyAllowlist(diff, keys) {
  const outside = diff.filter((d) => !keys.has(d.key))
  const allowlisted = diff.length - outside.length
  const unused = [...keys].filter((k) => !diff.some((d) => d.key === k)).sort()
  return { outside, allowlisted, unused }
}

const PRINT_DEFINITIONS = new Set(['public', 'storage', 'auth'])

export function formatDiff(outside) {
  const lines = []
  for (const d of outside) {
    const tag = !('a' in d) ? 'only in B' : !('b' in d) ? 'only in A' : 'differs'
    lines.push(`${tag}: ${d.key}`)
    if (PRINT_DEFINITIONS.has(schemaOfKey(d.key))) {
      if ('a' in d) lines.push(`  A: ${d.a}`)
      if ('b' in d) lines.push(`  B: ${d.b}`)
    }
  }
  return lines.join('\n')
}

// ---------- catalog queries ----------

// True when the object is a member of an extension; those are covered by the extension keys.
const notExtensionMember = (catalog, oidExpr) =>
  `not exists (select 1 from pg_depend dep where dep.classid = '${catalog}'::regclass and dep.objid = ${oidExpr} and dep.deptype = 'e')`

const Q = {
  relations: `
    select c.oid, c.relname, c.relkind, pg_get_userbyid(c.relowner) as owner,
           coalesce(c.relacl, acldefault('r', c.relowner))::text[] as acl,
           c.relrowsecurity, c.relforcerowsecurity, c.reloptions,
           case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end as def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and ${notExtensionMember('pg_class', 'c.oid')}`,
  columns: `
    select c.relname, a.attname, a.attnum, format_type(a.atttypid, a.atttypmod) as type,
           pg_get_expr(ad.adbin, ad.adrelid) as def, a.attnotnull, a.attidentity, a.attgenerated,
           case when a.attcollation <> t.typcollation then coll.collname end as collation,
           a.attacl::text[] as acl
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
      left join pg_collation coll on coll.oid = a.attcollation
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and a.attnum > 0 and not a.attisdropped
       and ${notExtensionMember('pg_class', 'c.oid')}
     order by c.relname, a.attnum`,
  constraints: `
    select c.relname, con.conname, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and ${notExtensionMember('pg_class', 'c.oid')}`,
  indexes: `
    select i.relname, pg_get_indexdef(i.oid) as def
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = i.relnamespace
     where n.nspname = 'public' and ${notExtensionMember('pg_class', 't.oid')}`,
  sequences: `
    select c.relname, pg_get_userbyid(c.relowner) as owner,
           coalesce(c.relacl, acldefault('s', c.relowner))::text[] as acl,
           format_type(s.seqtypid, null) as type, s.seqstart::text as start, s.seqincrement::text as increment,
           s.seqmin::text as min, s.seqmax::text as max, s.seqcache::text as cache, s.seqcycle as cycle,
           (select dc.relname || '.' || a.attname
              from pg_depend d join pg_class dc on dc.oid = d.refobjid
              join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
             where d.classid = 'pg_class'::regclass and d.objid = c.oid
               and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
             limit 1) as owned_by
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_sequence s on s.seqrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'S' and ${notExtensionMember('pg_class', 'c.oid')}`,
  triggers: `
    select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) as def, t.tgenabled::text as enabled
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal
       and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))`,
  policies: `
    select schemaname, tablename, policyname, permissive, roles::text[] as roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')`,
  functions: `
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prokind::text as kind,
           case when p.prokind <> 'a' then pg_get_functiondef(p.oid) end as def,
           pg_get_userbyid(p.proowner) as owner,
           coalesce(p.proacl, acldefault('f', p.proowner))::text[] as acl,
           p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and ${notExtensionMember('pg_proc', 'p.oid')}`,
  types: `
    select t.typname, t.typtype::text as typtype, pg_get_userbyid(t.typowner) as owner,
           coalesce(t.typacl, acldefault('T', t.typowner))::text[] as acl,
           array(select e.enumlabel::text from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder) as labels,
           array(select a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                   from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
                  order by a.attnum) as attributes,
           case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end as base,
           t.typnotnull, t.typdefault,
           array(select con.conname || ' ' || pg_get_constraintdef(con.oid)
                   from pg_constraint con where con.contypid = t.oid order by con.conname) as checks
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      left join pg_class rc on rc.oid = t.typrelid
     where n.nspname = 'public'
       and (t.typtype in ('e', 'd') or (t.typtype = 'c' and rc.relkind = 'c'))
       and ${notExtensionMember('pg_type', 't.oid')}`,
  schema: `
    select pg_get_userbyid(nspowner) as owner, coalesce(nspacl, acldefault('n', nspowner))::text[] as acl
      from pg_namespace where nspname = 'public'`,
  defaultAcls: `
    select coalesce(n.nspname, '*') as schema, pg_get_userbyid(d.defaclrole) as role,
           d.defaclobjtype::text as objtype, d.defaclacl::text[] as acl
      from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
     where d.defaclnamespace = 0 or n.nspname = 'public'`,
  publications: `
    select pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate, pubviaroot from pg_publication`,
  publicationTables: `
    select pubname, schemaname, tablename, attnames::text[] as columns, rowfilter from pg_publication_tables`,
  queues: `
    select substr(c.relname, 3) as queue
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'pgmq' and c.relkind in ('r', 'p') and c.relname like 'q\\_%'`,
  extensions: `
    select e.extname, n.nspname as schema, e.extversion from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,
  buckets: `select id, public, file_size_limit, allowed_mime_types from storage.buckets`,
}

const VIEW_KINDS = new Set(['v', 'm'])

export async function snapshotSchema(client) {
  const rows = async (sql) => (await client.query(sql)).rows
  const snap = {}
  const put = (key, value) => {
    if (key in snap) throw new Error(`duplicate snapshot key: ${key}`)
    snap[key] = canonical(value)
  }

  for (const r of await rows(Q.relations)) {
    if (VIEW_KINDS.has(r.relkind)) {
      put(`view:public.${r.relname}`, {
        kind: r.relkind, owner: r.owner, acl: normalizeAcl(r.acl), def: r.def,
        options: normalizeViewOptions(r.reloptions),
        rls: r.relrowsecurity, force_rls: r.relforcerowsecurity,
      })
    } else {
      put(`table:public.${r.relname}`, {
        kind: r.relkind, owner: r.owner, acl: normalizeAcl(r.acl),
        rls: r.relrowsecurity, force_rls: r.relforcerowsecurity,
        options: normalizeTableOptions(r.reloptions),
      })
    }
  }
  let rel = null, position = 0
  for (const r of await rows(Q.columns)) {
    if (r.relname !== rel) { rel = r.relname; position = 0 }
    position++
    put(`column:public.${r.relname}.${r.attname}`, {
      position, type: r.type, default: r.def, not_null: r.attnotnull,
      identity: r.attidentity || null, generated: r.attgenerated || null,
      collation: r.collation, acl: normalizeAcl(r.acl),
    })
  }
  for (const r of await rows(Q.constraints)) put(`constraint:public.${r.relname}.${r.conname}`, r.def)
  for (const r of await rows(Q.indexes)) put(`index:public.${r.relname}`, r.def)
  for (const r of await rows(Q.sequences)) {
    put(`sequence:public.${r.relname}`, {
      owner: r.owner, acl: normalizeAcl(r.acl), type: r.type, start: r.start, increment: r.increment,
      min: r.min, max: r.max, cache: r.cache, cycle: r.cycle, owned_by: r.owned_by,
    })
  }
  for (const r of await rows(Q.triggers)) put(`trigger:${r.nspname}.${r.relname}.${r.tgname}`, { def: r.def, enabled: r.enabled })
  for (const r of await rows(Q.policies)) {
    put(`policy:${r.schemaname}.${r.tablename}.${r.policyname}`, {
      permissive: r.permissive, roles: [...(r.roles ?? [])].sort(), cmd: r.cmd, qual: r.qual, with_check: r.with_check,
    })
  }
  for (const r of await rows(Q.functions)) {
    put(`function:public.${r.proname}(${r.args})`, {
      kind: r.kind, def: normalizeFunctionDef(r.def), owner: r.owner, acl: normalizeAcl(r.acl),
      security_definer: r.prosecdef, config: r.proconfig ? [...r.proconfig].sort() : null,
    })
  }
  for (const r of await rows(Q.types)) {
    const v = { typtype: r.typtype, owner: r.owner, acl: normalizeAcl(r.acl) }
    if (r.typtype === 'e') v.labels = r.labels
    if (r.typtype === 'c') v.attributes = r.attributes
    if (r.typtype === 'd') Object.assign(v, { base: r.base, not_null: r.typnotnull, default: r.typdefault, checks: r.checks })
    put(`type:public.${r.typname}`, v)
  }
  for (const r of await rows(Q.schema)) put('schema:public', { owner: r.owner, acl: normalizeAcl(r.acl) })
  for (const r of await rows(Q.defaultAcls)) put(`default-acl:${r.schema}.${r.role}.${r.objtype}`, normalizeAcl(r.acl))
  for (const r of await rows(Q.publications)) {
    put(`publication:${r.pubname}`, {
      all_tables: r.puballtables, insert: r.pubinsert, update: r.pubupdate, delete: r.pubdelete,
      truncate: r.pubtruncate, via_root: r.pubviaroot,
    })
  }
  for (const r of await rows(Q.publicationTables)) {
    put(`publication-table:${r.schemaname}.${r.tablename}@${r.pubname}`, { columns: r.columns, rowfilter: r.rowfilter })
  }
  const hasPgmq = (await rows(`select 1 from pg_namespace where nspname = 'pgmq'`)).length > 0
  if (hasPgmq) for (const r of await rows(Q.queues)) put(`pgmq-queue:${r.queue}`, 'present')
  for (const r of await rows(Q.extensions)) {
    put(`extension:${r.extname}`, r.schema)
    put(`extension-version:${r.extname}`, r.extversion)
  }
  // storage.buckets is data, not catalog: it needs SELECT (Task 27's grants). Unreadable is
  // recorded, not fatal, and is allowlisted only with David's agreement.
  try {
    for (const r of await rows(Q.buckets)) {
      put(`bucket:${r.id}`, {
        public: r.public, file_size_limit: r.file_size_limit == null ? null : String(r.file_size_limit),
        allowed_mime_types: r.allowed_mime_types ? [...r.allowed_mime_types].sort() : null,
      })
    }
  } catch (e) {
    if (e?.code !== '42501' && e?.code !== '42P01') throw e
    put('buckets:unreadable', e.code)
  }
  return Object.fromEntries(Object.entries(snap).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

// ---------- CLI ----------

function arg(argv, name) {
  const i = argv.indexOf(name)
  if (i < 0 || !argv[i + 1]) throw new Error(`${name} is required`)
  return argv[i + 1]
}

// Applies the comparison-time normalizations to a snapshot read from a file, so a snapshot written
// before a normalization existed compares the same as a fresh one. Idempotent.
export function normalizeSnapshot(snap) {
  const out = {}
  for (const [key, value] of Object.entries(snap)) {
    if (key.startsWith('function:')) {
      const v = JSON.parse(value)
      out[key] = canonical({ ...v, def: normalizeFunctionDef(v.def) })
    } else out[key] = value
  }
  return out
}

export function compareFiles(aPath, bPath, allowlistPath) {
  const { keys, errors } = parseAllowlist(readFileSync(allowlistPath, 'utf8'))
  if (errors.length) return { code: 2, text: `allowlist errors:\n  ${errors.join('\n  ')}` }
  const a = normalizeSnapshot(JSON.parse(readFileSync(aPath, 'utf8')))
  const b = normalizeSnapshot(JSON.parse(readFileSync(bPath, 'utf8')))
  const { outside, allowlisted, unused } = applyAllowlist(diffSnapshots(a, b), keys)
  const parts = []
  if (outside.length) parts.push(formatDiff(outside))
  if (unused.length) parts.push(`allowlist lines that matched no difference:\n  ${unused.join('\n  ')}`)
  parts.push(`${outside.length} differences outside allowlist (${allowlisted} allowlisted)`)
  return { code: outside.length ? 1 : 0, text: parts.join('\n') }
}

async function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'snapshot') {
    const envName = arg(rest, '--db-url-env')
    const out = arg(rest, '--out')
    const client = await connect(envName, { readOnly: true })
    try {
      const snap = await snapshotSchema(client)
      writeFileSync(out, `${JSON.stringify(snap, null, 1)}\n`)
      console.log(`schema-snapshot: ${Object.keys(snap).length} keys written to ${out}`)
    } finally {
      await client.end()
    }
    return 0
  }
  if (cmd === 'compare') {
    const [aPath, bPath] = rest.filter((x, i) => !x.startsWith('--') && rest[i - 1] !== '--allowlist')
    if (!aPath || !bPath) throw new Error('compare needs two snapshot files')
    const { code, text } = compareFiles(aPath, bPath, arg(rest, '--allowlist'))
    console.log(text)
    return code
  }
  console.error('usage: schema-snapshot.mjs snapshot --db-url-env NAME --out FILE | compare A.json B.json --allowlist FILE')
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    console.error(`schema-snapshot: ${e.message}`)
    process.exitCode = 1
  })
}
