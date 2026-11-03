// Self-test for scripts/hooks/pre-push.mjs and scripts/hooks/setup.mjs. Real spawns use a scratch dir.
// Run: node scripts/hooks/pre-push.test.mjs
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from './pre-push.mjs'
import { setup } from './setup.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c !== null && typeof c === 'object' && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

const here = dirname(fileURLToPath(import.meta.url))
const hookPath = join(here, 'pre-push.mjs')

// In-process: localCheck is injected through loadCheck; null models "module missing".
const runHook = async ({ localCheck, env = {} }) => {
  let err = ''
  const code = await main({ cwd: '.', env, stderr: { write: (s) => { err += s } }, loadCheck: async () => localCheck })
  return { code, err }
}

ok('always exits 0, even when the check fails', (await runHook({ localCheck: () => ({ ok: false, lines: ['x'] }) })).code === 0)
ok('prints the failing lines as a warning', /WARNING.*x/s.test((await runHook({ localCheck: () => ({ ok: false, lines: ['x'] }) })).err))
ok('a throwing check still exits 0', (await runHook({ localCheck: () => { throw new Error('boom') } })).code === 0)
ok('a throwing check prints a failure warning', /^WARNING: review-evidence check failed: boom\n$/.test((await runHook({ localCheck: () => { throw new Error('boom') } })).err))
ok('missing check module: one line, exit 0', (await runHook({ localCheck: null })).code === 0)
ok('missing check module: says not available yet', (await runHook({ localCheck: null })).err === 'review-evidence not available yet\n')
ok('passing check prints nothing', (await runHook({ localCheck: () => ({ ok: true, lines: [] }) })).err === '')
ok('async check is awaited', /WARNING.*y/s.test((await runHook({ localCheck: async () => ({ ok: false, lines: ['y'] }) })).err))
ok('a malformed result still exits 0', (await runHook({ localCheck: () => ({ ok: false }) })).code === 0)
ok('kill-switch prints nothing', (await runHook({ localCheck: () => ({ ok: false, lines: ['x'] }), env: { PREPUSH_REVIEW_WARN_DISABLE: '1' } })).err === '')

// Real process: scratch dir with and without a review-evidence module; run through a symlinked
// directory where the OS permits one (a junction on Windows needs no privilege), else the real path.
const spawnHook = (script, cwd) =>
  spawnSync(process.execPath, [script], { cwd, input: 'refs/heads/a 1 refs/heads/a 0\n', encoding: 'utf8', shell: false })
const scratch = mkdtempSync(join(tmpdir(), 'prepush-'))
try {
  let link = hookPath, how = 'real path'
  try { symlinkSync(here, join(scratch, 'hooks-link'), 'junction'); link = join(scratch, 'hooks-link', 'pre-push.mjs'); how = 'symlinked path' } catch { /* symlinks not permitted here: run the real path */ }
  const missing = spawnHook(link, scratch)
  ok(`spawn (${how}), no module: exit 0`, missing.status === 0)
  ok(`spawn (${how}), no module: the one line`, missing.stderr === 'review-evidence not available yet\n')

  mkdirSync(join(scratch, 'scripts', 'ci'), { recursive: true })
  const mod = join(scratch, 'scripts', 'ci', 'review-evidence.mjs')
  writeFileSync(mod, "export const localCheck = () => ({ ok: false, lines: ['no correctness record'] })\n")
  const warned = spawnHook(link, scratch)
  ok('spawn with a failing check: exit 0', warned.status === 0)
  ok('spawn with a failing check: warns with the line', /WARNING.*no correctness record/s.test(warned.stderr))

  writeFileSync(mod, "export const localCheck = () => { throw new Error('boom') }\n")
  const thrown = spawnHook(link, scratch)
  ok('spawn with a throwing check: exit 0 with a failure warning', thrown.status === 0 && /check failed: boom/.test(thrown.stderr))

  writeFileSync(mod, 'this is not javascript (\n')
  const broken = spawnHook(link, scratch)
  ok('spawn with an unparseable module: exit 0', broken.status === 0)
  ok('spawn with an unparseable module: reported as a failed check, not as missing', /check failed/.test(broken.stderr) && !/not available yet/.test(broken.stderr))

  const fast = { ...process.env, PREPUSH_REVIEW_TIMEOUT_MS: '300' }
  writeFileSync(mod, 'export const localCheck = () => new Promise(() => {})\n')
  const hung = spawnSync(process.execPath, [link], { cwd: scratch, env: fast, input: '', encoding: 'utf8', shell: false, timeout: 8000 })
  ok('spawn with a never-settling check: exit 0 (not 13) and a timeout line', hung.status === 0 && /timed out/.test(hung.stderr))

  writeFileSync(mod, 'setInterval(() => {}, 1000)\nexport const localCheck = () => new Promise(() => {})\n')
  const alive = spawnSync(process.execPath, [link], { cwd: scratch, env: fast, input: '', encoding: 'utf8', shell: false, timeout: 8000 })
  ok('spawn with a loop-holding check: exits 0 at the watchdog, not hung', alive.status === 0 && /timed out/.test(alive.stderr))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// The shim itself: run with sh from a scratch tree root (skipped where sh is absent). The no-node
// cases replace PATH, so sh is resolved to an absolute native path first (Git for Windows' sh.exe
// has no /bin/sh that native Node can spawn).
const shimSrc = join(here, '..', '..', '.githooks', 'pre-push')
const findSh = () => {
  for (const d of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const n of ['sh', 'sh.exe']) { if (existsSync(join(d, n))) return join(d, n) }
  }
  return null
}
const sh = findSh()
const hasSh = sh !== null && spawnSync(sh, ['-c', 'exit 0'], { shell: false }).status === 0
if (hasSh) {
  const tree = mkdtempSync(join(tmpdir(), 'prepush-shim-'))
  try {
    mkdirSync(join(tree, 'scripts', 'hooks'), { recursive: true })
    copyFileSync(hookPath, join(tree, 'scripts', 'hooks', 'pre-push.mjs'))
    copyFileSync(shimSrc, join(tree, 'shim'))
    const withNode = spawnSync(sh, [join(tree, 'shim')], { cwd: tree, input: '', encoding: 'utf8', shell: false })
    ok('shim with node: exit 0 and runs the hook', withNode.status === 0 && withNode.stderr === 'review-evidence not available yet\n')
    const bin = join(tree, 'bin')
    mkdirSync(bin)
    const noNode = spawnSync(sh, [join(tree, 'shim')], { cwd: tree, env: { PATH: bin }, input: '', encoding: 'utf8', shell: false })
    ok('shim without node on PATH: exit 0 and one line', noNode.status === 0 && noNode.stderr === 'node not found; review-evidence warning skipped\n')
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 7\n', { mode: 0o755 })
    const nodeFails = spawnSync(sh, [join(tree, 'shim')], { cwd: tree, env: { PATH: bin }, input: '', encoding: 'utf8', shell: false })
    ok('shim whose node exits non-zero: still exit 0', nodeFails.status === 0)
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

// setup.mjs only ever runs in a scratch repo here, never in this checkout.
const repo = mkdtempSync(join(tmpdir(), 'prepush-setup-'))
try {
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, shell: false })
  ok('scratch repo initialised', init.status === 0)
  let out = '', err = ''
  const code = setup({ cwd: repo, out: (s) => { out += s }, err: (s) => { err += s } })
  ok('setup: exit 0', code === 0 && err === '')
  ok('setup: prints the value read back', out === 'core.hooksPath = .githooks')
  const back = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8', shell: false })
  ok('setup: git really holds the value', back.stdout.trim() === '.githooks')
  let e2 = ''
  ok('setup: failure exits 1 and says so', setup({ cwd: join(repo, 'does-not-exist'), out: () => {}, err: (s) => { e2 += s } }) === 1 && /could not set/.test(e2))
} finally {
  rmSync(repo, { recursive: true, force: true })
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
