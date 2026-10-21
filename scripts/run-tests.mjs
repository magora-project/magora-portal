// Test runner for `npm test` (repo harness spec §5.1). Finds every *.test.mjs outside the skipped
// directories and runs each with this Node as a child process. Fails if any test exits non-zero, if
// any child fails to launch, or if it finds no tests at all, so it cannot pass vacuously.
// Run: node scripts/run-tests.mjs [--root <dir>]
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `.claude` holds agent worktrees, which are whole extra checkouts of this repo.
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vercel', '.claude'])

export function findTests(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
      }
    }
  }
  walk(root)
  return found.sort()
}

export function runTests(files, { root, nodePath = process.execPath, stdio = 'inherit' } = {}) {
  if (files.length === 0) return { ok: false, failures: ['no *.test.mjs files found'] }
  const failures = []
  for (const file of files) {
    console.log(`\n▶ ${file}`)
    const r = spawnSync(nodePath, [join(root, file)], { cwd: root, stdio })
    if (r.error) failures.push(`${file}: failed to launch (${r.error.code ?? r.error.message})`)
    else if (r.status !== 0) failures.push(`${file}: exited ${r.status ?? r.signal}`)
  }
  return { ok: failures.length === 0, failures }
}

function main(argv) {
  const i = argv.indexOf('--root')
  const root = resolve(i >= 0 ? argv[i + 1] : '.')
  const files = findTests(root)
  const { ok, failures } = runTests(files, { root })
  if (ok) {
    console.log(`\nrun-tests: ${files.length} test file(s) passed`)
    return 0
  }
  console.error(`\nrun-tests: FAIL\n  ${failures.join('\n  ')}`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
