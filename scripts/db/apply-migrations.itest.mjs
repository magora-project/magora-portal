// Integration test for scripts/db/apply-migrations.mjs applyFiles. Run by `npm run test:db` against
// a throwaway local stack. A file that manages its own transaction must be exactly one BEGIN/COMMIT:
// one that leaves a transaction open, or would commit part of itself and then fail, is refused and
// leaves nothing behind, and a complete BEGIN/COMMIT file is applied.
import { connect } from './pg.mjs'
import { applyFiles } from './apply-migrations.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const port = Number(process.env.MAGORA_LOCAL_DB_PORT)
const client = await connect('MAGORA_LOCAL_DB_URL', { writeTarget: 'local', localPorts: [port] })
const exists = async (t) => (await client.query(`select to_regclass('public.${t}') is not null as e`)).rows[0].e
const TEARDOWN = 'drop table if exists public.itest_open_probe; drop table if exists public.itest_committed; drop table if exists public.itest_partial'

try {
  await client.query(TEARDOWN)
  const files = {
    'open.sql': 'begin;\ncreate table public.itest_open_probe (id int);\n',
    'split.sql': 'BEGIN; CREATE TABLE public.itest_partial (id int); COMMIT; SELECT 1/0;',
    'closed.sql': 'begin;\ncreate table public.itest_committed (id int);\ncommit;\n',
  }
  const read = (p) => files[p]

  let msg = null
  try { await applyFiles(client, ['open.sql'], { read }) } catch (e) { msg = e.message }
  ok('BEGIN without COMMIT is refused, naming the file', msg?.startsWith('open.sql: transaction-layout:'), msg)
  ok('nothing of it is applied', !(await exists('itest_open_probe')))
  msg = null
  try { await applyFiles(client, ['split.sql'], { read }) } catch (e) { msg = e.message }
  ok('a statement after COMMIT is refused, naming the file', msg?.startsWith('split.sql: transaction-layout:'), msg)
  ok('nothing of it is committed', !(await exists('itest_partial')))
  ok('the connection is usable afterwards, outside a transaction', (await client.query('select 1 as one')).rows[0].one === 1)

  const seen = []
  await applyFiles(client, ['closed.sql'], { read, onEach: (p) => seen.push(p) })
  ok('a complete BEGIN/COMMIT file is applied and reported', (await exists('itest_committed')) && seen.join() === 'closed.sql')
} finally {
  try { await client.query(TEARDOWN) } catch (e) { fail++; console.log('  FAIL teardown', e.message) }
  await client.end()
}

console.log(`apply-migrations itest: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
