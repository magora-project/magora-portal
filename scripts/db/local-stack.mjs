// A throwaway local Supabase stack for itests and the baseline proof (Spec 2 plan Tasks 8, 10–12).
// The stack runs from a temp workspace holding a copy of supabase/config.toml and an EMPTY
// migrations directory, so `supabase start` applies nothing from this repo: the repo's migrations
// assume the pre-history schema that only the baseline (Task 12) provides.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Containers the catalog work never needs. Postgres, GoTrue (auth schema), storage-api (storage
// schema), realtime and PostgREST stay up so their schemas match a hosted project's.
const EXCLUDE = ['studio', 'imgproxy', 'logflare', 'vector', 'edge-runtime', 'mailpit', 'supavisor', 'postgres-meta']

function run(args, { capture = false } = {}) {
  const r = spawnSync('supabase', args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
  if (r.error) throw new Error(`supabase ${args[0]}: failed to launch (${r.error.code ?? r.error.message})`)
  if (r.status !== 0) throw new Error(`supabase ${args[0]}: exited ${r.status ?? r.signal}`)
  return r.stdout
}

// The project_id names the stack's containers, so it is made unique per run: two runs (from two
// worktrees, say) never share containers, and one run's `stop --no-backup` cannot stop the other's
// database. Both stacks bind the CLI's default ports, so a second concurrent start fails instead.
export function makeWorkspace({ projectId = 'magora-local' } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'magora-stack-'))
  mkdirSync(join(work, 'supabase', 'migrations'), { recursive: true })
  const config = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8')
  // The repo's project_id is production's ref; it only names containers, but a local stack should
  // not carry it.
  const unique = `${projectId}-${randomBytes(4).toString('hex')}`
  writeFileSync(join(work, 'supabase', 'config.toml'), config.replace(/^project_id = .*$/m, `project_id = "${unique}"`))
  return work
}

export function startStack({ projectId } = {}) {
  const work = makeWorkspace({ projectId })
  try {
    // `supabase start` ends by printing the stack's keys on stdout. They are the CLI's fixed local
    // demo keys, but nothing here prints keys, so stdout is captured and dropped.
    run(['start', '--workdir', work, '-x', EXCLUDE.join(',')], { capture: true })
    const status = JSON.parse(run(['status', '--workdir', work, '-o', 'json'], { capture: true }))
    const dbUrl = status.DB_URL
    const port = Number(new URL(dbUrl).port)
    if (!port) throw new Error('could not read the local DB port from supabase status')
    return {
      work,
      dbUrl,
      port,
      stop() {
        try { run(['stop', '--workdir', work, '--no-backup']) } finally { rmSync(work, { recursive: true, force: true }) }
      },
    }
  } catch (e) {
    try { run(['stop', '--workdir', work, '--no-backup']) } catch { /* not started */ }
    rmSync(work, { recursive: true, force: true })
    throw e
  }
}
