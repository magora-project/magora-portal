// Tests for scripts/db/schema-snapshot.mjs (pure functions; no database).
// Run: node scripts/db/schema-snapshot.test.mjs
import {
  canonical, parseAclItem, normalizeAcl, normalizeViewOptions, normalizeFunctionDef, normalizeSnapshot, diffSnapshots, schemaOfKey,
  parseAllowlist, applyAllowlist, formatDiff, snapshotInTransaction, SNAPSHOT_BEGIN,
} from './schema-snapshot.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// One policy differs -> one diff naming the key.
{
  const a = { 'policy:public.t.p': canonical({ cmd: 'SELECT', qual: 'true' }), 'table:public.t': 'x' }
  const b = { 'policy:public.t.p': canonical({ cmd: 'SELECT', qual: 'false' }), 'table:public.t': 'x' }
  const d = diffSnapshots(a, b)
  ok('one policy change -> one diff naming the key', d.length === 1 && d[0].key === 'policy:public.t.p')
  ok('added key -> diff with only b', eq(diffSnapshots({}, { k: '1' }), [{ key: 'k', b: '1' }]))
  ok('removed key -> diff with only a', eq(diffSnapshots({ k: '1' }, {}), [{ key: 'k', a: '1' }]))
  ok('identical -> empty', diffSnapshots(a, { ...a }).length === 0)
}

// ACL normalization.
ok('grantee order does not create a diff',
  canonical(normalizeAcl(['postgres=arwdDxtm/postgres', 'anon=r/postgres'])) === canonical(normalizeAcl(['anon=r/postgres', 'postgres=arwdDxtm/postgres'])))
ok('grantor does not create a diff', eq(normalizeAcl(['anon=r/postgres']), normalizeAcl(['anon=r/supabase_admin'])))
ok('privilege letter order does not create a diff', eq(normalizeAcl(['anon=wr/postgres']), normalizeAcl(['anon=rw/postgres'])))
ok('privileges from two grantors merge', eq(normalizeAcl(['anon=r/a', 'anon=w/b']), ['anon=rw']))
ok('grant option kept', eq(normalizeAcl(['anon=r*w/postgres']), ['anon=r*w']))
ok('grant option is a difference', !eq(normalizeAcl(['anon=r*/postgres']), normalizeAcl(['anon=r/postgres'])))
ok('a new privilege is a difference', !eq(normalizeAcl(['anon=r/postgres']), normalizeAcl(['anon=rw/postgres'])))
ok('empty grantee is PUBLIC', eq(normalizeAcl(['=X/postgres']), ['PUBLIC=X']))
ok('quoted grantee with "" escape and = inside', parseAclItem('"we""ird=x"=r/postgres').grantee === 'we"ird=x')
ok('null ACL stays null', normalizeAcl(null) === null)
ok('malformed item throws', (() => { try { parseAclItem('anon'); return false } catch { return true } })())

// View options.
ok('security_invoker=false equals absent', canonical(normalizeViewOptions(['security_invoker=false'])) === canonical(normalizeViewOptions(null)))
ok('security_invoker=true differs from absent', canonical(normalizeViewOptions(['security_invoker=true'])) !== canonical(normalizeViewOptions([])))
ok('security_invoker=on equals true', canonical(normalizeViewOptions(['security_invoker=on'])) === canonical(normalizeViewOptions(['security_invoker=true'])))
ok('security_barrier is captured', normalizeViewOptions(['security_barrier=true']).security_barrier === true)
ok('check_option is captured', normalizeViewOptions(['check_option=cascaded']).check_option === 'cascaded')
ok('option order does not matter',
  canonical(normalizeViewOptions(['security_barrier=true', 'security_invoker=true'])) === canonical(normalizeViewOptions(['security_invoker=true', 'security_barrier=true'])))

// schemaOfKey.
ok('schemaOfKey table', schemaOfKey('table:public.x') === 'public')
ok('schemaOfKey function with dotted args', schemaOfKey('function:auth.uid()') === 'auth')
ok('schemaOfKey extension -> null', schemaOfKey('extension:pgcrypto') === null)
ok('schemaOfKey publication-table', schemaOfKey('publication-table:public.t@supabase_realtime') === 'public')
// A schema key names its schema directly (conformance D11): schema:public is in public.
ok('schemaOfKey schema:public -> public', schemaOfKey('schema:public') === 'public')
ok('schemaOfKey schema:storage -> storage', schemaOfKey('schema:storage') === 'storage')
{
  const { keys, errors } = parseAllowlist('schema:public  # owner drift\n')
  ok('allowlist refuses schema:public', keys.size === 0 && errors.length === 1 && /public/.test(errors[0]))
}

// Allowlist.
{
  const r = parseAllowlist('table:public.x  # because\n')
  ok('a public key is an error mentioning public', r.errors.length === 1 && r.errors[0].includes('public') && r.keys.size === 0)
}
ok('a line with no # reason is an error', parseAllowlist('extension:pg_net\n').errors.length === 1)
ok('a line with an empty reason is an error', parseAllowlist('extension:pg_net  #   \n').errors.length === 1)
ok('a global default-acl key is an error', parseAllowlist('default-acl:*.postgres.r  # global\n').errors.length === 1)
ok('a public default-acl key is an error', parseAllowlist('default-acl:public.postgres.r  # x\n').errors.length === 1)
ok('a public view key (reloptions) is an error', parseAllowlist('view:public.v  # x\n').errors.length === 1)
ok('a non-key line is an error', parseAllowlist('just words  # x\n').errors.length === 1)
{
  const r = parseAllowlist('# header comment\n\nextension-version:pg_net  # Supabase-managed version\r\ntrigger:auth.users.x  # y\n')
  ok('comments, blanks and CRLF tolerated; two keys', r.errors.length === 0 && r.keys.size === 2 && r.keys.has('extension-version:pg_net'))
}

// An allowlisted key is removed from the diff.
{
  const diff = diffSnapshots({ 'extension-version:pg_net': '"0.1"', 'table:public.t': 'a' }, { 'extension-version:pg_net': '"0.2"', 'table:public.t': 'b' })
  const { keys } = parseAllowlist('extension-version:pg_net  # managed by Supabase\nextension-version:unused  # stale\n')
  const r = applyAllowlist(diff, keys)
  ok('allowlisted key removed from the diff', r.outside.length === 1 && r.outside[0].key === 'table:public.t' && r.allowlisted === 1)
  ok('unused allowlist lines reported', eq(r.unused, ['extension-version:unused']))
}

// Output prints definitions only for public, storage and auth.
{
  const text = formatDiff([
    { key: 'table:public.t', a: 'A-DEF', b: 'B-DEF' },
    { key: 'policy:storage.objects.p', a: 'S-DEF' },
    { key: 'extension-version:pg_net', a: 'V1', b: 'V2' },
    { key: 'trigger:cron.job.x', b: 'C-DEF' },
  ])
  ok('public definitions printed', text.includes('A-DEF') && text.includes('B-DEF'))
  ok('storage definitions printed', text.includes('S-DEF'))
  ok('other definitions not printed', !text.includes('V1') && !text.includes('C-DEF') && text.includes('extension-version:pg_net'))
}

// Function definitions: CRLF and the blank space just inside the body's dollar quotes do not count
// (production holds bodies saved with CRLF; David, 2026-11-21). Anything else still differs.
{
  const head = 'CREATE OR REPLACE FUNCTION public.f(n uuid)\n RETURNS integer\n LANGUAGE sql\n'
  const lf = `${head}AS $function$\n  select 1;\n$function$\n`
  ok('CRLF equals LF', normalizeFunctionDef(lf.replace(/\n/g, '\r\n')) === normalizeFunctionDef(lf))
  ok('body-edge blank space does not count', normalizeFunctionDef(`${head}AS $function$ select 1; $function$\n`) === normalizeFunctionDef(lf))
  ok('a changed statement still differs', normalizeFunctionDef(`${head}AS $function$\n  select 2;\n$function$\n`) !== normalizeFunctionDef(lf))
  ok('blank space inside the body still counts', normalizeFunctionDef(`${head}AS $function$\n  select  1;\n$function$\n`) !== normalizeFunctionDef(lf))
  ok('a changed header still differs', normalizeFunctionDef(lf.replace('LANGUAGE sql', 'LANGUAGE plpgsql')) !== normalizeFunctionDef(lf))
  ok('a literal is untouched apart from CRLF', normalizeFunctionDef(`${head}AS $function$ select ' x '; $function$\n`).includes("select ' x ';"))
  const tagged = `${head}AS $function1$\n  select '$function$';\n$function1$\n`
  ok('another dollar tag is trimmed at its own delimiters', normalizeFunctionDef(tagged).includes("AS $function1$select '$function$';$function1$"))
  const atomic = 'CREATE OR REPLACE FUNCTION public.g()\r\n RETURNS integer\r\n LANGUAGE sql\r\nBEGIN ATOMIC\r\n SELECT 1;\r\nEND\r\n'
  ok('a body with no dollar quotes only loses CR', normalizeFunctionDef(atomic) === atomic.replace(/\r\n/g, '\n'))
  ok('null (an aggregate) stays null', normalizeFunctionDef(null) === null)
}
{
  // A snapshot file written before the normalization compares equal to a fresh one, and nothing
  // else in it changes.
  const fn = (def) => canonical({ acl: [], def, kind: 'f', owner: 'postgres' })
  const old = { 'function:public.f()': fn('X\r\nAS $function$ select 1; $function$\r\n'), 'table:public.t': 'T\r\n' }
  const fresh = { 'function:public.f()': fn('X\nAS $function$select 1;$function$\n'), 'table:public.t': 'T\r\n' }
  ok('normalizeSnapshot: old file equals fresh', eq(normalizeSnapshot(old), normalizeSnapshot(fresh)))
  ok('normalizeSnapshot: non-function values untouched', normalizeSnapshot(old)['table:public.t'] === 'T\r\n')
  ok('normalizeSnapshot: idempotent', eq(normalizeSnapshot(normalizeSnapshot(old)), normalizeSnapshot(old)))
  ok('normalizeSnapshot: a real body change survives', !eq(normalizeSnapshot(old), normalizeSnapshot({ ...fresh, 'function:public.f()': fn('X\nAS $function$select 2;$function$\n') })))
}

// snapshotInTransaction: one REPEATABLE READ READ ONLY transaction around every read.
{
  const log = []
  const c = { query: async (q) => { log.push(q.trim().split(/\s+/).slice(0, 2).join(' ')); return { rows: [] } } }
  await snapshotInTransaction(c)
  ok('snapshotInTransaction: begins repeatable read read only first', log[0] === 'begin isolation' && log.length > 3)
  ok('snapshotInTransaction: commits last', log.at(-1) === 'commit')
}
{
  const log = []
  let n = 0
  const c = { query: async (q) => { log.push(q.trim().split(/\s+/)[0]); if (++n === 3) { const e = new Error('boom'); e.code = 'XX000'; throw e } return { rows: [] } } }
  let msg = null
  try { await snapshotInTransaction(c) } catch (e) { msg = e.message }
  ok('snapshotInTransaction: a failed read rolls back and rethrows', msg === 'boom' && log.at(-1) === 'rollback' && !log.includes('commit'))
}
ok('SNAPSHOT_BEGIN text', SNAPSHOT_BEGIN === 'begin isolation level repeatable read read only')

console.log(`schema-snapshot: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
