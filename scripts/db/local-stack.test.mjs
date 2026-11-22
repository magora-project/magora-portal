// Unit test for scripts/db/local-stack.mjs makeWorkspace (no Docker needed).
// Run: node scripts/db/local-stack.test.mjs
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkspace } from './local-stack.mjs'

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { if (c) { pass++ } else { fail++; console.log('  FAIL', n, extra) } }

const projectIdOf = (work) => /^project_id = "([^"]*)"$/m.exec(readFileSync(join(work, 'supabase', 'config.toml'), 'utf8'))?.[1]

const a = makeWorkspace({ projectId: 'magora-itest' })
const b = makeWorkspace({ projectId: 'magora-itest' })
try {
  const ida = projectIdOf(a), idb = projectIdOf(b)
  ok('project_id keeps the caller\'s prefix', /^magora-itest-[0-9a-f]{8}$/.test(ida ?? ''), ida)
  ok('two runs with the same prefix get different project_ids (no shared containers)', ida !== undefined && ida !== idb, `${ida} ${idb}`)
  const repoId = /^project_id = "([^"]*)"$/m.exec(readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8'))?.[1]
  ok('the workspace does not carry the repo\'s (production) project_id', ida !== repoId && !(ida ?? '').includes(repoId ?? '\0'))
} finally {
  rmSync(a, { recursive: true, force: true })
  rmSync(b, { recursive: true, force: true })
}

console.log(`local-stack: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
