// Runner for `npm run test:db` (Spec 2 plan Task 8). Starts one throwaway local Supabase stack,
// runs every scripts/**/*.itest.mjs against it, then stops it. Each itest receives the stack's
// database URL in MAGORA_LOCAL_DB_URL and its port in MAGORA_LOCAL_DB_PORT, and must undo what it
// changes. Fails if any itest fails or none are found. `npm test` never finds *.itest.mjs.
// Run: node scripts/db/run-itests.mjs [--only <substring>]
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startStack } from './local-stack.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function findItests(dir, root = dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`symlinks are not supported: ${relative(root, join(dir, entry.name))}`)
    if (entry.isDirectory()) found.push(...findItests(join(dir, entry.name), root))
    else if (entry.isFile() && entry.name.endsWith('.itest.mjs')) found.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
  }
  return found.sort()
}

function main(argv) {
  const i = argv.indexOf('--only')
  const only = i >= 0 ? argv[i + 1] : null
  const files = findItests(join(REPO, 'scripts'), REPO).filter((f) => !only || f.includes(only))
  if (files.length === 0) {
    console.error('run-itests: FAIL: no *.itest.mjs files found')
    return 1
  }
  const stack = startStack({ projectId: 'magora-itest' })
  const failures = []
  try {
    for (const file of files) {
      console.log(`\n▶ ${file}`)
      const r = spawnSync(process.execPath, [join(REPO, file)], {
        cwd: REPO,
        stdio: 'inherit',
        env: { ...process.env, MAGORA_LOCAL_DB_URL: stack.dbUrl, MAGORA_LOCAL_DB_PORT: String(stack.port) },
      })
      if (r.error) failures.push(`${file}: failed to launch (${r.error.code ?? r.error.message})`)
      else if (r.status !== 0) failures.push(`${file}: exited ${r.status ?? r.signal}`)
    }
  } finally {
    stack.stop()
  }
  if (failures.length) {
    console.error(`\nrun-itests: FAIL\n  ${failures.join('\n  ')}`)
    return 1
  }
  console.log(`\nrun-itests: ${files.length} itest file(s) passed`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) {
    console.error(`run-itests: FAIL: ${e.message}`)
    process.exitCode = 1
  }
}
