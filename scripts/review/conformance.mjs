// Plan conformance (spec §5.4, plan Task 18): the declared tasks' postconditions, then the `conformance` slot
// reviewer on the declared tasks' text and the PR's own diff, written as one conformance record.
// CLI entry: scripts/review/review.mjs.
//
//   conformance --plan <path> --tasks <T1-T4,...> --author <openai|anthropic|google|none> [--reviewer codex|claude|gemini]
//               [--supersedes <stem>] [--base <ref>] [--model opus|fable] [--timeout-min <n>]
//
// Postconditions, per typed target of each declared task (scripts/review/plan-targets.mjs):
//   create, modify: a file at HEAD and in the PR's diff (git diff --name-only <merge base> HEAD);
//   delete: not a file at HEAD; existing: nothing (plan review checks it);
//   command: run now, from the repository root, with no shell; its exit status is recorded. Identical command
//     strings run once and the result counts for each task. A command that cannot run (it needs a shell, or does
//     not start, or is killed) is recorded with exit -1.
// Each failed postcondition is a P1 deviation finding D<position of its check> (source 'postcondition'), numbered before the
// reviewer's findings. The record is written by runner.mjs runReview; see there for the conformance block, which
// also names the plan checked (its repo path and blob at HEAD; the plan must be committed).
import { spawn as nodeSpawn } from 'node:child_process'
import { win32 } from 'node:path'
import { parseArgs } from 'node:util'
import { EVIDENCE_DIR, git } from './identity.mjs'
import { deviationIds, repoPath } from './records.mjs'
import { filesAtRev, parsePlan, resolveTasks } from './plan-targets.mjs'
import { UsageError, runReview, usage } from './runner.mjs'
import { DRAIN_MS } from './adapters/codex.mjs'

export { deviationIds }

const OPTIONS = {
  plan: { type: 'string' }, tasks: { type: 'string' }, author: { type: 'string' }, reviewer: { type: 'string' },
  supersedes: { type: 'string' }, base: { type: 'string' }, model: { type: 'string' }, 'timeout-min': { type: 'string' },
}
export const USAGE = `usage:
  review.mjs conformance --plan <path> --tasks <T1-T4,...> --author <openai|anthropic|google|none> [--reviewer codex|claude|gemini]
                         [--supersedes <stem>] [--base <ref>] [--model opus|fable] [--timeout-min <n>]`

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout.toString()
}

// ---------- commands ----------

// A command string as argv, split as a POSIX shell would for words and quotes only: '...' is literal; in "..." a
// backslash escapes only " and \; outside quotes a backslash is literal (Windows paths). Anything a shell would
// interpret (| & ; < > ` $ unquoted) is refused: no shell runs the command, so it would silently mean something else.
export const splitCommand = (cmd) => {
  const s = String(cmd)
  const out = []
  let cur = '', word = false, quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote === '\'') {
      if (ch === '\'') quote = null
      else cur += ch
    } else if (quote === '"') {
      if (ch === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i]
      else if (ch === '"') quote = null
      else cur += ch
    } else if (ch === '\'' || ch === '"') {
      quote = ch
      word = true
    } else if (/\s/.test(ch)) {
      if (word) { out[out.length] = cur; cur = ''; word = false }
    } else if ('|&;<>`$'.includes(ch)) {
      throw new Error(`\`${s}\` needs a shell (unquoted ${ch}), and conformance runs commands without one: make each command its own command target`)
    } else {
      cur += ch
      word = true
    }
  }
  if (quote !== null) throw new Error(`unterminated ${quote} quote in \`${s}\``)
  if (word) out[out.length] = cur
  if (out.length === 0) throw new Error('empty command')
  return out
}

const NPM_CLIS = { npm: 'npm-cli.js', npx: 'npx-cli.js' }

// -> { file, args } to spawn with shell: false. On Windows npm and npx are .cmd shims, which need a shell, so they run
// as `node <dir>/node_modules/npm/bin/<npm|npx>-cli.js`, <dir> the directory of this Node; arguments pass through.
export const commandArgv = (cmd, { platform = process.platform, execPath = process.execPath } = {}) => {
  const [name, ...args] = splitCommand(cmd)
  if (platform === 'win32' && NPM_CLIS[name] !== undefined) {
    return { file: execPath, args: [win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', NPM_CLIS[name]), ...args] }
  }
  return { file: name, args }
}

// -> { exit, detail }. The output goes to onOutput as it arrives and is not kept: a record is committed, and a
// command's output can hold anything. exit -1 means the command did not run to an exit status. The result comes at
// 'close', or drainMs after 'exit': a background descendant that inherited the pipes cannot hold the run open.
export const runCommand = ({ cmd, cwd, env, spawnImpl = nodeSpawn, onOutput = () => {}, drainMs = DRAIN_MS }) => {
  let argv
  try { argv = commandArgv(cmd) } catch (e) { return Promise.resolve({ exit: -1, detail: `not run: ${e.message}` }) }
  return new Promise((resolve) => {
    let child, done = false, drainTimer
    const finish = (r) => { if (!done) { done = true; clearTimeout(drainTimer); resolve(r) } }
    const result = (code, signal) => (Number.isInteger(code) ? { exit: code, detail: `exited ${code}` } : { exit: -1, detail: `killed by ${signal ?? 'a signal'}` })
    try {
      child = spawnImpl(argv.file, argv.args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) { finish({ exit: -1, detail: `could not start ${argv.file}: ${e && e.message}` }); return }
    for (const s of [child.stdout, child.stderr]) if (s) s.on('data', (d) => onOutput(d.toString()))
    child.on('error', (e) => finish({ exit: -1, detail: `could not start ${argv.file}: ${e && e.message}` }))
    child.on('exit', (code, signal) => {
      drainTimer = setTimeout(() => {
        for (const s of [child.stdout, child.stderr]) { try { s?.destroy() } catch { /* already closed */ } }
        const r = result(code, signal)
        finish({ ...r, detail: `${r.detail}; its output pipes were still held open ${drainMs} ms later (a background process?)` })
      }, drainMs)
    })
    child.on('close', (code, signal) => finish(result(code, signal)))
  })
}

// ---------- postconditions ----------

// The declared tasks of a plan, in plan order: [{ id, title, targets }].
export const declaredTasks = (plan, ids) => parsePlan(plan).tasks.filter((t) => ids.includes(t.id))

// -> [{ task, target, ok, detail, exit? }] for every create, modify, delete and command target of `tasks`, in order.
// base is the merge base; head the reviewed commit. A command entry also carries its exit status.
export const postconditions = async ({ tasks, cwd, base, head, env, spawnImpl = nodeSpawn, onOutput }) => {
  const present = await filesAtRev({ cwd, rev: head })
  const changed = new Set(must(await git(['diff', '--name-only', '-z', '--no-renames', base, head], { cwd }), 'git diff --name-only').split('\0').filter(Boolean))
  const ran = new Map() // command string -> { exit, detail }
  const out = []
  for (const t of tasks) {
    for (const target of t.targets) {
      if (target.type === 'command') {
        if (!ran.has(target.value)) ran.set(target.value, await runCommand({ cmd: target.value, cwd, env, spawnImpl, onOutput }))
        const r = ran.get(target.value)
        out[out.length] = { task: t.id, target, ok: r.exit === 0, detail: r.detail, exit: r.exit }
        continue
      }
      const path = repoPath(target.value)
      if (target.type === 'create' || target.type === 'modify') {
        const there = present.has(path), touched = changed.has(path)
        const detail = !there ? `not a file at HEAD ${head.slice(0, 12)}` : !touched ? 'a file at HEAD, but the PR does not change it' : 'a file at HEAD, changed by the PR'
        out[out.length] = { task: t.id, target, ok: there && touched, detail }
      } else if (target.type === 'delete') {
        const there = present.has(path)
        out[out.length] = { task: t.id, target, ok: !there, detail: there ? `still a file at HEAD ${head.slice(0, 12)}` : 'not a file at HEAD' }
      }
    }
  }
  return out
}

// The check runReview calls: the failed postconditions as findings D<position>, the commands, nextId, and a prompt section.
const conformanceCheck = ({ planPath, tasks, planProblems, ctx }) => async ({ root, mb, head }) => {
  const { io } = ctx
  const pc = await postconditions({ tasks, cwd: root, base: mb, head, env: ctx.env, spawnImpl: ctx.commandSpawnImpl, onOutput: (s) => io.err(s) })
  const failed = pc.filter((p) => !p.ok)
  // Each ID is the check's position (plan problems, then every target in plan order), not its rank among the
  // failures: fixing D1 must not turn the old D2 into D1, where a justification written for D1 would then pass.
  // Positions hold while the plan blob and tasks hold; a change to either sends the full input (runner.mjs).
  const findings = [
    ...planProblems.map((text, i) => ({ id: `D${i + 1}`, summary: `plan: ${text}`, file: planPath })),
    ...pc.map((p, i) => (p.ok ? null : { id: `D${planProblems.length + i + 1}`, summary: `postcondition failed: ${p.task} ${p.target.type} \`${p.target.value}\`: ${p.detail}`, file: planPath, line: p.target.line })).filter(Boolean),
  ].map((f) => ({ severity: 'P1', ...f, source: 'postcondition' }))
  const nextId = planProblems.length + pc.length + 1
  const commands = []
  for (const p of pc) if (p.target.type === 'command' && !commands.some((c) => c.cmd === p.target.value)) commands[commands.length] = { cmd: p.target.value, exit: p.exit }
  io.out(`conformance: ${pc.length} postcondition(s), ${failed.length} failed${planProblems.length ? `, ${planProblems.length} plan problem(s)` : ''}\n`)
  for (const f of findings) io.err(`conformance: ${f.id} ${f.summary}\n`)
  const lines = pc.map((p) => `${p.ok ? 'ok  ' : 'FAIL'} ${p.task} ${p.target.type} \`${p.target.value}\`: ${p.detail}`)
  const text = [
    pc.length ? lines.join('\n') : 'The declared tasks have no create, modify, delete or command targets: nothing was checked mechanically.',
    '',
    findings.length
      ? `The evidence writer recorded ${findings.map((f) => f.id).join(', ')} for these. Do not repeat them; your findings are numbered after every check (D${nextId} on), in your order.`
      : `Every postcondition held. Your findings are numbered D${nextId} on, in your order.`,
  ].join('\n')
  return { findings, commands, nextId, context: [{ heading: 'Postconditions (run by the evidence writer)', text }] }
}

// ---------- CLI ----------

// -> { text, blob } of planPath at `head` (a commit sha), or null when it is not a file there. The text is read from
// the blob, so the record's blob is the plan the tasks were resolved from.
export const readPlanAt = async ({ root, head, planPath }) => {
  const r = await git(['rev-parse', '--verify', '--quiet', `${head}:${planPath}`], { cwd: root })
  if (r.code !== 0) return null
  const blob = r.stdout.toString().trim()
  const t = await git(['cat-file', 'blob', blob], { cwd: root })
  if (t.code !== 0) return null
  return { text: t.stdout.toString(), blob }
}

export async function conformanceCli(argv, ctx) {
  const { io } = ctx
  try {
    const { values: o } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false })
    if (typeof o.plan !== 'string' || o.plan.trim() === '') usage('conformance needs --plan <path>')
    if (o.tasks === undefined) usage('conformance needs --tasks <ids>: the plan tasks this PR declares in its Plan field')
    const root = must(await git(['rev-parse', '--show-toplevel'], { cwd: ctx.cwd }), 'git rev-parse --show-toplevel').trim()
    const planPath = repoPath(o.plan)
    if (planPath.startsWith('/') || /^[A-Za-z]:/.test(planPath) || planPath.startsWith('../')) usage('--plan must be relative to the repository root')
    // One HEAD for the plan text, its blob and the reviewed head: runReview refuses if HEAD moves before it reads it.
    const head = must(await git(['rev-parse', 'HEAD'], { cwd: root }), 'git rev-parse HEAD').trim()
    const read = await readPlanAt({ root, head, planPath })
    if (read === null) usage(`${planPath} is not a file at HEAD: commit the plan first (conformance reads it at the reviewed commit)`)
    const planText = read.text
    // The record is bound to this plan: its path and its blob at HEAD, which must be what the work tree holds.
    const planDirty = await git(['diff', '--quiet', head, '--', `:(literal)${planPath}`], { cwd: root })
    if (planDirty.code === 1) usage(`${planPath} has uncommitted changes: commit them first, so the record names the plan it checked`)
    if (planDirty.code !== 0) throw new Error(`git diff --quiet HEAD failed (${planDirty.code}): ${planDirty.stderr.trim()}`)
    const planBlob = read.blob
    const sel = resolveTasks({ tasks: o.tasks, planExistsAtRev: true, plan: planText })
    if (sel.error) usage(sel.error)
    if (sel.tasks.length === 0) usage('conformance needs at least one task: --tasks none would check nothing')
    const parsed = parsePlan(planText)
    const tasks = parsed.tasks.filter((t) => sel.tasks.includes(t.id))
    // A declared task's malformed Files line is a deviation too: conformance cannot check what it cannot read.
    const planProblems = parsed.problems.filter((p) => sel.tasks.includes(/\bT\d+\b/.exec(p)?.[0]))
    if (tasks.some((t) => t.targets.some((x) => x.type === 'command'))) {
      const d = await git(['diff', '--quiet', 'HEAD', '--', '.', `:(exclude)${EVIDENCE_DIR}`], { cwd: root })
      if (d.code === 1) usage('tracked files have uncommitted changes: commit them first, so each command target runs against the commit the record covers')
      if (d.code !== 0) throw new Error(`git diff --quiet HEAD failed (${d.code}): ${d.stderr.trim()}`)
    }
    const run = { slot: 'conformance', author: o.author, reviewer: o.reviewer, supersedes: o.supersedes, base: o.base, model: o.model, 'timeout-min': o['timeout-min'] }
    return await runReview(run, ctx, { head, plan: { path: planPath, tasks: sel.tasks, blob: planBlob }, check: conformanceCheck({ planPath, tasks, planProblems, ctx }) })
  } catch (e) {
    if (e instanceof UsageError || (e && typeof e.code === 'string' && e.code.startsWith('ERR_PARSE_ARGS'))) io.err(`${e.message}\n${USAGE}\n`)
    else io.err(`review: ${e && e.message}\n`)
    return 1
  }
}
