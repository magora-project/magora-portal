// Git pre-send hook (via .githooks): warns when local review evidence is missing. It NEVER blocks:
// every path, including every internal failure, exits 0. The required CI checks are the control.
// Kill-switch: PREPUSH_REVIEW_WARN_DISABLE=1.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

// Resolves to the localCheck function, or null when scripts/ci/review-evidence.mjs is not there yet.
async function defaultLoadCheck(cwd) {
  try {
    const mod = await import(pathToFileURL(join(cwd, 'scripts', 'ci', 'review-evidence.mjs')).href)
    return typeof mod.localCheck === 'function' ? mod.localCheck : null
  } catch {
    return null
  }
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
  } catch {
    // fail open: a warning hook must never block
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
  // Git writes ref lines to stdin; drain them so it never writes into a closed pipe.
  try { readFileSync(0) } catch { /* fail open */ }
  process.stderr.on('error', () => {})
  process.exitCode = await main()
}
