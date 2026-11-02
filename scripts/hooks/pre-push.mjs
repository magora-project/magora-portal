// Git pre-send hook (via .githooks): warns when local review evidence is missing. It NEVER blocks:
// every path, including every internal failure, exits 0. The required CI checks are the control.
// Kill-switch: PREPUSH_REVIEW_WARN_DISABLE=1.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

// Resolves to the localCheck function, or null when scripts/ci/review-evidence.mjs is not there yet.
// Only an absent file counts as "not available"; a module that exists but fails to load rejects,
// so main() reports it as a failed check rather than as missing evidence tooling.
async function defaultLoadCheck(cwd) {
  const file = join(cwd, 'scripts', 'ci', 'review-evidence.mjs')
  if (!existsSync(file)) return null
  const mod = await import(pathToFileURL(file).href)
  return typeof mod.localCheck === 'function' ? mod.localCheck : null
}

export async function main({ cwd = process.cwd(), stderr = process.stderr, env = process.env, loadCheck = defaultLoadCheck } = {}) {
  try {
    if (env.PREPUSH_REVIEW_WARN_DISABLE === '1') return 0
    const localCheck = await loadCheck(cwd)
    if (typeof localCheck !== 'function') {
      stderr.write('review-evidence not available yet\n')
      return 0
    }
    const result = await localCheck({ cwd })
    if (result && result.ok === false) {
      const lines = Array.isArray(result.lines) ? result.lines : []
      stderr.write(`WARNING: local review evidence is missing or incomplete (this does not block):\n${lines.map((l) => `  ${l}`).join('\n')}\n`)
    }
  } catch (e) {
    // still exit 0, but say so: a broken check must not read as "evidence present"
    try {
      const msg = String(e && e.message ? e.message : e).split('\n')[0]
      stderr.write(`WARNING: review-evidence check failed: ${msg}\n`)
    } catch { /* fail open */ }
  }
  return 0
}

// Compare real paths on both sides (see .claude/hooks/lane-threshold.mjs): a symlinked path would
// otherwise skip main(). Fails open, so a realpath error counts as "is main".
function isMain() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return true
  }
}

if (isMain()) {
  // Defensive: git tolerates a hook that ignores its stdin, but drain it anyway.
  try { readFileSync(0) } catch { /* fail open */ }
  process.stderr.on('error', () => {})
  // No top-level await: a check that never settles must not exit 13 or hang. The watchdog is not
  // unref'd on purpose, so it also fires when the loop would otherwise be empty or kept alive.
  const ms = Number(process.env.PREPUSH_REVIEW_TIMEOUT_MS) > 0 ? Number(process.env.PREPUSH_REVIEW_TIMEOUT_MS) : 10000
  setTimeout(() => {
    try { process.stderr.write('review-evidence check timed out\n') } catch { /* fail open */ }
    process.exit(0)
  }, ms)
  main().then(() => process.exit(0), () => process.exit(0))
}
