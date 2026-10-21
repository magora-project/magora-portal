// Deno check for the Edge Functions (repo harness spec §5.1 rev 7). A Node wrapper, not a shell
// glob in package.json: under cmd.exe a quoted glob reaches Deno literally, and `deno check` then
// exits 0 with "No matching files found". This finds each supabase/functions/<name>/index.ts
// itself, fails if there are none, and passes Deno an argument array.
// `--no-lock` keeps `deno check` from writing a deno.lock into the checkout. `no-import-prefix` is
// excluded because the functions import `https://esm.sh/…` inline (out of scope, spec §9).
// Run: node scripts/ci/check-deno.mjs [--root <dir>]   (needs Deno 2.9.5 on PATH)
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FUNCTIONS_DIR = 'supabase/functions'

const lstatExists = (p) => { try { lstatSync(p); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }

export function findEntrypoints(root) {
  const entries = readdirSync(join(root, FUNCTIONS_DIR), { withFileTypes: true })
  // A symlinked function directory would be skipped by isDirectory(): refuse it rather than omit it.
  const link = entries.find((d) => d.isSymbolicLink())
  if (link) throw new Error(`symlinks are not supported: ${FUNCTIONS_DIR}/${link.name}`)
  // Likewise a symlinked index.ts: existsSync() is false for a dangling one, which would drop the function.
  for (const d of entries.filter((e) => e.isDirectory())) {
    const index = join(root, FUNCTIONS_DIR, d.name, 'index.ts')
    if (lstatExists(index) && lstatSync(index).isSymbolicLink()) {
      throw new Error(`symlinks are not supported: ${FUNCTIONS_DIR}/${d.name}/index.ts`)
    }
  }
  return entries
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

// Compare real paths on both sides: Node resolves symlinks in import.meta.url (unless
// --preserve-symlinks-main) and never in argv[1], and either mismatch would skip main() and exit 0
// unjudged. A realpath error is left to throw, which exits non-zero.
const isMain = process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isMain) process.exit(main(process.argv.slice(2)))
