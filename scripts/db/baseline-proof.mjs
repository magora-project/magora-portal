// The baseline proof (Spec 2 plan Task 12, spec §5.2, success criterion 9). On a fresh local Supabase
// stack, apply roles.sql, the pre-history baseline, then every migration production has, in order;
// snapshot the result and compare it with a production snapshot under the schema allowlist.
//
//   node scripts/db/baseline-proof.mjs --prod-snapshot FILE [--through STEM] [--allowlist FILE]
//
// --through names the last migration production had when FILE was taken (default: LAST_ON_PRODUCTION).
// Files after it, such as Task 27's grants migration until production has it, are left out, so the
// replay matches the snapshot. Prints the comparison and exits 0 (no difference outside the
// allowlist), 1 (differences) or 2 (could not run).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listMigrationFiles, applyFiles } from './apply-migrations.mjs'
import { connect } from './pg.mjs'
import { startStack } from './local-stack.mjs'
import { snapshotInTransaction, compareFiles } from './schema-snapshot.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const MIGRATIONS = join(REPO, 'supabase', 'migrations')
export const ROLES = join(REPO, 'supabase', 'setup', 'roles.sql')
export const DEFAULT_ALLOWLIST = join(MIGRATIONS, 'checks', 'schema-allowlist.txt')
export const BASELINE = '20260625_baseline_prehistory.sql'
// The last migration applied to production when the committed proof was run (2026-11-21).
export const LAST_ON_PRODUCTION = '20261106_claim_node_insights_skip_quarantined'

// The files to replay, in order: the baseline first, then every later file up to and including
// `through`. Refuses a list without the baseline, a baseline that does not sort first, or a `through`
// that names no file, so a typo cannot silently shorten the replay.
export function selectFiles(paths, through) {
  const names = paths.map((p) => basename(p))
  if (names[0] !== BASELINE) throw new Error(`${BASELINE} must be the first migration (found ${names[0] ?? 'none'})`)
  const stem = through.replace(/\.sql$/, '')
  const last = names.indexOf(`${stem}.sql`)
  if (last < 0) throw new Error(`--through ${stem}: no such migration`)
  return paths.slice(0, last + 1)
}

export function parseArgs(argv) {
  const opts = { through: LAST_ON_PRODUCTION, allowlist: DEFAULT_ALLOWLIST, prodSnapshot: null }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1]
    if (argv[i] === '--prod-snapshot' && v) { opts.prodSnapshot = v; i++ }
    else if (argv[i] === '--through' && v) { opts.through = v; i++ }
    else if (argv[i] === '--allowlist' && v) { opts.allowlist = v; i++ }
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`)
  }
  if (!opts.prodSnapshot) throw new Error('--prod-snapshot is required')
  return opts
}

async function main(argv) {
  const opts = parseArgs(argv)
  const files = selectFiles(listMigrationFiles(MIGRATIONS), opts.through)
  JSON.parse(readFileSync(opts.prodSnapshot, 'utf8')) // fail before starting a stack
  const scratch = mkdtempSync(join(tmpdir(), 'magora-proof-'))
  const stack = startStack({ projectId: 'magora-proof' })
  try {
    const env = { MAGORA_PROOF_DB_URL: stack.dbUrl }
    const target = { writeTarget: 'local', localPorts: [stack.port], env }
    const client = await connect('MAGORA_PROOF_DB_URL', target)
    try {
      await applyFiles(client, [ROLES, ...files])
    } finally { await client.end() }
    console.log(`baseline-proof: applied roles.sql and ${files.length} migrations (${basename(files[0])} .. ${basename(files.at(-1))})`)
    // A fresh session: a file's session settings must not shape how the catalog is printed.
    const reader = await connect('MAGORA_PROOF_DB_URL', target)
    const local = join(scratch, 'replayed.json')
    try {
      writeFileSync(local, `${JSON.stringify(await snapshotInTransaction(reader), null, 1)}\n`)
    } finally { await reader.end() }
    // A = production, B = the replay.
    const { code, text } = compareFiles(opts.prodSnapshot, local, opts.allowlist)
    console.log(text)
    return code
  } finally {
    stack.stop()
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    console.error(`baseline-proof: ${e.message}`)
    process.exitCode = 2
  })
}
