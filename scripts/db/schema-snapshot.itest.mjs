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
  create table public.itest_t (id int primary key, c text);
  create view public.itest_v as select id from public.itest_t;
  create function public.itest_f() returns int language sql as 'select 1';
  create function public.itest_trg() returns trigger language plpgsql as 'begin return new; end';
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
]

try {
  await q(TEARDOWN)
  await q(readFileSync(new URL('../../supabase/setup/roles.sql', import.meta.url), 'utf8'))
  await q(SETUP)
  const hasRealtime = (await q(`select 1 from pg_publication where pubname = 'supabase_realtime'`)).rows.length > 0
  if (!hasRealtime) await q('create publication supabase_realtime')
  const base = await snapshotSchema(client)
  ok('baseline sees the fixture view', 'view:public.itest_v' in base)
  ok('a second snapshot is identical', diffSnapshots(base, await snapshotSchema(client)).length === 0)

  for (const [name, sabotage, undo, key] of CASES) {
    try { await q(sabotage) } catch (e) { throw new Error(`${name}: sabotage failed: ${e.message}`, { cause: e }) }
    const keys = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok(`${name}: diff is exactly ${key}`, keys.length === 1 && keys[0] === key, JSON.stringify(keys))
    await q(undo)
    const after = diffSnapshots(base, await snapshotSchema(client)).map((d) => d.key)
    ok(`${name}: empty after undo`, after.length === 0, JSON.stringify(after))
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
