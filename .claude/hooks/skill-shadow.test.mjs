// Self-test for .claude/hooks/skill-shadow.mjs. Run: node .claude/hooks/skill-shadow.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHADOWED, decide } from './skill-shadow.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

const hook = fileURLToPath(new URL('./skill-shadow.mjs', import.meta.url))
const runWith = (input, path = hook, args = []) => {
  const r = spawnSync(process.execPath, [...args, path], { input, encoding: 'utf8', shell: false })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const skill = (s) => ({ tool_name: 'Skill', tool_input: { skill: s } })

ok('denies superpowers:writing-plans, naming the project skill', /writing-plans/.test(decide(skill('superpowers:writing-plans')).permissionDecisionReason))
ok('denies superpowers:brainstorming, naming the project skill', /brainstorming/.test(decide(skill('superpowers:brainstorming')).permissionDecisionReason))
ok('deny has the deny decision', decide(skill('superpowers:writing-plans')).permissionDecision === 'deny')
ok('allows the project skill', decide(skill('writing-plans')) === null)
ok('allows other plugin skills', decide(skill('superpowers:subagent-driven-development')) === null)
ok('ignores other tools', decide({ tool_name: 'Bash', tool_input: { command: 'superpowers:writing-plans' } }) === null)
ok('decide tolerates non-objects', decide(null) === null && decide([]) === null && decide('x') === null && decide({ tool_name: 'Skill' }) === null)
ok('SHADOWED maps exactly the two skills', JSON.stringify(SHADOWED) === JSON.stringify({ 'superpowers:brainstorming': 'brainstorming', 'superpowers:writing-plans': 'writing-plans' }))

const denied = runWith(JSON.stringify(skill('superpowers:writing-plans')))
const out = denied.out ? JSON.parse(denied.out).hookSpecificOutput : {}
ok('CLI deny prints hookSpecificOutput, exit 0', denied.code === 0 && out.hookEventName === 'PreToolUse' && out.permissionDecision === 'deny' && /writing-plans/.test(out.permissionDecisionReason))
ok('CLI allow prints nothing, exit 0', (() => { const r = runWith(JSON.stringify(skill('writing-plans'))); return r.code === 0 && r.out === '' })())
ok('malformed payload: allow, exit 0', runWith('[]').code === 0 && runWith('[]').out === '')
ok('garbage stdin: allow, exit 0', (() => { const r = runWith('garbage'); return r.code === 0 && r.out === '' && r.err === '' })())
ok('empty stdin: allow, exit 0', (() => { const r = runWith(''); return r.code === 0 && r.out === '' })())

// Run through a symlinked path: the hook must still deny (it once compared unresolved paths).
const tmp = mkdtempSync(join(tmpdir(), 'skill-shadow-'))
try {
  let linked = false
  try { symlinkSync(fileURLToPath(new URL('.', import.meta.url)), join(tmp, 'hooks-link'), 'junction'); linked = true } catch { /* symlinks not permitted here: skip */ }
  if (linked) {
    const link = join(tmp, 'hooks-link', 'skill-shadow.mjs')
    const input = JSON.stringify(skill('superpowers:writing-plans'))
    ok('CLI run through a symlinked path still denies', runWith(input, link).out.includes('"deny"'))
    ok('symlinked path with --preserve-symlinks-main still denies', runWith(input, link, ['--preserve-symlinks-main']).out.includes('"deny"'))
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
