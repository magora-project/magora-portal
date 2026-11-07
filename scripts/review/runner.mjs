// Local reviewer runner (spec §5.3, §5.5, §5.6): picks an independent reviewer, sends it the slot prompt and the
// review input, classifies the outcome mechanically and writes a review record. CLI entry: scripts/review/review.mjs.
// completeness and conformance prompts also carry the promise context: the plan task sections (declared in
// .review/local.json, or for conformance by its --tasks), the spec sections those tasks cite, and the commit messages
// since the merge base. Conformance runs through `review.mjs conformance` (scripts/review/conformance.mjs), which
// calls runReview with its postconditions; `run --slot conformance` refuses.
//
//   run     --slot <slot> --author <openai|anthropic|google|none> [--reviewer codex|claude|gemini]
//           [--path <spec-or-plan>] [--supersedes <stem>] [--base <ref>] [--model opus|fable] [--timeout-min <n>]
//           [--tasks <T10,T12-T14|none>] [--rev <sha>]   (the plan slot: the reference check, plan Task 17)
//   dispose --record <stem> --finding <id> --kind pre-existing|reclassified-nit|justified-deviation --reason <text> [--issue <url>]
//
// Exit 0 only for a completed review (or a written disposition); 1 for any other outcome or a usage error.
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { DIFF_ARGS, EVIDENCE_DIR, blobIdentity, geminiDiff, git, inputIdentity, mergeBase } from './identity.mjs'
import { SLOTS, addedRecordStems, chainHeads, deviationIds, inherit, isBlockingByDefault, isGateId, readRecords, repoPath, slotFile, typeForSlot, undisposedBlocking, writeRecord } from './records.mjs'
import { checkExisting, filesAtRev, gitFacts, resolveRev, resolveTasks } from './plan-targets.mjs'
import * as codex from './adapters/codex.mjs'
import * as claude from './adapters/claude.mjs'
import * as gemini from './adapters/gemini.mjs'

export const ADAPTERS = { codex, claude, gemini }
export const ADAPTER_VENDOR = { codex: 'openai', claude: 'anthropic', gemini: 'google' }
const ORDER = ['codex', 'claude', 'gemini']
const AUTHOR_VENDORS = ['openai', 'anthropic', 'google', 'none']
const BLOB_SLOTS = ['spec', 'plan']
const DISPOSE_KINDS = ['pre-existing', 'reclassified-nit', 'justified-deviation']
export const DEFAULT_TIMEOUT_MIN = 20
const SCHEMA_TEXT = readFileSync(new URL('./verdict.schema.json', import.meta.url), 'utf8')

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== ''
const isSubstitute = (slot) => slot.startsWith('substitute:')

export const recordType = (slot) => {
  const t = typeForSlot(slot)
  if (!t) throw new Error(`unknown slot ${slot}`)
  return t
}

// ---------- verdict parsing ----------

// The verdict.schema.json shape, checked in code. `file`/`line` may be absent or null. With inherited IDs, `inherited`
// must name each exactly once: no extras, no duplicates. New finding IDs are unique, never reuse an inherited ID,
// and never take a gate prefix (thread:, cr:, gemini:), which only the gate's own findings carry.
export const validVerdict = (v, inheritedIds = []) => {
  if (!isObj(v) || (v.verdict !== 'pass' && v.verdict !== 'fail')) return false
  if (!Array.isArray(v.findings) || !Array.isArray(v.inherited)) return false
  const want = new Set(inheritedIds)
  const ids = new Set()
  for (const f of v.findings) {
    if (!isObj(f) || !nonEmpty(f.id) || !nonEmpty(f.severity) || !nonEmpty(f.summary)) return false
    if (!(f.file === undefined || f.file === null || typeof f.file === 'string')) return false
    if (!(f.line === undefined || f.line === null || Number.isInteger(f.line))) return false
    if (ids.has(f.id) || want.has(f.id) || isGateId(f.id)) return false
    ids.add(f.id)
  }
  const seen = new Set()
  for (const e of v.inherited) {
    if (!isObj(e) || !want.has(e.id) || seen.has(e.id) || !['resolved', 'open'].includes(e.status) || typeof e.note !== 'string') return false
    seen.add(e.id)
  }
  return seen.size === want.size
}

// The balanced {...} starting at i (string-aware), or -1.
const matchBrace = (s, i) => {
  let depth = 0, inStr = false, esc = false
  for (let j = i; j < s.length; j++) {
    const ch = s[j]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return j
  }
  return -1
}

// Extraction rule: the whole trimmed stdout, if it parses and validates. Otherwise every balanced {...} substring
// (which covers a fenced ```json block and prose around the object) that parses and validates; the one ending last
// wins, the outermost on a tie. Nothing valid -> null, which classifies as `refused`.
export const extractVerdict = (stdout, inheritedIds = []) => {
  const tryParse = (t) => { try { const v = JSON.parse(t); return validVerdict(v, inheritedIds) ? v : null } catch { return null } }
  const whole = tryParse(stdout.trim())
  if (whole) return whole
  let best = null, bestEnd = -1
  for (let i = stdout.indexOf('{'); i !== -1; i = stdout.indexOf('{', i + 1)) {
    const end = matchBrace(stdout, i)
    if (end <= bestEnd) continue
    const v = tryParse(stdout.slice(i, end + 1))
    if (v) { best = v; bestEnd = end }
  }
  return best
}

const cleanFinding = (f) => ({
  id: f.id, severity: f.severity, summary: f.summary,
  ...(typeof f.file === 'string' ? { file: f.file } : {}),
  ...(Number.isInteger(f.line) ? { line: f.line } : {}),
})

// The order is the contract: timeout, then truncated, then a non-zero exit, then the content check.
export const classifyOutcome = ({ exitCode, stdout, truncated, timedOut, inheritedIds = [] }) => {
  const unrun = (outcome) => ({ outcome, verdict: null, findings: [], inherited: [] })
  if (timedOut) return unrun('timeout')
  if (truncated) return unrun('truncated')
  if (exitCode !== 0) return unrun('failed')
  const v = extractVerdict(String(stdout ?? ''), inheritedIds)
  if (!v) return unrun('refused')
  // A `fail` that names nothing (no new finding, no inherited one left open) is malformed, not a result.
  if (v.verdict === 'fail' && v.findings.length === 0 && !v.inherited.some((e) => e.status === 'open')) return unrun('refused')
  return { outcome: 'completed', verdict: v.verdict, findings: v.findings.map(cleanFinding), inherited: v.inherited.map((e) => ({ id: e.id, status: e.status, note: e.note })) }
}

// ---------- dispatch ----------

// The dispatch table (§5.3). Substitute slots are not picked here: --reviewer is required for them (§5.5).
export const pickReviewer = ({ authorVendor, slot, otherVendor }) => {
  if (isSubstitute(slot)) throw new Error(`slot ${slot} has no default reviewer: pass --reviewer codex|claude|gemini`)
  if (slot === 'completeness') {
    if (!otherVendor) throw new Error('completeness needs the correctness reviewer\'s vendor: run correctness first')
    const pick = ORDER.find((a) => ADAPTER_VENDOR[a] !== authorVendor && ADAPTER_VENDOR[a] !== otherVendor)
    if (!pick) throw new Error('independence: no vendor is left for completeness')
    return pick
  }
  return authorVendor === 'openai' ? 'claude' : 'codex'
}

// null when independent, else the reason. Substitute slots are judged by the gate's countedVendors rule, not here.
export const independenceProblem = ({ authorVendor, slot, reviewer, otherVendor }) => {
  if (isSubstitute(slot)) return null
  const v = ADAPTER_VENDOR[reviewer]
  if (v === authorVendor) return `independence: reviewer ${reviewer} (${v}) is the author's vendor`
  if (slot === 'completeness' && v === otherVendor) return `independence: reviewer ${reviewer} (${v}) already reviewed correctness`
  return null
}

// ---------- promise context (David, 2026-11-06) ----------

// The slots whose prompts ask what the spec, plan and commit messages promised (completeness.md; conformance from
// PR C). They get the declared plan task sections, the spec sections those tasks cite, and the commit messages.
export const CONTEXT_SLOTS = ['completeness', 'conformance']

// Markdown headings outside fenced code blocks: [{ line, level, text }]. A `# comment` in a ```bash block is not one.
export const headings = (lines) => {
  const out = []
  let fenceOpen = null
  lines.forEach((l, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l)
    if (f) {
      if (fenceOpen === null) fenceOpen = f[1]
      else if (f[1][0] === fenceOpen[0] && f[1].length >= fenceOpen.length && l.trim() === f[1]) fenceOpen = null
      return
    }
    if (fenceOpen !== null) return
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (h) out[out.length] = { line: i, level: h[1].length, text: h[2] }
  })
  return out
}

// The section a heading opens: through the line before the next heading of its level or higher.
const sectionAt = (lines, hs, k) => {
  const end = hs.slice(k + 1).find((h) => h.level <= hs[k].level)
  return lines.slice(hs[k].line, end ? end.line : lines.length).join('\n').trimEnd()
}

// Plan task sections for task IDs ('T10'): the heading `Task 10` (any level, with or without a suffix).
export const planTaskSections = (text, tasks) => {
  const lines = String(text).split(/\r?\n/), hs = headings(lines)
  const sections = [], missing = []
  for (const t of tasks) {
    const n = Number(String(t).replace(/^T/, ''))
    const k = hs.findIndex((h) => /^Task\s+(\d+)/.exec(h.text)?.[1] === String(n))
    if (k === -1) missing[missing.length] = t
    else sections[sections.length] = { id: t, text: sectionAt(lines, hs, k) }
  }
  return { sections, missing }
}

// `§5.3` citations in text, in order of first appearance.
export const citedSections = (text) => [...new Set([...String(text).matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]))]

// Spec sections by number: the heading `5.3 Title` or `7. Title`, through its subsections.
export const specSections = (text, ids) => {
  const lines = String(text).split(/\r?\n/), hs = headings(lines)
  const sections = [], missing = []
  for (const id of ids) {
    const k = hs.findIndex((h) => h.text.startsWith(id) && /^\.?(\s|$)/.test(h.text.slice(id.length)))
    if (k === -1) missing[missing.length] = id
    else sections[sections.length] = { id, text: sectionAt(lines, hs, k) }
  }
  return { sections, missing }
}

// .review/local.json's spec and plan (written by `review.mjs init-local`), or null when there is none.
const readLocal = (root) => {
  const file = join(root, EVIDENCE_DIR, 'local.json')
  if (!existsSync(file)) return null
  let local
  try { local = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { usage(`${EVIDENCE_DIR}/local.json is not JSON (${e.message}): rewrite it with init-local`) }
  if (!isObj(local)) usage(`${EVIDENCE_DIR}/local.json is not a JSON object: rewrite it with init-local`)
  return local
}

// The promise context for a PR input: [{ heading, text }] plus warnings. Read at HEAD (the reviewed commit), not the
// work tree. Throws a usage error for a declared task the plan lacks, so a typo cannot drop a task's promises.
// `plan` ({ path, tasks }) replaces local.json's plan: conformance names its tasks on the command line.
const promiseContext = async ({ root, mb, head, plan: declared }) => {
  const parts = [], warnings = []
  const at = async (path) => must(await git(['cat-file', 'blob', `${head}:${repoPath(path)}`], { cwd: root }), `reading ${path} at HEAD`)
  const local = readLocal(root)
  if (local === null) warnings[warnings.length] = `no ${EVIDENCE_DIR}/local.json: the prompt has no ${declared ? '' : 'plan task or '}spec sections (run npm run review -- init-local)`
  let cited = []
  const plan = declared ?? local?.plan
  if (plan !== undefined) {
    if (!isObj(plan) || typeof plan.path !== 'string' || !Array.isArray(plan.tasks)) usage(`${EVIDENCE_DIR}/local.json: plan must be { path, tasks }`)
    const { sections, missing } = planTaskSections(await at(plan.path), plan.tasks)
    if (missing.length) usage(`${plan.path} has no section for declared task(s) ${missing.join(', ')}${declared ? '' : ` (${EVIDENCE_DIR}/local.json)`}`)
    for (const sct of sections) parts[parts.length] = { heading: `Plan ${repoPath(plan.path)}, ${sct.id}`, text: sct.text }
    cited = citedSections(sections.map((x) => x.text).join('\n'))
  }
  if (typeof local?.spec === 'string' && cited.length) {
    const { sections, missing } = specSections(await at(local.spec), cited)
    for (const sct of sections) parts[parts.length] = { heading: `Spec ${repoPath(local.spec)}, §${sct.id}`, text: sct.text }
    if (missing.length) {
      const note = `the declared tasks cite ${missing.map((m) => `§${m}`).join(', ')}, which ${repoPath(local.spec)} has no heading for`
      warnings[warnings.length] = note
      parts[parts.length] = { heading: 'Cited spec sections not found', text: note }
    }
  }
  const log = must(await git(['log', '--format=commit %H%n%B', `${mb}..${head}`], { cwd: root }), 'git log')
  parts[parts.length] = { heading: `Commit messages (${mb.slice(0, 12)}..${head.slice(0, 12)})`, text: log.trim() || '(none)' }
  return { parts, warnings }
}

// ---------- prompt ----------

const fence = (text, lang = '') => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const f = '`'.repeat(longest + 1)
  return `${f}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${f}`
}

export const buildPrompt = ({ slotPrompt, mode, full, fullLabel, delta, deltaLabel, inherited, context = [] }) => {
  const parts = [slotPrompt.trimEnd(), '',
    '## Output contract', '',
    'Reply with exactly one JSON object matching this JSON Schema, and nothing else:', '', fence(SCHEMA_TEXT, 'json'), '',
    '- `findings` are new findings. Give each a short unique ID (F1, F2, ...) that is not one of the inherited IDs below.',
    inherited.length
      ? '- `inherited` must name every inherited finding below exactly once: `resolved` if the current input fixes it, `open` if not, with a note.'
      : '- No findings are inherited: `inherited` must be `[]`.',
    '']
  const describe = {
    full: 'You are given the full current input.',
    'full+delta': 'You are given the full current input AND the delta since the superseded review. The superseded review left a blocking finding open, and a delta that does not touch it cannot show it fixed: judge each inherited finding against the full input.',
    delta: 'You are given only the delta since the superseded review, which completed with no undisposed blocking finding. Ask: did the changes break anything?',
  }
  parts.push('## Review input', '', describe[mode], '')
  if (full !== null) parts.push(`### ${fullLabel}`, '', fence(full, 'diff'), '')
  if (delta !== null) parts.push(`### ${deltaLabel}`, '', fence(delta, 'diff'), '')
  if (inherited.length) parts.push('### Inherited findings', '', fence(JSON.stringify(inherited, null, 2), 'json'), '')
  if (context.length) {
    parts.push('## What was promised', '', 'The declared plan tasks, the spec sections they cite, and the commit messages. Judge the diff against them.', '')
    for (const c of context) parts.push(`### ${c.heading}`, '', fence(c.text, 'markdown'), '')
  }
  return parts.join('\n')
}

// ---------- CLI ----------

const RUN_OPTIONS = {
  slot: { type: 'string' }, author: { type: 'string' }, reviewer: { type: 'string' }, path: { type: 'string' },
  supersedes: { type: 'string' }, base: { type: 'string' }, model: { type: 'string' }, 'timeout-min': { type: 'string' },
  tasks: { type: 'string' }, rev: { type: 'string' },
}
const DISPOSE_OPTIONS = {
  record: { type: 'string' }, finding: { type: 'string' }, kind: { type: 'string' }, reason: { type: 'string' }, issue: { type: 'string' },
}
const USAGE = `usage:
  review.mjs run --slot <${SLOTS.join('|')}> --author <${AUTHOR_VENDORS.join('|')}> [--reviewer codex|claude|gemini]
                 [--path <spec-or-plan>] [--supersedes <stem>] [--base <ref>] [--model opus|fable] [--timeout-min <n>]
                 [--tasks <T10,T12-T14|none>] [--rev <sha>]   (plan slot: --tasks is required when the plan is already at the revision)
  review.mjs dispose --record <stem> --finding <id> --kind ${DISPOSE_KINDS.join('|')} --reason <text> [--issue <url>]`

export class UsageError extends Error {}
export const usage = (msg) => { throw new UsageError(msg) }

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout.toString()
}
const refExists = async (cwd, ref) => (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd })).code === 0
// Default base: origin/main as last fetched when it exists, else local main.
const defaultBase = async (root, base) => base ?? ((await refExists(root, 'origin/main')) ? 'origin/main' : 'main')
const isObjectId = (s) => typeof s === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s)

// The record stems this branch adds (as the review-evidence check counts them), or null when there is no base
// to compare with, in which case every record counts as this branch's.
const addedStemsFor = async (root, base, head) => {
  try {
    return await addedRecordStems({ cwd: root, mergeBase: await mergeBase({ cwd: root, base, head }), head, untracked: true })
  } catch { return null }
}

// The review-evidence predicate's view of a correctness head (§5.3 1, 3, 4) for one identity: completed with a
// recognized verdict, an independent reviewer, every finding acceptably disposed, every `fixed.by` in its own chain.
const passingHead = (records, rec, { identity }) => {
  if (rec.outcome !== 'completed' || (rec.verdict !== 'pass' && rec.verdict !== 'fail')) return false
  if (rec.input.identity !== identity || rec.reviewer.vendor === rec.authorVendor) return false
  if (undisposedBlocking(rec).length) return false
  const byStem = new Map(records.map((r) => [r.stem, r]))
  const chain = new Set()
  for (let r = rec; r && !chain.has(r.stem); r = byStem.get(r.supersedes)) chain.add(r.stem)
  return rec.findings.every((f) => !(isBlockingByDefault(f) && f.disposition?.kind === 'fixed' && !chain.has(f.disposition.by)))
}

// Reviewer findings with every `ref-N` ID renamed to the first F<n> no other finding uses.
const awayFromRef = (findings) => {
  const used = new Set(findings.map((f) => f.id))
  return findings.map((f) => {
    if (!/^ref-\d+$/.test(f.id)) return f
    let k = 1
    while (used.has(`F${k}`)) k++
    used.add(`F${k}`)
    return { ...f, id: `F${k}` }
  })
}

// The three substitute:<bot> slots share one file, substitute.md, with {{bot}} filled in.
export const defaultPromptFor = (slot, { root }) => {
  const p = join(root, '.claude', 'review', 'slots', `${isSubstitute(slot) ? 'substitute' : slotFile(slot)}.md`)
  if (!existsSync(p)) throw new Error(`no slot prompt at ${p}`)
  const text = readFileSync(p, 'utf8')
  return isSubstitute(slot) ? text.replaceAll('{{bot}}', slot.slice('substitute:'.length)) : text
}

const findRecord = (records, stem) => {
  const r = records.find((x) => x.stem === stem)
  if (!r) usage(`no record ${stem} under ${EVIDENCE_DIR}/records`)
  if (r.invalid) usage(`record ${stem} is invalid: ${r.invalid.join('; ')}`)
  const by = records.find((x) => x.supersedes === stem)
  if (by) usage(`record ${stem} is already superseded by ${by.stem}: supersede the chain head`)
  return r
}

// writeRecord picks the first free --<n>; a `fixed.by` must name the new record's own stem, so predict it, and
// on a lost race remove the file we just created exclusively and try again.
const writeWithStem = (cwd, slot, identity, build) => {
  const dir = join(cwd, EVIDENCE_DIR, 'records')
  const prefix = `${slotFile(slot)}--${identity.slice(0, 12)}--`
  for (let attempt = 0; attempt < 5; attempt++) {
    let n = 1
    while (existsSync(join(dir, `${prefix}${n}.json`))) n++
    const stem = `${prefix}${n}`
    const path = writeRecord({ cwd, record: build(stem) })
    if (basename(path, '.json') === stem) return { path, stem }
    unlinkSync(path)
  }
  throw new Error(`could not claim a record name for ${prefix}`)
}

const cmdRun = async (argv, ctx) => {
  const { values: o } = parseArgs({ args: argv, options: RUN_OPTIONS, strict: true, allowPositionals: false })
  if (!SLOTS.includes(o.slot)) usage(`--slot must be one of ${SLOTS.join('|')}`)
  // A conformance record needs its conformance block (tasks, deviations, commands), which only the conformance
  // writer fills; a record written here could never pass review-evidence.
  if (o.slot === 'conformance') usage('conformance records come from `npm run review -- conformance --plan <path> --tasks <ids> --author <vendor>` (scripts/review/conformance.mjs), which runs the plan\'s postconditions and fills the conformance block that review-evidence requires; `run --slot conformance` would write a record without it')
  return runReview(o, ctx)
}

// One review of o.slot (the parsed `run` flags), written as a record. `conf` is the conformance writer's part
// (scripts/review/conformance.mjs), required for the conformance slot and refused for any other:
//   { plan: { path, tasks }, check: async ({ root, mb, head }) -> { findings, commands, context } }
// check() runs after every refusal and before the reviewer. Its findings (the failed postconditions, D1..Dn, each
// with source 'postcondition') lead the record; the reviewer's findings are renumbered to follow them; inherited
// postcondition findings are dropped, because check() recomputes them on every run. The record carries
// conformance: { tasks, deviations (the IDs of findings without a `fixed` disposition), commands }.
export const runReview = async (o, ctx, conf = null) => {
  const { cwd, io } = ctx
  if (!SLOTS.includes(o.slot)) usage(`--slot must be one of ${SLOTS.join('|')}`)
  if ((o.slot === 'conformance') !== (conf !== null)) usage(o.slot === 'conformance' ? 'a conformance review needs the conformance writer: run npm run review -- conformance' : `slot ${o.slot} takes no conformance part`)
  if (!AUTHOR_VENDORS.includes(o.author)) usage(`--author must be one of ${AUTHOR_VENDORS.join('|')}`)
  if (o.reviewer !== undefined && !ORDER.includes(o.reviewer)) usage(`--reviewer must be one of ${ORDER.join('|')}`)
  if (isSubstitute(o.slot) && o.reviewer === undefined) usage(`slot ${o.slot} needs --reviewer codex|claude|gemini (substitute slots are not picked by author vendor)`)
  const timeoutMin = o['timeout-min'] === undefined ? DEFAULT_TIMEOUT_MIN : Number(o['timeout-min'])
  if (!(timeoutMin > 0)) usage('--timeout-min must be a positive number')
  const blob = BLOB_SLOTS.includes(o.slot)
  if (blob && o.path === undefined) usage(`slot ${o.slot} needs --path <spec-or-plan>`)
  if (!blob && o.path !== undefined) usage(`--path is only for the ${BLOB_SLOTS.join('|')} slots`)
  if (o.slot !== 'plan' && (o.tasks !== undefined || o.rev !== undefined)) usage('--tasks and --rev are only for the plan slot')

  const root = must(await git(['rev-parse', '--show-toplevel'], { cwd }), 'git rev-parse --show-toplevel').trim()
  const head = must(await git(['rev-parse', 'HEAD'], { cwd: root }), 'git rev-parse HEAD').trim()
  const records = readRecords({ cwd: root })

  // input and the full current content
  let input, full, fullLabel
  if (blob) {
    const path = repoPath(o.path)
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('../')) usage('--path must be relative to the repository root')
    const identity = await blobIdentity({ cwd: root, rev: 'HEAD', path })
    input = { kind: 'blob', identity, path }
    full = must(await git(['cat-file', 'blob', identity], { cwd: root }), 'git cat-file')
    fullLabel = `Current ${path} (blob ${identity})`
  } else {
    const base = await defaultBase(root, o.base)
    const mb = await mergeBase({ cwd: root, base, head })
    const identity = await inputIdentity({ cwd: root, base, head })
    input = { kind: 'pr', identity, mergeBase: mb, head }
    full = (await geminiDiff({ cwd: root, base: mb, head })).toString('utf8')
    fullLabel = `Full current diff (merge base ${mb} .. ${head})`
  }

  // The plan reference check (plan Task 17): the typed Files targets against the tree the in-scope tasks start from.
  // --rev defaults to the merge base with origin/main, not HEAD, where this branch's own creations already exist.
  // Its problems become P1 findings of the plan record, whatever the reviewer says. Refusals come before any review.
  let planRef = null
  if (o.slot === 'plan') {
    let rev = o.rev
    if (rev === undefined) {
      try { rev = resolveRev({ rev, gitImpl: await (ctx.gitFacts ?? gitFacts)({ cwd: root }) }) } catch (e) { usage(e.message) }
    }
    const resolved = await git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: root })
    if (resolved.code !== 0) usage(`--rev ${rev} is not a commit in this repository`)
    rev = resolved.stdout.toString().trim()
    const files = await filesAtRev({ cwd: root, rev })
    const sel = resolveTasks({ tasks: o.tasks, planExistsAtRev: files.has(input.path), plan: full })
    if (sel.error) usage(sel.error)
    const chk = checkExisting({ plan: full, exists: (p) => files.has(p), tasks: sel.tasks, ci: ctx.ci })
    for (const n of chk.notes) io.out(`plan reference check: ${n}\n`)
    const refFindings = chk.problems.map((text, i) => ({ id: `ref-${i + 1}`, severity: 'P1', summary: text, file: input.path }))
    io.out(`plan reference check: ${sel.tasks.length} task(s) from ${rev.slice(0, 12)}, ${chk.considered.length} target(s), ${refFindings.length} problem(s)\n`)
    for (const f of refFindings) io.err(`plan reference check: ${f.summary}\n`)
    planRef = { rev, tasks: sel.tasks, findings: refFindings }
  }

  // A fresh chain while a head of this slot (and path) that this branch added still carries an open blocking
  // finding would let that finding go unassessed (§5.3: a re-review inherits every undisposed finding). That holds
  // whatever the head's outcome: a failed re-review carries its inherited findings forward undisposed. A head with
  // no open finding (a fresh run that never completed) does not block, so the reviewer fallback still works.
  // On a conformance head every deviation (each finding not fixed, P3 or justified included) is open in this sense:
  // records.mjs inherit reopens them all, and a fresh chain would drop them unreassessed (§5.4).
  if (o.supersedes === undefined) {
    const added = await addedStemsFor(root, await defaultBase(root, o.base), head)
    const openIds = (r) => (r.slot === 'conformance' ? deviationIds(r.findings) : undisposedBlocking(r).map((f) => f.id))
    const open = chainHeads(records).filter((r) => !r.invalid && r.slot === o.slot
      && (!blob || r.input.path === input.path) && (added === null || added.has(r.stem)) && openIds(r).length > 0)
    if (open.length) {
      const how = o.slot === 'conformance' ? 'so its deviations are reassessed' : 'so the open finding is inherited, or dispose it'
      usage(`${open.map((r) => `record ${r.stem} left ${openIds(r).join(', ')} open`).join('; ')}: re-review with --supersedes ${open.length === 1 ? open[0].stem : '<stem>'} ${how}`)
    }
  }

  // reviewer
  let otherVendor
  if (o.slot === 'completeness') {
    const heads = chainHeads(records).filter((r) => !r.invalid && r.slot === 'correctness' && passingHead(records, r, { identity: input.identity }))
    heads.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    otherVendor = heads.length ? heads.at(-1).reviewer.vendor : undefined
    if (!otherVendor) usage(`completeness needs a passing correctness record for identity ${input.identity}: run correctness first`)
  }
  const reviewer = o.reviewer ?? pickReviewer({ authorVendor: o.author, slot: o.slot, otherVendor })
  const problem = independenceProblem({ authorVendor: o.author, slot: o.slot, reviewer, otherVendor })
  if (problem) usage(problem)
  if (o.model !== undefined && (reviewer !== 'claude' || !claude.MODELS.includes(o.model))) usage(`--model is only for the claude reviewer: ${claude.MODELS.join('|')}`)

  // supersedes: what to inherit and what to send
  let old = null, carried = [], toAssess = [], mode = 'full', delta = null, deltaLabel = ''
  if (o.supersedes !== undefined) {
    old = findRecord(records, o.supersedes)
    if (old.slot !== o.slot) usage(`record ${old.stem} is slot ${old.slot}, not ${o.slot}`)
    if (old.input.kind !== input.kind || (blob && old.input.path !== input.path)) usage(`record ${old.stem} covers ${old.input.kind} ${old.input.path ?? ''}, not this input`)
    if (old.authorVendor !== o.author) usage(`record ${old.stem} has authorVendor ${old.authorVendor}, not ${o.author}: a re-review keeps the author`)
    // The reference check and the conformance postconditions are recomputed on every run, so the old record's
    // findings from them are not inherited. Every other conformance deviation not fixed (justified, P3, or a legacy
    // pre-existing / reclassified-nit) arrives here reopened (records.mjs inherit), so it goes to toAssess.
    for (const f of inherit(old)) {
      if ((planRef && /#ref-\d+$/.test(f.id)) || f.source === 'postcondition') continue
      if (f.disposition !== undefined) carried.push(f)
      else toAssess.push(f)
    }
    // §5.3 scope: the delta between the two identities, or the two blobs for a spec or plan, and only after a
    // completed review; the full input too while an inherited blocking finding is open.
    if (blob && old.outcome === 'completed') {
      const exists = isObjectId(old.input.identity) && (await git(['cat-file', '-e', `${old.input.identity}^{blob}`], { cwd: root })).code === 0
      const d = exists ? await git([...DIFF_ARGS, old.input.identity, input.identity], { cwd: root }) : null
      if (d && d.code === 0) {
        delta = d.stdout.toString('utf8')
        deltaLabel = `Delta since superseded record ${old.stem} (blob ${old.input.identity} .. ${input.identity}, ${input.path})`
        mode = toAssess.length ? 'full+delta' : 'delta'
      } else {
        io.err(`cannot diff from blob ${old.input.identity} (${d ? d.stderr.trim() : 'not in this repository'}); sending the full document\n`)
      }
    } else if (!blob && old.outcome === 'completed' && typeof old.input.head === 'string' && old.input.mergeBase !== input.mergeBase) {
      // A merge from main (or a rebase) moved the merge base: old head .. head would carry main's changes into the
      // "delta", mixing them with the PR's own. Send the full input instead; it is never less than the delta.
      io.err(`the merge base moved since ${old.stem} (${old.input.mergeBase ?? 'none'} -> ${input.mergeBase}); sending the full input\n`)
    } else if (!blob && old.outcome === 'completed' && typeof old.input.head === 'string') {
      const d = await git([...DIFF_ARGS, old.input.head, head, '--', '.', `:(exclude)${EVIDENCE_DIR}`], { cwd: root })
      if (d.code === 0) {
        delta = d.stdout.toString('utf8')
        deltaLabel = `Delta since superseded record ${old.stem} (${old.input.head} .. ${head})`
        mode = toAssess.length ? 'full+delta' : 'delta'
      } else {
        io.err(`cannot diff from ${old.input.head} (${d.stderr.trim()}); sending the full input\n`)
      }
    }
  }
  if (mode === 'delta') full = null
  const inheritedIds = toAssess.map((f) => f.id)

  let context = []
  if (!blob && CONTEXT_SLOTS.includes(o.slot)) {
    const pc = await promiseContext({ root, mb: input.mergeBase, head, plan: conf?.plan })
    context = pc.parts
    for (const w of pc.warnings) io.err(`${w}\n`)
  }

  // The conformance postconditions: after every refusal above, before the reviewer.
  let checked = null
  if (conf) {
    checked = await conf.check({ root, mb: input.mergeBase, head })
    context = [...context, ...checked.context]
  }
  const preFindings = [...(planRef?.findings ?? []), ...(checked?.findings ?? [])]

  const promptFor = ctx.promptFor ?? defaultPromptFor
  const slotPrompt = promptFor(o.slot, { root })
  const prompt = buildPrompt({ slotPrompt, mode, full, fullLabel, delta, deltaLabel, inherited: toAssess, context })
  // Gemini's cap counts everything the reviewer must read: the diff(s) and the promise context.
  const diffBytes = Buffer.byteLength(full ?? '', 'utf8') + Buffer.byteLength(delta ?? '', 'utf8')
    + context.reduce((n, c) => n + Buffer.byteLength(c.text, 'utf8'), 0)

  const adapter = ADAPTERS[reviewer]
  const model = reviewer === 'claude' ? (o.model ?? 'opus') : reviewer === 'gemini' ? gemini.DEFAULT_MODEL : codex.MODEL
  io.out(`reviewing ${o.slot} (${mode}) with ${reviewer}/${model}\n`)
  const res = await adapter.run({
    prompt, timeoutMs: Math.round(timeoutMin * 60_000), cwd: root, env: ctx.env ?? process.env,
    spawnImpl: ctx.spawnImpl, resolveImpl: ctx.resolveImpl, fetchImpl: ctx.fetchImpl, diffBytes, model,
  })
  const c = classifyOutcome({ ...res, inheritedIds })

  const { path, stem } = writeWithStem(root, o.slot, input.identity, (newStem) => {
    let findings
    if (c.outcome === 'completed') {
      const status = new Map(c.inherited.map((e) => [e.id, e.status]))
      const assessed = toAssess.map((f) => (status.get(f.id) === 'resolved' ? { ...f, disposition: { kind: 'fixed', by: newStem } } : f))
      // Conformance deviation IDs: the postconditions' D1..Dn first, then the reviewer's findings in its order.
      // Plan slot: `ref-N` belongs to the reference check (and is dropped on a re-review as recomputed), so a
      // reviewer finding with such an ID takes the first free F<n> instead.
      const fresh = conf ? c.findings.map((f, i) => ({ ...f, id: `D${preFindings.length + i + 1}` })) : planRef ? awayFromRef(c.findings) : c.findings
      findings = [...preFindings, ...fresh, ...assessed, ...carried]
    } else {
      findings = [...preFindings, ...toAssess, ...carried] // nobody reviewed: carry everything forward undisposed
    }
    return {
      schema: 1, type: recordType(o.slot), slot: o.slot, input,
      reviewer: { vendor: ADAPTER_VENDOR[reviewer], model }, authorVendor: o.author,
      outcome: c.outcome, verdict: c.verdict, findings, supersedes: old ? old.stem : null,
      ...(planRef ? { rev: planRef.rev, tasks: planRef.tasks } : {}),
      ...(conf ? { conformance: { tasks: [...conf.plan.tasks], deviations: deviationIds(findings), commands: checked.commands } } : {}),
      createdAt: (ctx.now ?? (() => new Date()))().toISOString(),
    }
  })
  if (c.outcome !== 'completed' && res.stderr) io.err(`${res.stderr.trim()}\n`)
  io.out(`outcome: ${c.outcome}${c.outcome === 'completed' ? ` (verdict ${c.verdict}, ${c.findings.length} new finding(s))` : ''}\nrecord: ${path} (${stem})\n`)
  return c.outcome === 'completed' ? 0 : 1
}

// A disposition never edits a record in place (records are evidence): it writes a new record that copies the old
// one, sets the disposition and supersedes it. `fixed` is refused: only a chained re-review can set it (§5.6).
const cmdDispose = async (argv, ctx) => {
  const { values: o } = parseArgs({ args: argv, options: DISPOSE_OPTIONS, strict: true, allowPositionals: false })
  if (o.kind === 'fixed') usage('dispose cannot set fixed: only a re-review (run --supersedes) can')
  if (!DISPOSE_KINDS.includes(o.kind)) usage(`--kind must be one of ${DISPOSE_KINDS.join('|')}`)
  if (!nonEmpty(o.record) || !nonEmpty(o.finding)) usage('dispose needs --record and --finding')
  if (!nonEmpty(o.reason)) usage('dispose needs --reason')
  if (o.kind === 'pre-existing' && !nonEmpty(o.issue)) usage('a pre-existing disposition needs --issue <url>')
  const root = must(await git(['rev-parse', '--show-toplevel'], { cwd: ctx.cwd }), 'git rev-parse --show-toplevel').trim()
  const old = findRecord(readRecords({ cwd: root }), o.record)
  const f = old.findings.find((x) => x.id === o.finding)
  if (!f) usage(`record ${old.stem} has no finding ${o.finding}`)
  if (f.disposition && f.disposition.kind === 'fixed') usage(`finding ${o.finding} is already fixed`)
  if (o.kind === 'justified-deviation' && old.type !== 'conformance') usage('justified-deviation applies only to a conformance record')
  // §5.4: a conformance deviation is either fixed (a re-review marks it) or justified in the Deviations field.
  if (old.type === 'conformance' && o.kind !== 'justified-deviation') usage(`a conformance deviation is not ${o.kind} (spec §5.4): fix it and re-review with --supersedes, or justify it in the PR's Deviations field and dispose it --kind justified-deviation`)
  const disposition = { kind: o.kind, reason: o.reason, ...(nonEmpty(o.issue) ? { issue: o.issue } : {}) }
  const { stem: _s, invalid: _i, ...body } = old // eslint-disable-line no-unused-vars
  const record = {
    ...body,
    findings: old.findings.map((x) => (x.id === o.finding ? { ...x, disposition } : x)),
    supersedes: old.stem,
    createdAt: (ctx.now ?? (() => new Date()))().toISOString(),
  }
  const path = writeRecord({ cwd: root, record })
  ctx.io.out(`disposed ${o.finding} as ${o.kind}\nrecord: ${path}\n`)
  return 0
}

export const runCli = async (argv, opts = {}) => {
  const io = opts.io ?? { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }
  const ctx = { ...opts, io, cwd: opts.cwd ?? process.cwd() }
  const [cmd, ...rest] = argv
  try {
    if (cmd === 'run') return await cmdRun(rest, ctx)
    if (cmd === 'dispose') return await cmdDispose(rest, ctx)
    usage(cmd === undefined ? 'missing subcommand' : `unknown subcommand ${cmd}`)
  } catch (e) {
    if (e instanceof UsageError || (e && typeof e.code === 'string' && e.code.startsWith('ERR_PARSE_ARGS'))) io.err(`${e.message}\n${USAGE}\n`)
    else io.err(`review: ${e && e.message}\n`)
    return 1
  }
}
