// Tests for scripts/secrets/inventory-check.mjs. Run: node scripts/secrets/inventory-check.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseInventory, inventoryProblems, compareNames, listStoreNames, storesOf } from './inventory-check.mjs'

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

// A1: an injected name is exempt only in the stores the platform injects it into
const inj = parseInventory(`| SUPABASE_URL | production | op://Magora Project/supabase/SUPABASE_URL | supabase-fn:abc | yes |
| A_KEY | production | op://Magora Project/s/A_KEY | vercel:preview | no |`)
const leak = compareNames(inj, [{ store: 'supabase-fn:abc', names: ['SUPABASE_URL'] }, { store: 'vercel:preview', names: ['A_KEY', 'SUPABASE_URL'] }])
ok('injected: unrecorded copy in another store is flagged', leak.length === 1 && leak[0].includes('SUPABASE_URL') && leak[0].includes('vercel:preview'))
ok('injected: exempt in its own listed store', !compareNames(inj, [{ store: 'supabase-fn:abc', names: ['SUPABASE_URL'] }, { store: 'vercel:preview', names: ['A_KEY'] }]).length)
const injBare = parseInventory(`| SUPABASE_URL | production | op://Magora Project/supabase/SUPABASE_URL | | yes |
| A_KEY | production | op://Magora Project/s/A_KEY | vercel:preview; supabase-fn:abc | no |`)
ok('injected, no stores listed: exempt in supabase-fn only', compareNames(injBare, [{ store: 'supabase-fn:abc', names: ['A_KEY', 'SUPABASE_URL'] }, { store: 'vercel:preview', names: ['A_KEY'] }]).length === 0)
ok('injected, no stores listed: flagged in vercel', compareNames(injBare, [{ store: 'supabase-fn:abc', names: ['A_KEY'] }, { store: 'vercel:preview', names: ['A_KEY', 'SUPABASE_URL'] }]).some((p) => p.includes('SUPABASE_URL') && p.includes('vercel:preview')))

// A5: github:repo is the repo-level store, not an environment named "repo"
const grepo = []
const gnames = listStoreNames('github:repo', (c, a) => { grepo.push([c, ...a].join(' ')); return { status: 0, stdout: '[{"name":"R"}]' } })
ok('list: github:repo args have no --env', grepo[0] === 'gh secret list --json name' && JSON.stringify(gnames) === '["R"]')
ok('stores: github:repo recognised', parseInventory('| R_KEY | production | op://Magora Project/s/R_KEY | github:repo | no |')[0].copies[0] === 'github:repo')

// A2: vercel falls back to the table output when the CLI rejects --format json
const vcalls = []
const vrun = (results) => (c, a) => { vcalls.push(a.join(' ')); return results.shift() }
const vt = listStoreNames('vercel:preview', vrun([{ status: 1, stdout: '' }, { status: 0, stdout: 'name  value  environments\nT1  Encrypted  Preview\n' }]))
ok('vercel: retry without --format json parses table', JSON.stringify(vt) === '["T1"]' && vcalls.length === 2 && vcalls[0].includes('--format json') && !vcalls[1].includes('--format'))
let vboth = ''
try { listStoreNames('vercel:preview', vrun([{ status: 1, stdout: 'SECRETVALUE' }, { status: 1, stdout: 'SECRETVALUE' }])) } catch (e) { vboth = String(e.message) }
ok('vercel: both attempts fail -> throws without output', vboth !== '' && !vboth.includes('SECRETVALUE'))
let ghCalls = 0
try { listStoreNames('github:repo', () => { ghCalls++; return { status: 1, stdout: '' } }) } catch { /* expected */ }
ok('non-vercel failure is not retried', ghCalls === 1)

// A3: a malformed inventory is a problem, not a silent pass
const HDR = '| Name | Environment (production/staging) | 1Password reference | Copies | Injected? |\n|---|---|---|---|---|\n'
ok('doc: well-formed doc has no problems', inventoryProblems(MD).length === 0)
ok('doc: backticked Name is a problem', inventoryProblems(HDR + '| `X_KEY` | production | op://Magora Project/s/X_KEY | vercel:production | no |\n').length >= 1)
ok('doc: zero parsed rows is a problem', inventoryProblems(HDR).some((p) => p.includes('no inventory rows')))
ok('doc: no table at all is a problem', inventoryProblems('# nothing\n').some((p) => p.includes('no inventory rows')))
ok('doc: short row is a problem', inventoryProblems(HDR + '| X_KEY | production |\n').some((p) => p.includes('could not be parsed')))
ok('doc: good row beside bad row still reports the bad one', inventoryProblems(HDR + '| X_KEY | production | op://a/b/X_KEY | vercel:production | no |\n| bad name | production | op://a/b/c | vercel:production | no |\n').length === 1)
const shipped = readFileSync(fileURLToPath(new URL('../../docs/runbooks/secrets-inventory.md', import.meta.url)), 'utf8')
ok('shipped doc: parses with no structural problems', inventoryProblems(shipped).length === 0)
ok('shipped doc: expected row count', parseInventory(shipped).length === 14)

// listStoreNames must never write to any output stream
let writes = 0
const origLog = console.log, origErr = console.error, origWrite = process.stdout.write, origErrWrite = process.stderr.write
console.log = () => { writes++ }
console.error = () => { writes++ }
process.stdout.write = () => { writes++; return true }
process.stderr.write = () => { writes++; return true }
const restore = () => { console.log = origLog; console.error = origErr; process.stdout.write = origWrite; process.stderr.write = origErrWrite }

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
