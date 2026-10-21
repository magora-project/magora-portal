// Migration rollback check (repo harness spec §5.5). Every top-level forward migration
// supabase/migrations/<stem>.sql needs supabase/migrations/rollbacks/<stem>.rollback.sql, unless its
// file name is listed in scripts/ci/migrations-grandfathered.txt (the migrations that predate the rule).
// Fails closed if the migrations directory or the grandfather list is missing, and on a stale list
// entry, so the list cannot quietly drift from the directory.
// Run: node scripts/ci/check-migrations.mjs [--root <dir>]
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MIGRATIONS_DIR = 'supabase/migrations'
export const ROLLBACKS_DIR = 'supabase/migrations/rollbacks'
export const GRANDFATHER_PATH = 'scripts/ci/migrations-grandfathered.txt'

export function parseGrandfathered(text) {
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
}

export const rollbackFor = (migration) => migration.replace(/\.sql$/, '.rollback.sql')

// forward: file names of top-level *.sql; rollbacks: file names in rollbacks/; grandfathered: Set.
export function checkMigrations({ forward, rollbacks, grandfathered }) {
  const problems = []
  const forwardSet = new Set(forward)
  for (const name of [...grandfathered].sort()) {
    if (!forwardSet.has(name)) problems.push(`${GRANDFATHER_PATH} lists ${name}, which is not in ${MIGRATIONS_DIR}/`)
  }
  for (const name of [...forward].sort()) {
    if (grandfathered.has(name)) continue
    if (!rollbacks.has(rollbackFor(name))) problems.push(`${MIGRATIONS_DIR}/${name} has no ${ROLLBACKS_DIR}/${rollbackFor(name)}`)
  }
  return problems
}

const sqlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.sql')).map((d) => d.name)

export function readTree(root) {
  const forward = sqlFiles(join(root, MIGRATIONS_DIR))
  let rollbacks = []
  try { rollbacks = sqlFiles(join(root, ROLLBACKS_DIR)) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const grandfathered = parseGrandfathered(readFileSync(join(root, GRANDFATHER_PATH), 'utf8'))
  return { forward, rollbacks: new Set(rollbacks), grandfathered }
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  let tree
  try { tree = readTree(root) } catch (e) {
    console.error(`check-migrations: FAIL (could not judge): ${e.message}`)
    return 1
  }
  const problems = checkMigrations(tree)
  if (problems.length) {
    console.error(`check-migrations: FAIL\n  ${problems.join('\n  ')}`)
    return 1
  }
  console.log(`check-migrations: ok (${tree.forward.length} migrations, ${tree.grandfathered.size} grandfathered)`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
