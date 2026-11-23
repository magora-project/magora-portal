// Postgres connections for the database scripts (Spec 2 plan Task 8). The URL is read from an
// environment variable named by the caller, never from argv, and is never logged: errors name the
// project ref (or "local") and the Postgres error code only.
import { isAbsolute } from 'node:path'
import pg from 'pg'
import { assertStaging, refFromDbUrl } from '../lib/targets.mjs'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

// Local fixtures accept only localhost/127.0.0.1, and only on the ports the caller's own stack
// printed. Returns a reason or null. Never echoes the URL.
export function localProblem(url, allowedPorts) {
  let u
  try { u = new URL(String(url)) } catch { return 'local target is not a URL' }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return 'local target must use a postgres scheme'
  if (!LOCAL_HOSTS.has(u.hostname)) return 'local target must be localhost or 127.0.0.1'
  // libpq lets query parameters (host=, hostaddr=, port=) override the authority.
  if ([...u.searchParams.keys()].length > 0) return 'local target carries a query override'
  const port = Number(u.port || 5432)
  if (!Array.isArray(allowedPorts) || !allowedPorts.includes(port)) return 'local target port is not an allowed port'
  return null
}

// The label an error may carry: the project ref, "local", or "unknown". Never the URL.
export function targetLabel(url) {
  try {
    const ref = refFromDbUrl(url)
    if (ref) return ref
  } catch { return 'unknown' }
  try { return LOCAL_HOSTS.has(new URL(String(url)).hostname) ? 'local' : 'unknown' } catch { return 'unknown' }
}

// libpq reads PGSSLROOTCERT; node-postgres does not, so a `sslmode=verify-full` URL would be checked
// against Node's public CA list, which lacks Supabase's CA (docs/runbooks/restore.md). When the URL
// sets sslmode and PGSSLROOTCERT is an absolute path, pass it as `sslrootcert`. Applied after the
// target checks, which see the URL as given.
export function withRootCert(url, env) {
  const cert = env.PGSSLROOTCERT
  if (!cert) return url
  if (!isAbsolute(cert)) throw new Error('PGSSLROOTCERT must be an absolute path')
  let u
  try { u = new URL(url) } catch { return url }
  if (!u.searchParams.has('sslmode') || u.searchParams.has('sslrootcert')) return url
  u.searchParams.set('sslrootcert', cert)
  return u.toString()
}

// Supabase's transaction-mode pooler (port 6543) hands each transaction to any server connection, so a
// session setting made here (default_transaction_read_only, row_security) would not hold for the next
// query, and would stay behind on a connection another client then uses. Only a direct connection or
// the session-mode pooler (port 5432) is accepted.
export const TRANSACTION_POOLER_PORT = '6543'
function transactionPooler(url) {
  try { return new URL(String(url)).port === TRANSACTION_POOLER_PORT } catch { return false }
}

export async function connect(envName, { readOnly = false, writeTarget, localPorts, env = process.env, Client = pg.Client } = {}) {
  const url = env[envName]
  if (typeof url !== 'string' || url === '') throw new Error(`${envName} is required`)
  if (transactionPooler(url)) throw new Error(`refusing: ${envName} is a transaction-mode pooler (port ${TRANSACTION_POOLER_PORT}); session settings would not hold. Use a direct connection or the session pooler (port 5432)`)
  if (writeTarget === 'staging') assertStaging(url, 'db')
  else if (writeTarget === 'local') {
    const problem = localProblem(url, localPorts)
    if (problem) throw new Error(`refusing: ${problem}`)
  } else if (writeTarget !== undefined) throw new Error('connect: unknown writeTarget')
  else if (!readOnly) throw new Error('connect: a connection with no writeTarget must be readOnly')
  const label = targetLabel(url)
  const client = new Client({ connectionString: withRootCert(url, env) })
  try {
    await client.connect()
    if (readOnly) await client.query('SET default_transaction_read_only = on')
  } catch (e) {
    try { await client.end() } catch { /* already closed */ }
    // No `cause`: a driver error can carry the host or connection details, and a caller that prints
    // the error would print its cause too.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`connect failed: ${label}: ${e?.code ?? 'no code'}`)
  }
  return client
}
