// Deno check for the Edge Functions (repo harness spec §5.1 rev 7). A Node wrapper, not a shell
// glob in package.json: under cmd.exe a quoted glob reaches Deno literally, and `deno check` then
// exits 0 with "No matching files found". This finds each supabase/functions/<name>/index.ts
// itself, fails if there are none, and passes Deno an argument array.
// `--no-lock` keeps `deno check` from writing a deno.lock into the checkout. `no-import-prefix` is
// excluded because the functions import `https://esm.sh/…` inline (out of scope, spec §9).
// Run: node scripts/ci/check-deno.mjs [--root <dir>]   (needs Deno 2.9.5 on PATH)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FUNCTIONS_DIR = 'supabase/functions'

export function findEntrypoints(root) {
  return readdirSync(join(root, FUNCTIONS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, FUNCTIONS_DIR, d.name, 'index.ts')))
    .map((d) => `${FUNCTIONS_DIR}/${d.name}/index.ts`)
    .sort()
}

function deno(args, cwd) {
  const r = spawnSync('deno', args, { cwd, stdio: 'inherit' })
  if (r.error) {
    console.error(`check-deno: FAIL (could not judge): deno failed to start (${r.error.code ?? r.error.message})`)
    return false
  }
  return r.status === 0
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  let entries
  try { entries = findEntrypoints(root) } catch (e) {
    console.error(`check-deno: FAIL (could not judge): ${e.message}`)
    return 1
  }
  if (entries.length === 0) {
    console.error(`check-deno: FAIL (could not judge): no ${FUNCTIONS_DIR}/*/index.ts found`)
    return 1
  }
  if (!deno(['check', '--no-lock', ...entries], root)) return 1
  if (!deno(['lint', '--rules-exclude=no-import-prefix', FUNCTIONS_DIR], root)) return 1
  console.log(`check-deno: ok (${entries.length} function(s))`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
