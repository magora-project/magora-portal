// Compares docs/runbooks/secrets-inventory.md against the NAME listings of every store it names.
// Names only: raw CLI output is never printed, and value/digest fields are dropped at parse time.
// Run: node scripts/secrets/inventory-check.mjs
import { readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const STORE_RE = /^(vercel:(production|preview|staging)|github:[A-Za-z0-9_.-]+|fly:[A-Za-z0-9_.-]+|supabase-fn:[a-z0-9]+)$/

export function parseInventory(markdown) {
  const rows = []
  for (const line of markdown.replace(/\r/g, '').split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.length < 5) continue
    const [name, environment, reference, copies, injected] = cells
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue // header, separator, prose
    const tokens = copies.split(';').map((t) => t.trim()).filter(Boolean)
    rows.push({
      name,
      environment,
      reference,
      copies: tokens.filter((t) => STORE_RE.test(t)),
      badCopies: tokens.filter((t) => !STORE_RE.test(t)),
      injected: /^yes/i.test(injected),
    })
  }
  return rows
}

export function storesOf(rows) {
  return [...new Set(rows.flatMap((r) => r.copies))].sort()
}

export function compareNames(rows, listings) {
  const problems = []
  for (const r of rows) {
    for (const t of r.badCopies ?? []) problems.push(`${r.name}: unrecognised Copies entry "${t}"`)
    if (!r.injected && r.copies.length === 0) problems.push(`${r.name}: no copies recorded`)
  }
  const injectedNames = new Set(rows.filter((r) => r.injected).map((r) => r.name))
  for (const { store, names } of listings) {
    const have = new Set(names)
    const want = new Set(rows.filter((r) => !r.injected && r.copies.includes(store)).map((r) => r.name))
    for (const n of [...want].sort()) if (!have.has(n)) problems.push(`${n} is in the inventory but missing from ${store}`)
    for (const n of [...have].sort()) if (!want.has(n) && !injectedNames.has(n)) problems.push(`${n} is in ${store} but has no inventory row`)
  }
  return problems
}

const nameOf = (o) => (o && typeof o === 'object' ? o.name ?? o.Name ?? o.key : undefined)
const namesFromJson = (text) => {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : data && Array.isArray(data.envs) ? data.envs : []
  return list.map(nameOf).filter((n) => typeof n === 'string')
}
const namesFromTable = (text) =>
  text.replace(/\r/g, '').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n))

const defaultRunner = (cmd, args) => spawnSync(cmd, args, { shell: false, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

export function listStoreNames(store, run = defaultRunner, platform = process.platform) {
  if (!STORE_RE.test(store)) throw new Error(`unknown store: ${store}`)
  const [kind, id] = [store.slice(0, store.indexOf(':')), store.slice(store.indexOf(':') + 1)]
  const cmd = {
    vercel: ['vercel', ['env', 'ls', id, '--format', 'json']],
    github: ['gh', ['secret', 'list', '--env', id, '--json', 'name']],
    fly: ['fly', ['secrets', 'list', '-a', id, '--json']],
    'supabase-fn': ['supabase', ['secrets', 'list', '--project-ref', id, '-o', 'json']],
  }[kind]
  const r = run(cmd[0], cmd[1])
  // Messages carry the store and exit status only: CLI output may hold values.
  if (r && r.error && r.error.code === 'ENOENT' && platform === 'win32')
    throw new Error(`${cmd[0]} could not be started for ${store}; on Windows a .cmd shim is the likely cause`)
  if (!r || r.error || r.status !== 0) throw new Error(`${cmd[0]} listing failed for ${store} (status ${r && r.status})`)
  const out = String(r.stdout ?? '')
  try {
    return namesFromJson(out)
  } catch {
    if (kind === 'vercel') return namesFromTable(out)
    throw new Error(`${cmd[0]} listing for ${store} was not JSON`)
  }
}

function main() {
  const doc = fileURLToPath(new URL('../../docs/runbooks/secrets-inventory.md', import.meta.url))
  const rows = parseInventory(readFileSync(doc, 'utf8'))
  const listings = []
  const problems = []
  for (const store of storesOf(rows)) {
    try {
      listings.push({ store, names: listStoreNames(store) })
    } catch (e) {
      problems.push(`${store}: ${e.message}`)
    }
  }
  problems.push(...compareNames(rows, listings))
  for (const p of problems) console.log(p)
  console.log(`${problems.length} problems`)
  process.exit(problems.length ? 1 : 0)
}

const isMain = () => {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch { return false }
}
if (isMain()) main()
