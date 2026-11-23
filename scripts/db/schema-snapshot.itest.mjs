// Integration test for scripts/db/schema-snapshot.mjs (Spec 2 plan Task 10 Step 5). Run by
// `npm run test:db`, which supplies MAGORA_LOCAL_DB_URL and MAGORA_LOCAL_DB_PORT for a throwaway
// local stack. Sabotages each property the snapshot must see, one at a time: the diff must be
// exactly the expected key, and after the undo it must be empty.
import { readFileSync } from 'node:fs'
import { connect } from './pg.mjs'
import { snapshotSchema, diffSnapshots } from './schema-snapshot.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const port = Number(process.env.MAGORA_LOCAL_DB_PORT)
const client = await connect('MAGORA_LOCAL_DB_URL', { writeTarget: 'local', localPorts: [port] })
const q = (sql) => client.query(sql)

const SETUP = `
  create role itest_owner nologin;
  grant itest_owner to postgres;
  -- ALTER ... OWNER TO needs the new owner to hold CREATE on the schema.
  grant create on schema public to itest_owner;
  create role itest_reader nologin;
  create schema itest_ca;
  create schema itest_cb;
  create collation itest_ca.sorting (locale = 'C');
  create collation itest_cb.sorting (locale = 'POSIX');
  create table public.itest_t (id int primary key, c text, c2 text collate itest_ca.sorting);
  create table public.itest_u (k int);
  insert into public.itest_u values (1), (2);
  create unique index itest_u_k on public.itest_u (k);
  create sequence public.itest_seq;
  create view public.itest_v as select id from public.itest_t;
  create function public.itest_f() returns int language sql as 'select 1';
  create function public.itest_trg() returns trigger language plpgsql as 'begin return new; end';
  create table public.itest_pt (k int) partition by range (k);
  create table public.itest_pt1 partition of public.itest_pt for values from (0) to (10);
  create aggregate public.itest_agg(int) (sfunc = int4pl, stype = int, initcond = '0');
`
const TEARDOWN = `
  drop trigger if exists itest_on_user on auth.users;
  do $$ begin
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'itest_t') then
      alter publication supabase_realtime drop table public.itest_t;
    end if;
  end $$;
  drop view if exists public.itest_v;
  drop table if exists public.itest_t;
  drop table if exists public.itest_pt;
  drop table if exists public.itest_u;
  drop sequence if exists public.itest_seq;
  drop schema if exists itest_ca cascade;
  drop schema if exists itest_cb cascade;
  drop aggregate if exists public.itest_agg(int);
  drop function if exists public.itest_f();
  drop function if exists public.itest_trg();
  do $$ begin
    if exists (select 1 from pg_roles where rolname = 'itest_reader') then
      alter default privileges in schema public revoke all on tables from itest_reader;
      alter default privileges revoke all on tables from itest_reader;
    end if;
  end $$;
  revoke create on schema public from anon;
  do $$ begin
    if exists (select 1 from pg_roles where rolname = 'itest_owner') then
      revoke create on schema public from itest_owner;
    end if;
  end $$;
  drop role if exists itest_owner;
  drop role if exists itest_reader;
`

// [name, sabotage, undo, expected key]
const CASES = [
  ['add a policy', 'create policy itest_p on public.itest_t for select using (true)', 'drop policy itest_p on public.itest_t', 'policy:public.itest_t.itest_p'],
  ['GRANT UPDATE (col) to anon', 'grant update (c) on public.itest_t to anon', 'revoke update (c) on public.itest_t from anon', 'column:public.itest_t.c'],
  ['SECURITY DEFINER', 'alter function public.itest_f() security definer', 'alter function public.itest_f() security invoker', 'function:public.itest_f()'],
  ['SET search_path', 'alter function public.itest_f() set search_path = public', 'alter function public.itest_f() reset search_path', 'function:public.itest_f()'],
  ['OWNER TO another role', 'alter function public.itest_f() owner to itest_owner', 'alter function public.itest_f() owner to postgres', 'function:public.itest_f()'],
  ['FORCE ROW LEVEL SECURITY', 'alter table public.itest_t force row level security', 'alter table public.itest_t no force row level security', 'table:public.itest_t'],
  ['GRANT CREATE ON SCHEMA public TO anon', 'grant create on schema public to anon', 'revoke create on schema public from anon', 'schema:public'],
  ['ALTER DEFAULT PRIVILEGES IN SCHEMA public', 'alter default privileges in schema public grant select on tables to itest_reader',
    'alter default privileges in schema public revoke select on tables from itest_reader', 'default-acl:public.postgres.r'],
  ['ALTER DEFAULT PRIVILEGES (global)', 'alter default privileges grant select on tables to itest_reader',
    'alter default privileges revoke select on tables from itest_reader', 'default-acl:*.postgres.r'],
  ['add a table to supabase_realtime', 'alter publication supabase_realtime add table public.itest_t',
    'alter publication supabase_realtime drop table public.itest_t', 'publication-table:public.itest_t@supabase_realtime'],
  ['add a trigger on auth.users', 'create trigger itest_on_user after insert on auth.users for each row execute function public.itest_trg()',
    'drop trigger itest_on_user on auth.users', 'trigger:auth.users.itest_on_user'],
  // A view's security_invoker changes whose permissions and RLS apply, with the query unchanged.
  ['flip a view to security_invoker', 'alter view public.itest_v set (security_invoker = true)', 'alter view public.itest_v reset (security_invoker)', 'view:public.itest_v'],
  ['set a view security_barrier', 'alter view public.itest_v set (security_barrier = true)', 'alter view public.itest_v reset (security_barrier)', 'view:public.itest_v'],
  // Replica identity decides what UPDATE and DELETE publish; neither change touches an index definition.
  ['REPLICA IDENTITY FULL', 'alter table public.itest_t replica identity full', 'alter table public.itest_t replica identity default', 'table:public.itest_t'],
  ['REPLICA IDENTITY USING INDEX', 'alter table public.itest_t replica identity using index itest_t_pkey', 'alter table public.itest_t replica identity default', 'table:public.itest_t'],
  // Same columns, different bounds: inserts route differently.
  ['move a partition to other bounds',
    'alter table public.itest_pt detach partition public.itest_pt1; alter table public.itest_pt attach partition public.itest_pt1 for values from (10) to (20)',
    'alter table public.itest_pt detach partition public.itest_pt1; alter table public.itest_pt attach partition public.itest_pt1 for values from (0) to (10)',
    'table:public.itest_pt1'],
  // Only INITCOND changes: the aggregate returns different results.
  ['SET UNLOGGED (table)', 'alter table public.itest_u set unlogged', 'alter table public.itest_u set logged', 'table:public.itest_u'],
  ['SET UNLOGGED (sequence)', 'alter sequence public.itest_seq set unlogged', 'alter sequence public.itest_seq set logged', 'sequence:public.itest_seq'],
  ['a same-named collation in another schema', 'alter table public.itest_t alter column c2 type text collate itest_cb.sorting',
    'alter table public.itest_t alter column c2 type text collate itest_ca.sorting', 'column:public.itest_t.c2'],
  ['change an aggregate INITCOND', `create or replace aggregate public.itest_agg(int) (sfunc = int4pl, stype = int, initcond = '10')`,
    `create or replace aggregate public.itest_agg(int) (sfunc = int4pl, stype = int, initcond = '0')`, 'function:public.itest_agg(integer)'],
]

try {
  await q(TEARDOWN)
  await q(readFileSync(new URL('../../supabase/setup/roles.sql', import.meta.url), 'utf8'))
  await q(SETUP)
  const hasRealtime = (await q(`select 1 from pg_publication where pubname = 'supabase_realtime'`)).rows.length > 0
  if (!hasRealtime) await q('create publication supabase_realtime')
  const base = await snapshotSchema(client)
  ok('baseline sees the fixture view', 'view:public.itest_v' in base)
  {
    const pt = JSON.parse(base['table:public.itest_pt'] ?? '{}'), pt1 = JSON.parse(base['table:public.itest_pt1'] ?? '{}')
    ok('partitioned table: key captured', pt.partition_key === 'RANGE (k)', JSON.stringify(pt))
    ok('partition: parent and bounds captured', pt1.partition_of === 'public.itest_pt' && pt1.partition_bound === 'FOR VALUES FROM (0) TO (10)', JSON.stringify(pt1))
    const t = JSON.parse(base['table:public.itest_t'] ?? '{}')
    ok('plain table: permanent', t.persistence === 'p', JSON.stringify(t))
    ok('column collation: schema-qualified', JSON.parse(base['column:public.itest_t.c2'] ?? '{}').collation === 'itest_ca.sorting', base['column:public.itest_t.c2'])
    const ix = JSON.parse(base['index:public.itest_u_k'] ?? '{}')
    ok('index: definition, valid and ready', /^CREATE UNIQUE INDEX itest_u_k ON public.itest_u/.test(ix.def) && ix.valid === true && ix.ready === true, JSON.stringify(ix))
    ok('plain table: replica identity default, no partition fields', t.replica_identity === 'd' && t.replica_identity_index === null && t.partition_key === null && t.partition_of === null, JSON.stringify(t))
    const agg = JSON.parse(base['function:public.itest_agg(integer)'] ?? '{}')
    ok('aggregate: definition captured from pg_aggregate', JSON.parse(agg.def ?? '{}').initcond === '0', JSON.stringify(agg))
  }
  ok('a second snapshot is identical', diffSnapshots(base, await snapshotSchema(client)).length === 0)

  for (const [name, sabotage, undo, key] of CASES) {
    try { await q(sabotage) } catch (e) { throw new Error(`${name}: sabotage failed: ${e.message}`, { cause: e }) }
    const keys = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok(`${name}: diff is exactly ${key}`, keys.length === 1 && keys[0] === key, JSON.stringify(keys))
    await q(undo)
    const after = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok(`${name}: empty after undo`, after.length === 0, JSON.stringify(after))
  }

  // A failed CREATE INDEX CONCURRENTLY leaves behind an index with the same definition that is not
  // valid. Each statement runs on its own: CONCURRENTLY cannot run inside a transaction block.
  {
    await q('drop index public.itest_u_k')
    await q('insert into public.itest_u values (1)')
    let failed = false
    try { await q('create unique index concurrently itest_u_k on public.itest_u (k)') } catch { failed = true }
    ok('invalid index: the failed build leaves the index behind', failed)
    const keys = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok('invalid index: diff is exactly index:public.itest_u_k', keys.length === 1 && keys[0] === 'index:public.itest_u_k', JSON.stringify(keys))
    await q('drop index public.itest_u_k')
    await q('delete from public.itest_u where k = 1')
    await q('insert into public.itest_u values (1)')
    await q('create unique index itest_u_k on public.itest_u (k)')
    const after = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok('invalid index: empty after undo', after.length === 0, JSON.stringify(after))
  }

  // Setting an option to its default is not a change.
  await q('alter view public.itest_v set (security_invoker = false)')
  ok('security_invoker = false equals absent', diffSnapshots(base, await snapshotSchema(client)).length === 0)
  await q('alter view public.itest_v reset (security_invoker)')

  if (!hasRealtime) await q('drop publication supabase_realtime')
} finally {
  try { await q(TEARDOWN) } catch (e) { fail++; console.log('  FAIL teardown', e.message) }
  await client.end()
}

console.log(`schema-snapshot itest: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
