// Integration test for scripts/db/apply-migrations.mjs applyFiles. Run by `npm run test:db` against
// a throwaway local stack. A file that manages its own transaction must commit it: one that leaves a
// transaction open fails and its work is gone, and a complete BEGIN/COMMIT file is applied.
import { connect } from './pg.mjs'
import { applyFiles } from './apply-migrations.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const port = Number(process.env.MAGORA_LOCAL_DB_PORT)
const client = await connect('MAGORA_LOCAL_DB_URL', { writeTarget: 'local', localPorts: [port] })
const exists = async (t) => (await client.query(`select to_regclass('public.${t}') is not null as e`)).rows[0].e
const TEARDOWN = 'drop table if exists public.itest_open_probe; drop table if exists public.itest_committed'

try {
  await client.query(TEARDOWN)
  const files = {
    'open.sql': 'begin;\ncreate table public.itest_open_probe (id int);\n',
    'closed.sql': 'begin;\ncreate table public.itest_committed (id int);\ncommit;\n',
  }
  const read = (p) => files[p]

  let msg = null
  try { await applyFiles(client, ['open.sql'], { read }) } catch (e) { msg = e.message }
  ok('BEGIN without COMMIT fails, naming the file', msg?.startsWith('open.sql: open-transaction:'), msg)
  ok('its work is rolled back', !(await exists('itest_open_probe')))
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
