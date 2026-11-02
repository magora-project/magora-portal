// Points git at the committed hooks directory: `git config core.hooksPath .githooks`, then prints the
// value read back. Run: npm run setup:hooks (from the repo root; `cwd` is injectable for tests).
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })

export function setup({ cwd = process.cwd(), out = console.log, err = console.error } = {}) {
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
  out(`core.hooksPath = ${got.stdout.trim()}`)
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
