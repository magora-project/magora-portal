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
import { codeOnly } from './sql-lex.mjs'

// Top-level *.sql only, byte-order sorted. rollbacks/ and checks/ are subdirectories, so they are
// never listed.
export function listMigrationFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((name) => join(dir, name))
}

// Transaction control is read from the statements' code alone (sql-lex.mjs removes comments, literals,
// quoted identifiers and dollar-quoted bodies), so `begin;` inside a string or a function body is not
// one. A statement is control when it starts with BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK (but
// not ROLLBACK TO a savepoint) or ABORT. The END that closes a SQL-standard BEGIN ATOMIC body is not.
const CONTROL = /^(begin|start\s+transaction|commit|end|rollback(?!\s+to\b)|abort)\b/i
const OPENS = /^(begin|start\s+transaction)\b/i
const CLOSES = /^(commit|end)\b/i
export function transactionControl(sql) {
  const statements = codeOnly(sql).split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  let atomic = 0
  const control = []
  statements.forEach((s, index) => {
    if (atomic > 0 && /^end$/i.test(s)) { atomic--; return }
    if (CONTROL.test(s) && !/^begin atomic\b/i.test(s)) control.push({ index, text: s })
    atomic += (s.match(/\bbegin atomic\b/gi) ?? []).length
  })
  return { statements: statements.length, control }
}

// A file with no transaction control is wrapped in our own transaction. A file with some is run as
// written (wrapping it would let its COMMIT end our transaction early), so it must be exactly one
// transaction: its first statement opens it, its last statement commits it, and nothing else controls
// it. Any other layout (statements before BEGIN or after COMMIT, two transactions, a ROLLBACK, BEGIN
// without COMMIT) could commit part of the file and leave the rest unapplied, so it is refused before
// anything runs.
export function transactionLayout(sql) {
  const { statements, control } = transactionControl(sql)
  if (control.length === 0) return { own: false }
  const [first, last] = [control[0], control.at(-1)]
  const ok = control.length === 2 && first.index === 0 && OPENS.test(first.text) && last.index === statements - 1 && CLOSES.test(last.text)
  if (ok) return { own: true }
  return { own: true, problem: `transaction control must be exactly one BEGIN as the first statement and one COMMIT as the last; found ${control.map((c) => `${c.text.split(' ')[0].toUpperCase()} (statement ${c.index + 1} of ${statements})`).join(', ')}` }
}
export const managesOwnTransaction = (sql) => transactionLayout(sql).own

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
    const { own, problem } = transactionLayout(sql)
    try {
      if (problem) throw Object.assign(new Error(problem), { code: 'transaction-layout' })
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
