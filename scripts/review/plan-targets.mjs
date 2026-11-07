// Typed plan targets and the plan-review reference check (plan Task 17).
//
// A plan task's `**Files:**` block lists typed targets, one per line: - <type>: `<value>` (optional trailing text
// after the closing backtick is ignored). parsePlan reads them; checkExisting walks the tasks in order and reports
// the references that cannot be true at the revision under review; resolveTasks and resolveRev are the CLI's
// `--tasks` and `--rev` rules (scripts/review/runner.mjs, and `review.mjs conformance` from Task 18).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { git } from './identity.mjs'
import { repoPath } from './records.mjs'

export const TARGET_TYPES = ['existing', 'create', 'modify', 'delete', 'command']

const HEADING = /^### Task (\d+)( \(operator\))?: /
const TARGET = new RegExp(`^- (${TARGET_TYPES.join('|')}): \`([^\`]+)\`(.*)$`)

const fenceOf = (l) => /^ {0,3}(`{3,}|~{3,})/.exec(l)?.[1]

// -> { tasks: [{ id, title, targets: [{ type, value, line }] }], problems: [{ task, text }] }. Headings and Files
// lines inside fenced code blocks are examples, not structure. A problem's `task` is the task it belongs to (or null).
const parse = (markdown) => {
  const lines = String(markdown).split(/\r?\n/)
  const tasks = [], problems = []
  const first = new Map()
  let cur = null, dup = false, inFiles = false, fence = null
  lines.forEach((l, i) => {
    const n = i + 1
    const f = fenceOf(l)
    if (f) {
      if (fence === null) fence = f
      else if (f[0] === fence[0] && f.length >= fence.length && l.trim() === f) fence = null
      inFiles = false
      return
    }
    if (fence !== null) return
    if (/^#{1,3}\s/.test(l)) {
      inFiles = false
      cur = null
      dup = false
      const h = HEADING.exec(l)
      if (h) {
        const id = `T${Number(h[1])}`
        if (first.has(id)) {
          problems[problems.length] = { task: id, text: `duplicate ${id}: line ${n} repeats the heading on line ${first.get(id)}` }
          dup = true
        } else {
          first.set(id, n)
          dup = false
          cur = { id, title: l.slice(h[0].length).trim(), targets: [] }
          tasks[tasks.length] = cur
        }
      } else if (/^### Task\b/.test(l)) {
        problems[problems.length] = { task: null, text: `line ${n}: malformed task heading ${JSON.stringify(l)}; expected "### Task <n>: <title>" or "### Task <n> (operator): <title>"` }
      }
      return
    }
    if (l.trim() === '**Files:**') { inFiles = cur !== null || dup; return }
    // A Files heading written another way would leave the task with no targets and no problem: report it.
    if (cur !== null && !dup && /^\s*(\*\*Files\*\*\s*:|\*\*Files\s*:\*\*|Files\s*:)\s*$/i.test(l)) {
      inFiles = false
      problems[problems.length] = { task: cur.id, text: `${cur.id} line ${n}: Files heading ${JSON.stringify(l.trim())} is not "**Files:**"; its lines are not read as targets` }
      return
    }
    if (!inFiles) return
    // Any other list item in the block (a "* " or "+ " or numbered bullet, or an indented one) is an untyped Files
    // line (plan Task 17), not the end of the block: ending there would drop it and every target after it unreported.
    const otherItem = !l.startsWith('- ') && /^\s*([-*+]|\d+[.)])\s+\S/.test(l)
    if (!otherItem && /^\s+\S/.test(l)) return // a wrapped continuation of the bullet above
    if (!otherItem && !l.startsWith('- ')) { inFiles = false; return }
    if (dup) return
    const m = TARGET.exec(l)
    if (m && m[2].trim() !== '') cur.targets[cur.targets.length] = { type: m[1], value: m[2], line: n }
    else problems[problems.length] = { task: cur.id, text: `${cur.id} line ${n}: untyped Files line ${JSON.stringify(l.trim())}; write "- ${TARGET_TYPES.join('|')}: \`value\`"` }
  })
  return { tasks, problems }
}

export const parsePlan = (markdown) => {
  const r = parse(markdown)
  return { tasks: r.tasks, problems: r.problems.map((p) => p.text) }
}

const defaultHomeExists = (value) => existsSync(join(homedir(), value.slice(2)))

// -> { problems, notes, considered }. `exists(path)` answers "is this a file at the revision under review".
// `tasks` (IDs) restricts the walk to the tasks not yet landed; undefined means every task. A path is available to a
// task if exists(path) or an earlier in-scope task creates it, and not after an earlier in-scope task deletes it.
// A `~/` existing target is checked on disk locally (homeExists) and only noted when `ci` is set.
export const checkExisting = ({ plan, exists, tasks, ci = Boolean(process.env.CI), homeExists = defaultHomeExists }) => {
  const parsed = parse(plan)
  const problems = [], notes = [], considered = []
  const known = new Set(parsed.tasks.map((t) => t.id))
  const scope = tasks === undefined ? null : new Set(tasks)
  const inScope = (id) => scope === null || scope.has(id)
  if (scope !== null) {
    for (const id of scope) if (!known.has(id)) problems[problems.length] = `unknown task ${id}`
    if (scope.size === 0) notes[notes.length] = 'no remaining tasks: nothing was checked'
  }
  for (const p of parsed.problems) if (p.task === null || inScope(p.task)) problems[problems.length] = p.text

  const state = new Map() // path -> { present, by } once an in-scope task creates or deletes it
  const available = (path) => (state.has(path) ? state.get(path).present : exists(path))
  for (const t of parsed.tasks) {
    if (!inScope(t.id)) continue
    for (const tg of t.targets) {
      considered[considered.length] = { task: t.id, type: tg.type, value: tg.value, line: tg.line }
      const at = `${t.id} line ${tg.line}`
      // One key per file: `./a.mjs`, `a.mjs` and `a\\b` name what git lists as `a.mjs` and `a/b`.
      const key = tg.value.startsWith('~/') ? tg.value : repoPath(tg.value)
      if (tg.type === 'existing' && tg.value.startsWith('~/')) {
        if (ci) notes[notes.length] = `${at}: ${tg.value} is outside the repository and not checked in CI`
        else if (!homeExists(tg.value)) problems[problems.length] = `${at}: existing target ${tg.value} is not on this machine`
      } else if (tg.type === 'existing' || tg.type === 'modify') {
        if (!available(key)) problems[problems.length] = `${at}: ${tg.type} target ${tg.value} is not a file at the revision under review, and no earlier task creates it`
      } else if (tg.type === 'create') {
        if (available(key)) {
          const by = state.get(key)
          problems[problems.length] = by?.present
            ? `${at}: create target ${tg.value} was already created by ${by.by}`
            : `${at}: create target ${tg.value} already exists at the revision under review`
        }
        state.set(key, { present: true, by: t.id })
      } else if (tg.type === 'delete') {
        state.set(key, { present: false, by: t.id })
      }
    }
  }
  return { problems, notes, considered }
}

// -> { tasks: string[] } or { error }. `--tasks` is a fact the author states: a plan new at the revision defaults to
// every task; an amendment to a merged plan must say which tasks remain (`none` for no task). Every requested ID
// must exist in the plan, also inside a list or a range; nothing is checked or recorded for a rejected selection.
export const resolveTasks = ({ tasks, planExistsAtRev, plan }) => {
  if (tasks === undefined) {
    if (planExistsAtRev) return { error: '--tasks is required: the plan already exists at the revision under review, so which tasks remain is for you to state (T10,T12-T14, or none)' }
    return { tasks: parse(plan).tasks.map((t) => t.id) }
  }
  const sel = String(tasks).trim()
  if (sel === 'none') return { tasks: [] }
  const ids = parse(plan ?? '').tasks.map((t) => t.id)
  const requested = []
  const bad = []
  for (const raw of sel.split(',')) {
    const item = raw.trim()
    const single = /^T(\d+)$/.exec(item)
    const range = /^T(\d+)-T?(\d+)$/.exec(item)
    if (single) requested[requested.length] = Number(single[1])
    else if (range && Number(range[1]) <= Number(range[2]) && Number(range[2]) - Number(range[1]) < 1000) {
      for (let k = Number(range[1]); k <= Number(range[2]); k++) requested[requested.length] = k
    } else bad[bad.length] = item === '' ? '(empty item)' : item
  }
  if (bad.length) return { error: `--tasks: cannot read ${bad.join(', ')}; use T<n>, T<a>-T<b> (comma separated) or none` }
  const unknown = [...new Set(requested)].filter((k) => !ids.includes(`T${k}`)).map((k) => `T${k}`)
  if (unknown.length) return { error: `--tasks names ${unknown.length === 1 ? 'a task' : 'tasks'} the plan does not have: ${unknown.join(', ')}` }
  const want = new Set(requested.map((k) => `T${k}`))
  return { tasks: ids.filter((id) => want.has(id)) }
}

// The revision the in-scope tasks start from: --rev, else the merge base of origin/main and HEAD (gitFacts), not
// HEAD, where the files this branch's own tasks create already exist.
export const resolveRev = ({ rev, gitImpl }) => rev ?? gitImpl.mergeBase

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout.toString()
}

// { mergeBase } after `git fetch origin main`.
export const gitFacts = async ({ cwd, gitFn = git }) => {
  must(await gitFn(['fetch', 'origin', 'main'], { cwd }), 'git fetch origin main (pass --rev <sha> to skip it)')
  return { mergeBase: must(await gitFn(['merge-base', 'origin/main', 'HEAD'], { cwd }), 'git merge-base origin/main HEAD').trim() }
}

// The set of files at a revision, as repo paths.
export const filesAtRev = async ({ cwd, rev, gitFn = git }) =>
  new Set(must(await gitFn(['ls-tree', '-r', '--name-only', '-z', rev], { cwd }), `git ls-tree ${rev}`).split('\0').filter((p) => p !== ''))
