// Migration rollback check (repo harness spec §5.5). Every top-level forward migration
// supabase/migrations/<stem>.sql needs supabase/migrations/rollbacks/<stem>.rollback.sql, unless its
// file name is listed in scripts/ci/migrations-grandfathered.txt (the migrations that predate the rule).
// Fails closed if the migrations directory or the grandfather list is missing, and on a stale list
// entry, so the list cannot quietly drift from the directory.
// Run: node scripts/ci/check-migrations.mjs [--root <dir>]
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// A symlinked migration would be skipped by isFile() and so escape the rollback rule: refuse it.
function sqlFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const link = entries.find((d) => d.isSymbolicLink())
  if (link) throw new Error(`symlinks are not supported: ${join(dir, link.name)}`)
  return entries.filter((d) => d.isFile() && d.name.endsWith('.sql')).map((d) => d.name)
}

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
  if (tree.forward.length === 0) {
    console.error(`check-migrations: FAIL (could not judge): no ${MIGRATIONS_DIR}/*.sql found`)
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

// Compare real paths on both sides: Node resolves symlinks in import.meta.url (unless
// --preserve-symlinks-main) and never in argv[1], and either mismatch would skip main() and exit 0
// unjudged. A realpath error is left to throw, which exits non-zero.
const isMain = process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) process.exit(main(process.argv.slice(2)))
