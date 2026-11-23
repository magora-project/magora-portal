// Unit test for scripts/db/local-stack.mjs makeWorkspace (no Docker needed).
// Run: node scripts/db/local-stack.test.mjs
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { makeWorkspace, stackCleanup } from './local-stack.mjs'

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

// stackCleanup: an interrupt stops the stack once and exits 130; later paths do nothing.
{
  const proc = new EventEmitter()
  const exits = []
  proc.exit = (code) => exits.push(code)
  let stops = 0
  const work = mkdtempSync(join(tmpdir(), 'magora-stack-test-'))
  const cleanup = stackCleanup(work, { stop: () => { stops++ }, proc })
  ok('handlers registered for SIGINT, SIGTERM and exit', proc.listenerCount('SIGINT') === 1 && proc.listenerCount('SIGTERM') === 1 && proc.listenerCount('exit') === 1)
  proc.emit('SIGINT')
  ok('SIGINT stops the stack, removes the workspace and exits 130', stops === 1 && !existsSync(work) && exits.join() === '130')
  ok('handlers removed after cleanup', proc.listenerCount('SIGINT') === 0 && proc.listenerCount('SIGTERM') === 0 && proc.listenerCount('exit') === 0)
  cleanup()
  proc.emit('exit')
  ok('cleanup runs once', stops === 1)
}
{
  const proc = new EventEmitter()
  proc.exit = () => {}
  let stops = 0
  const work = mkdtempSync(join(tmpdir(), 'magora-stack-test-'))
  const cleanup = stackCleanup(work, { stop: () => { stops++ }, proc })
  cleanup()
  proc.emit('SIGTERM')
  ok('a normal stop() unregisters the handlers; a later signal does not stop again', stops === 1 && proc.listenerCount('SIGTERM') === 0)
}
{
  const proc = new EventEmitter()
  proc.exit = () => {}
  let calls = 0
  const work = mkdtempSync(join(tmpdir(), 'magora-stack-test-'))
  const cleanup = stackCleanup(work, { stop: () => { if (++calls === 1) throw new Error('docker busy') }, proc })
  let msg = null
  try { cleanup() } catch (e) { msg = e.message }
  ok('a failed stop is reported, naming the kept workspace', msg?.includes('could not stop') && msg.includes(work) && msg.includes('docker busy'))
  ok('after a failed stop the workspace and handlers stay', existsSync(work) && proc.listenerCount('SIGINT') === 1 && proc.listenerCount('exit') === 1)
  cleanup()
  ok('a retry stops the stack, removes the workspace and the handlers', calls === 2 && !existsSync(work) && proc.listenerCount('exit') === 0)
}

console.log(`local-stack: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
