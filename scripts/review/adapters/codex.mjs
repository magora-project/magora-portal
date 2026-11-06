// Codex CLI reviewer adapter, plus the spawn helpers the CLI adapters share.
// codex exec --sandbox read-only --output-schema <schema> -o <tmpfile> -   (prompt on stdin)
import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const vendor = 'openai'
export const MODEL = 'codex-cli'
export const INSTALL = 'npm i -g @openai/codex'
export const SCHEMA_PATH = fileURLToPath(new URL('../verdict.schema.json', import.meta.url))

const STDERR_TAIL = 4000
export const tail = (s) => (s.length > STDERR_TAIL ? `…${s.slice(-STDERR_TAIL)}` : s)

// npm's .cmd shims run `node "<shim dir>\<script>.js" %*`. Spawning a .cmd needs a shell, so on Windows we
// resolve the shim through `where` and spawn its target script with this Node instead. A native .exe is spawned as is.
export const resolveCommand = (name, { install, platform = process.platform, whereImpl, readFileImpl = readFileSync, execPath = process.execPath } = {}) => {
  if (platform !== 'win32') return { cmd: name, args: [] }
  const where = whereImpl ?? ((n) => { const r = spawnSync('where', [n], { encoding: 'utf8', shell: false, windowsHide: true }); return r.status === 0 ? r.stdout : '' })
  const hits = String(where(name) || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  for (const hit of hits) {
    if (/\.exe$/i.test(hit)) return { cmd: hit, args: [] }
    if (!/\.cmd$/i.test(hit)) continue
    let text
    try { text = readFileImpl(hit, 'utf8') } catch { continue }
    const m = /"%~?dp0%?\\([^"%]+?\.[cm]?js)"/i.exec(text)
    if (m) return { cmd: execPath, args: [win32.join(win32.dirname(hit), m[1])] }
  }
  const found = hits.length ? `found ${hits.join(', ')} but no node script behind it` : 'not found on PATH'
  throw new Error(`cannot run ${name}: ${found}. Install it with: ${install}`)
}

// The environment for a CLI reviewer child: a copy of env (default process.env) with `extra` set and
// GEMINI_API_KEY removed in every letter case (Windows env names ignore case), so only the Gemini adapter, which
// calls the API itself, ever holds that key.
export const childEnv = (env, extra = {}) => {
  const e = { ...(env ?? process.env), ...extra }
  for (const k of Object.keys(e)) if (k.toUpperCase() === 'GEMINI_API_KEY') delete e[k]
  return e
}

// An injected spawnImpl (tests) gets the bare command name; only the real spawn resolves Windows shims.
export const commandFor = (name, { install, spawnImpl, resolveImpl }) =>
  (resolveImpl ?? (spawnImpl ? (n) => ({ cmd: n, args: [] }) : resolveCommand))(name, { install })

// Run a child with an argument array, no shell, the prompt on stdin. On timeout the child itself is killed
// (child.kill(), then SIGKILL after a grace period): never a process-name match.
export const spawnCollect = ({ cmd, args, input, timeoutMs, spawnImpl = nodeSpawn, cwd, env, install }) => new Promise((resolve) => {
  const startFail = (e) => ({ exitCode: 127, stdout: '', stderr: `could not start ${cmd}: ${e && e.message}. Install it with: ${install}`, timedOut: false })
  let child
  try {
    child = spawnImpl(cmd, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  } catch (e) { resolve(startFail(e)); return }
  const out = [], err = []
  let timedOut = false, done = false, killTimer
  const finish = (r) => {
    if (done) return
    done = true
    clearTimeout(timer); clearTimeout(killTimer)
    resolve(r)
  }
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true
    try { child.kill() } catch { /* already gone */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, 5000)
    if (killTimer.unref) killTimer.unref()
  }, timeoutMs) : null
  child.stdout.on('data', (d) => out.push(Buffer.from(d)))
  child.stderr.on('data', (d) => err.push(Buffer.from(d)))
  child.on('error', (e) => finish(startFail(e)))
  child.stdin.on('error', () => {}) // the child may exit before reading all of its input
  child.on('close', (code) => finish({
    exitCode: code === null ? 1 : code,
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
    timedOut,
  }))
  child.stdin.end(input)
})

export const run = async ({ prompt, timeoutMs, spawnImpl, resolveImpl, cwd, env }) => {
  let c
  try { c = commandFor('codex', { install: INSTALL, spawnImpl, resolveImpl }) } catch (e) {
    return { exitCode: 127, stdout: '', stderr: e.message, truncated: false, timedOut: false }
  }
  const dir = mkdtempSync(join(tmpdir(), 'codex-review-'))
  const outFile = join(dir, 'last-message.txt')
  try {
    const r = await spawnCollect({
      cmd: c.cmd, args: [...c.args, 'exec', '--sandbox', 'read-only', '--output-schema', SCHEMA_PATH, '-o', outFile, '-'],
      input: prompt, timeoutMs, spawnImpl, cwd, env: childEnv(env), install: INSTALL,
    })
    let stdout = ''
    try { stdout = readFileSync(outFile, 'utf8') } catch { /* no final message: refused or failed downstream */ }
    return { exitCode: r.exitCode, stdout, stderr: tail(r.stderr), truncated: false, timedOut: r.timedOut }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
