// Apply SQL files in order (Spec 2 plan Task 8). Each file runs in its own transaction and the run
// stops at the first error, naming the file and the Postgres error position.
//
// CLI (a staging writer): node scripts/db/apply-migrations.mjs --db-url-env NAME --file PATH [--file PATH ...]
// The URL must be staging's (assertStaging runs before the first side effect). Local fixtures call
// applyFiles directly with a client from connect(..., {writeTarget: 'local'}).
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { connect } from './pg.mjs'

// Top-level *.sql only, byte-order sorted. rollbacks/ and checks/ are subdirectories, so they are
// never listed.
export function listMigrationFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((name) => join(dir, name))
}

// A file that manages its own transaction (a line that is only BEGIN; / COMMIT; / ROLLBACK;) is run
// as written: wrapping it would let its COMMIT end our transaction early. Every other file is wrapped.
const OWN_TRANSACTION = /^\s*(begin|start\s+transaction|commit|end|rollback)\s*;/im
export const managesOwnTransaction = (sql) => OWN_TRANSACTION.test(sql)

// 1-based line and column of a 1-based character position, for error reports.
export function lineColumn(sql, position) {
  const before = sql.slice(0, Math.max(0, Number(position) - 1))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

// After a file that manages its own transaction: is a transaction block still open? SAVEPOINT
// succeeds only inside one, and fails with 25P01 outside. A file with BEGIN and no COMMIT would
// otherwise report success, and its work would be rolled back when the connection closes.
export const OPEN_PROBE = 'savepoint apply_open_probe'
async function transactionLeftOpen(client) {
  try {
    await client.query(OPEN_PROBE)
  } catch (e) {
    if (e?.code === '25P01') return false
    throw e
  }
  return true
}

export async function applyFiles(client, paths, { onEach, read = (p) => readFileSync(p, 'utf8') } = {}) {
  for (const path of paths) {
    const sql = read(path)
    const own = managesOwnTransaction(sql)
    try {
      if (own) {
        await client.query(sql)
        if (await transactionLeftOpen(client)) {
          throw Object.assign(new Error('the file leaves a transaction open (BEGIN without COMMIT)'), { code: 'open-transaction' })
        }
      } else {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
      }
    } catch (e) {
      try { await client.query('ROLLBACK') } catch { /* connection may be gone */ }
      const where = e?.position ? (({ line, column }) => ` at line ${line}, column ${column}`)(lineColumn(sql, e.position)) : ''
      throw new Error(`${basename(path)}: ${e?.code ?? 'error'}${where}: ${e?.message ?? e}`, { cause: e })
    }
    onEach?.(path)
  }
}

export function parseArgs(argv) {
  const files = []
  let envName = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-url-env') envName = argv[++i]
    else if (argv[i] === '--file') files.push(argv[++i])
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!envName) throw new Error('--db-url-env is required')
  if (files.length === 0 || files.some((f) => !f)) throw new Error('at least one --file PATH is required')
  return { envName, files }
}

async function main(argv) {
  let args
  try { args = parseArgs(argv) } catch (e) {
    console.error(`apply-migrations: ${e.message}`)
    return 2
  }
  const client = await connect(args.envName, { writeTarget: 'staging' })
  try {
    await applyFiles(client, args.files, { onEach: (p) => console.log(`applied ${basename(p)}`) })
  } finally {
    await client.end()
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => {
    console.error(`apply-migrations: ${e.message}`)
    process.exitCode = 1
  })
}
