// Tests for scripts/secrets/inventory-check.mjs. Run: node scripts/secrets/inventory-check.test.mjs
import { parseInventory, compareNames, listStoreNames, storesOf } from './inventory-check.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const MD = `# Inventory

| Name | Environment (production/staging) | 1Password reference | Copies | Injected? |
|---|---|---|---|---|
| A_KEY | production | op://Magora Project/svc/A_KEY | vercel:production; vercel:preview | no |
| SUPABASE_URL | production | op://Magora Project/supabase/SUPABASE_URL | supabase-fn:abc | yes |
| B_KEY | staging | op://Magora Staging/svc/B_KEY | github:staging-sync | no |
`
const rows = parseInventory(MD)
ok('parse: 3 rows', rows.length === 3)
ok('parse: name', rows[0].name === 'A_KEY')
ok('parse: environment', rows[0].environment === 'production')
ok('parse: reference', rows[0].reference === 'op://Magora Project/svc/A_KEY')
ok('parse: copies split', rows[0].copies.length === 2 && rows[0].copies[1] === 'vercel:preview')
ok('parse: injected flag', rows[1].injected === true && rows[0].injected === false)
ok('parse: header and separator skipped', !rows.some((r) => r.name === 'Name' || r.name.startsWith('-')))
ok('parse: TBD copies dropped', parseInventory('| X | production | op://Magora Project/s/X | TBD (David) | no |').every((r) => r.copies.length === 0))

// unrecorded or malformed Copies must be problems, not silent passes
const rowOf = (copies, inj = 'no') => parseInventory(`| X_KEY | production | op://Magora Project/s/X_KEY | ${copies} | ${inj} |`)
const tbd = compareNames(rowOf('TBD (David)'), [])
ok('compare: TBD row -> no copies recorded', tbd.some((p) => p.includes('X_KEY') && p.includes('no copies recorded')))
ok('compare: TBD token named', tbd.some((p) => p.includes('X_KEY') && p.includes('TBD (David)')))
const typo = compareNames(rowOf('vercel:prod; github :staging'), [])
ok('compare: typo tokens each named', typo.some((p) => p.includes('vercel:prod')) && typo.some((p) => p.includes('github :staging')))
ok('compare: typo-only row -> no copies recorded', typo.some((p) => p.includes('no copies recorded')))
ok('compare: empty copies -> no copies recorded', compareNames(rowOf(''), []).some((p) => p.includes('no copies recorded')))
ok('compare: injected row with no copies is fine', compareNames(rowOf('', 'yes'), []).length === 0)
ok('compare: valid + typo -> only the typo', compareNames(rowOf('vercel:production; vercel:prod'), [{ store: 'vercel:production', names: ['X_KEY'] }]).length === 1)
const FIXTURE = `| Name | Environment (production/staging) | 1Password reference | Copies | Injected? |
|---|---|---|---|---|
| FIX_KEY | production | op://Magora Project/s/FIX_KEY | TBD (David) | no |
`
const fixProblems = compareNames(parseInventory(FIXTURE), [])
ok('fixture: TBD row -> no copies recorded', fixProblems.some((p) => p.includes('FIX_KEY') && p.includes('no copies recorded')))
ok('fixture: TBD row -> bad token named', fixProblems.some((p) => p.includes('FIX_KEY') && p.includes('TBD (David)')))

ok('stores: union', JSON.stringify(storesOf(rows)) === JSON.stringify(['github:staging-sync', 'supabase-fn:abc', 'vercel:preview', 'vercel:production']))

const full = [
  { store: 'vercel:production', names: ['A_KEY'] },
  { store: 'vercel:preview', names: ['A_KEY'] },
  { store: 'supabase-fn:abc', names: [] },
  { store: 'github:staging-sync', names: ['B_KEY'] },
]
ok('compare: clean -> no problems', compareNames(rows, full).length === 0)

const missing = compareNames(rows, full.map((l) => (l.store === 'vercel:preview' ? { ...l, names: [] } : l)))
ok('compare: missing -> one problem naming both', missing.length === 1 && missing[0].includes('A_KEY') && missing[0].includes('vercel:preview'))

const extra = compareNames(rows, full.map((l) => (l.store === 'github:staging-sync' ? { ...l, names: ['B_KEY', 'STRAY'] } : l)))
ok('compare: extra -> one problem', extra.length === 1 && extra[0].includes('STRAY') && extra[0].includes('github:staging-sync'))

const injectedListed = compareNames(rows, full.map((l) => (l.store === 'supabase-fn:abc' ? { ...l, names: ['SUPABASE_URL'] } : l)))
ok('compare: injected name listed is not extra', injectedListed.length === 0)

// listStoreNames must never write to any output stream
let writes = 0
const origLog = console.log, origErr = console.error, origWrite = process.stdout.write
console.log = () => { writes++ }
console.error = () => { writes++ }
process.stdout.write = () => { writes++; return true }
const restore = () => { console.log = origLog; console.error = origErr; process.stdout.write = origWrite }

// listStoreNames with an injected runner
const calls = []
const runner = (out) => (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: out, stderr: '' } }
const sb = listStoreNames('supabase-fn:abc', runner(JSON.stringify([{ name: 'K1', value: 'DIGEST1' }, { name: 'K2', updated_at: 'x' }])))
ok('list: supabase names only', JSON.stringify(sb) === '["K1","K2"]')
ok('list: supabase args', calls[0].join(' ') === 'supabase secrets list --project-ref abc -o json')
ok('list: github', JSON.stringify(listStoreNames('github:staging-sync', runner('[{"name":"G"}]'))) === '["G"]')
ok('list: github args', calls[1].join(' ') === 'gh secret list --env staging-sync --json name')
ok('list: fly', JSON.stringify(listStoreNames('fly:app1', runner('[{"Name":"F","Digest":"d"}]'))) === '["F"]')
ok('list: fly args', calls[2].join(' ') === 'fly secrets list -a app1 --json')
ok('list: vercel json', JSON.stringify(listStoreNames('vercel:preview', runner('{"envs":[{"key":"V"}]}'))) === '["V"]')
ok('list: vercel args', calls[3].join(' ') === 'vercel env ls preview --format json')
ok('list: vercel table fallback', JSON.stringify(listStoreNames('vercel:production', runner('name  value  environments\nT1  Encrypted  Production\nT2  Encrypted  Production\n'))) === '["T1","T2"]')
let msg = ''
try { listStoreNames('supabase-fn:abc', () => ({ status: 1, stdout: 'SECRETVALUE', stderr: 'SECRETVALUE' })) } catch (e) { msg = String(e.message) }
ok('list: failure throws without output', msg !== '' && !msg.includes('SECRETVALUE'))
msg = ''
try { listStoreNames('supabase-fn:abc', runner('SECRETVALUE not json')) } catch (e) { msg = String(e.message) }
ok('list: bad json throws without output', msg !== '' && !msg.includes('SECRETVALUE'))
let unk = false
try { listStoreNames('bogus:x', runner('[]')) } catch { unk = true }
ok('list: unknown store throws', unk)

restore()
ok('list: nothing written to any output stream', writes === 0)

// win32 ENOENT hint
const enoent = (extra) => () => ({ status: null, error: Object.assign(new Error('spawn ENOENT ' + extra), { code: 'ENOENT' }) })
let w = ''
try { listStoreNames('vercel:preview', enoent('SECRETVALUE'), 'win32') } catch (e) { w = String(e.message) }
ok('list: win32 ENOENT mentions .cmd shim', w.includes('.cmd') && w.includes('vercel:preview') && !w.includes('SECRETVALUE'))
let n = ''
try { listStoreNames('vercel:preview', enoent('x'), 'darwin') } catch (e) { n = String(e.message) }
ok('list: darwin ENOENT has no shim hint', n !== '' && !n.includes('.cmd'))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
