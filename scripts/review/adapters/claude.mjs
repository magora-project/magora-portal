// Claude Code reviewer adapter: claude -p --model <opus|fable> --output-format json, prompt on stdin.
// The JSON envelope's `.result` string is what the runner classifies; `is_error: true` is exit code 1.
import { childEnv, commandFor, spawnCollect, tail } from './codex.mjs'

export const vendor = 'anthropic'
export const MODELS = ['opus', 'fable']
export const INSTALL = 'npm i -g @anthropic-ai/claude-code'

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)

// `--output-format json` prints one result object; a verbose run prints an array of events ending in it.
export const unwrap = (stdout) => {
  let env
  try { env = JSON.parse(stdout) } catch { return null }
  if (Array.isArray(env)) env = env.filter((e) => isObj(e) && e.type === 'result').at(-1)
  if (!isObj(env) || typeof env.result !== 'string') return null
  return { isError: env.is_error === true, result: env.result }
}

export const run = async ({ prompt, timeoutMs, spawnImpl, resolveImpl, cwd, env, model = 'opus' }) => {
  if (!MODELS.includes(model)) throw new Error(`claude model must be one of ${MODELS.join('|')}`)
  let c
  try { c = commandFor('claude', { install: INSTALL, spawnImpl, resolveImpl }) } catch (e) {
    return { exitCode: 127, stdout: '', stderr: e.message, truncated: false, timedOut: false }
  }
  const r = await spawnCollect({
    cmd: c.cmd, args: [...c.args, '-p', '--model', model, '--output-format', 'json'],
    // LANE_THRESHOLD_DISABLE=1 is .claude/hooks/lane-threshold.mjs's kill-switch: the reviewer session reads the
    // repo, and the author's lane threshold is not its concern.
    input: prompt, timeoutMs, spawnImpl, cwd, env: childEnv(env, { LANE_THRESHOLD_DISABLE: '1' }), install: INSTALL,
  })
  const base = { truncated: false, timedOut: r.timedOut, stderr: tail(r.stderr) }
  if (r.exitCode !== 0) return { ...base, exitCode: r.exitCode, stdout: '' }
  const u = unwrap(r.stdout)
  if (!u) return { ...base, exitCode: 1, stdout: '', stderr: `${base.stderr}\nclaude printed no recognisable JSON result envelope`.trim() }
  return { ...base, exitCode: u.isError ? 1 : 0, stdout: u.result }
}
