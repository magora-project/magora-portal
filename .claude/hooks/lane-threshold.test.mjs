// Self-test for .claude/hooks/lane-threshold.mjs. Run: node .claude/hooks/lane-threshold.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { laneReminder, main } from './lane-threshold.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

const hook = fileURLToPath(new URL('./lane-threshold.mjs', import.meta.url))
const runWith = (input, env = {}) => {
  const r = spawnSync(process.execPath, [hook], {
    input, encoding: 'utf8', shell: false, env: { ...process.env, LANE_THRESHOLD_DISABLE: '', ...env },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const throws = (fn) => { try { fn(); return false } catch { return true } }
const closedStream = () => ({ write() { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }) } })
const sink = () => { const s = { data: '', write(x) { s.data += x; return true } }; return s }

const run = runWith('{}')
ok('emits the reminder as additionalContext', JSON.parse(run.out).hookSpecificOutput.additionalContext.includes('Specced'))
ok('names the hook event', JSON.parse(run.out).hookSpecificOutput.hookEventName === 'UserPromptSubmit')
ok('exit 0 and silent stderr', run.code === 0 && run.err === '')
ok('names the lanes the PR body uses', /specced.*direct.*docs-only.*dependency/s.test(laneReminder()))
ok('says a request that changes nothing owes no declaration', /changes nothing/.test(laneReminder()))
ok('points at the repo rules, not claude-config', /\.claude\/rules\/process\.md/.test(laneReminder()) && !/claude-config/.test(laneReminder()))
ok('garbage stdin still emits, exit 0', (() => { const r = runWith('garbage'); return r.code === 0 && r.out.includes('Specced') })())
ok('kill-switch LANE_THRESHOLD_DISABLE=1 emits nothing, exit 0', (() => { const r = runWith('{}', { LANE_THRESHOLD_DISABLE: '1' }); return r.out === '' && r.code === 0 })())
ok('a closed stdout does not throw', !throws(() => main({ stdin: '{}', stdout: closedStream() })))
ok('main writes one JSON line to stdout', (() => { const s = sink(); main({ stdin: '{}', stdout: s, env: {} }); return s.data.endsWith('\n') && !!JSON.parse(s.data) })())
ok('main kill-switch writes nothing', (() => { const s = sink(); main({ stdin: '{}', stdout: s, env: { LANE_THRESHOLD_DISABLE: '1' } }); return s.data === '' })())
ok('large stdin does not break the hook', runWith('x'.repeat(2_000_000)).code === 0)

// Run through a symlinked path: the hook must still emit (it once compared unresolved paths).
const tmp = mkdtempSync(join(tmpdir(), 'lane-threshold-'))
try {
  let linked = false
  try { symlinkSync(fileURLToPath(new URL('.', import.meta.url)), join(tmp, 'hooks-link'), 'junction'); linked = true } catch { /* symlinks not permitted here: skip */ }
  if (linked) {
    const link = join(tmp, 'hooks-link', 'lane-threshold.mjs')
    const opts = { input: '{}', encoding: 'utf8', shell: false }
    ok('CLI run through a symlinked path still emits', spawnSync(process.execPath, [link], opts).stdout.includes('Specced'))
    ok('symlinked path with --preserve-symlinks-main still emits', spawnSync(process.execPath, ['--preserve-symlinks-main', link], opts).stdout.includes('Specced'))
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
