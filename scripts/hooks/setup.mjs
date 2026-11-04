// Points git at the committed hooks directory: `git config core.hooksPath .githooks`, then prints the
// value read back. Run: npm run setup:hooks (from the repo root; `cwd` is injectable for tests).
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })

export function setup({ cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  // An existing, different hooksPath (husky, a personal hooks dir) stops running once replaced: say so.
  const before = git(['config', '--get', 'core.hooksPath'], cwd)
  const old = before.status === 0 ? before.stdout.trim() : ''
  if (old !== '' && old !== '.githooks') err(`replacing core.hooksPath ${old}; hooks there no longer run`)
  const set = git(['config', 'core.hooksPath', '.githooks'], cwd)
  if (set.error || set.status !== 0) {
    err(`could not set core.hooksPath: ${set.error?.message ?? set.stderr.trim()}`)
    return 1
  }
  const got = git(['config', '--get', 'core.hooksPath'], cwd)
  if (got.error || got.status !== 0) {
    err('could not read core.hooksPath back')
    return 1
  }
  // The repository-level value was written, but a higher-precedence one (a worktree's own
  // config.worktree, GIT_CONFIG_* or `-c`) can still win: then this checkout would not run the hook.
  const value = got.stdout.trim()
  out(`core.hooksPath = ${value}`)
  if (value !== '.githooks') {
    err(`core.hooksPath is still ${value} here: a worktree or environment setting overrides the repository value, so this checkout will not run .githooks`)
    return 1
  }
  return 0
}

function isMain() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) process.exitCode = setup()
