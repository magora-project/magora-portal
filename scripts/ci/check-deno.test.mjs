// Self-test for scripts/ci/check-deno.mjs: entry-point discovery and the zero-entry failure.
// Never runs Deno (every CLI case here fails before Deno would start).
// Run: node scripts/ci/check-deno.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEntrypoints } from './check-deno.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const CLI = fileURLToPath(new URL('./check-deno.mjs', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'check-deno-selftest-'))
const write = (rel) => {
  mkdirSync(join(tmp, rel, '..'), { recursive: true })
  writeFileSync(join(tmp, rel), '')
}
try {
  write('two/supabase/functions/b-fn/index.ts')
  write('two/supabase/functions/a-fn/index.ts')
  write('two/supabase/functions/_shared/util.ts')
  write('two/supabase/functions/README.md')
  ok('finds each function index.ts, sorted, skipping dirs without one',
    JSON.stringify(findEntrypoints(join(tmp, 'two'))) ===
      JSON.stringify(['supabase/functions/a-fn/index.ts', 'supabase/functions/b-fn/index.ts']))

  write('none/supabase/functions/_shared/util.ts')
  ok('no index.ts -> empty list', findEntrypoints(join(tmp, 'none')).length === 0)
  ok('CLI FAIL (fail closed) on zero functions',
    spawnSync(process.execPath, [CLI, '--root', join(tmp, 'none')], { stdio: 'ignore' }).status === 1)
  mkdirSync(join(tmp, 'nodir'))
  ok('CLI FAIL (fail closed) without supabase/functions',
    spawnSync(process.execPath, [CLI, '--root', join(tmp, 'nodir')], { stdio: 'ignore' }).status === 1)
  write('linked/supabase/functions/a-fn/index.ts')
  write('linked-target/b-fn/index.ts')
  symlinkSync(join(tmp, 'linked-target', 'b-fn'), join(tmp, 'linked/supabase/functions/b-fn'), 'junction')
  let threw = false
  try { findEntrypoints(join(tmp, 'linked')) } catch { threw = true }
  ok('a symlinked function dir is refused, not skipped', threw)
  symlinkSync(join(CLI, '..'), join(tmp, 'ci-link'), 'junction')
  ok('CLI run through a symlinked path still judges',
    spawnSync(process.execPath, [join(tmp, 'ci-link', 'check-deno.mjs'), '--root', join(tmp, 'none')], { stdio: 'ignore' }).status === 1)
  ok('CLI run through a symlinked path with --preserve-symlinks-main still judges',
    spawnSync(process.execPath, ['--preserve-symlinks-main', join(tmp, 'ci-link', 'check-deno.mjs'), '--root', join(tmp, 'none')], { stdio: 'ignore' }).status === 1)
  write('dangling/supabase/functions/a-fn/index.ts')
  mkdirSync(join(tmp, 'dangling/supabase/functions/b-fn'))
  symlinkSync(join(tmp, 'no-such-file.ts'), join(tmp, 'dangling/supabase/functions/b-fn/index.ts'))
  let threwDangling = false
  try { findEntrypoints(join(tmp, 'dangling')) } catch { threwDangling = true }
  ok('a dangling symlinked index.ts is refused, not dropped', threwDangling)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
