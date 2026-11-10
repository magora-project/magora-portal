// review-gate (spec docs/superpowers/specs/2026-10-29-shared-dev-process-design.md §5.5, §5.6; plan Task 23;
// .claude/rules/process.md § What blocks, § Evidence). Judges the PR-stage bot review: every required slot is covered
// or substituted, and every finding that blocks by default has an acceptable disposition in the committed PR review
// record `.review/pr/<n>.json`. The job's own exit status is the check; nothing posts a status (§2.1).
//
// What it reads, all live from the API when the job runs (never the event payload): the PR (labels, head, base,
// draft, creation time), reviews and their commit_ids, issue comments (Codex's state marker and its edit history,
// Gemini's verdict markers, CodeRabbit's outside-diff findings, full-review requests), review threads, CodeRabbit's
// check run on the head and on every commit a CodeRabbit review is on, and the PR's workflow runs. From the PR-head
// checkout: the PR review record and the substitute records under .review/records/ that this PR adds. Every read error
// fails the job "could not judge" (fail closed).
//
// The PR review record (schema 1):
//   { schema: 1, pr, slots: [{ bot, status: 'covered' | 'substituted', by }], findings: [{ id, source, severity,
//     disposition }], reclassified: [{ id, reason }], writtenAt }
// A finding's disposition is null (undisposed), { kind: 'pre-existing', reason, issue }, or { kind: 'fixed', commit,
// by? }: `commit` is the fix commit's full SHA; `by` names the substitute record that verified the fix (rule (b)).
// `slots` is the author's statement of what the gate relied on (§5.5: each required slot, and the review ID it relies on).
// The gate judges the slots live, and checks only that each required slot is listed with a non-empty `by`: for
// `coderabbit|codex`, at least one of the two. It never matches `by` against live evidence.
//
// Fixed findings (§5.6). The fix commit must be an ancestor of the head, and then either
//   (a) it strictly descends from every commit the finding was reported on, its input identity differs from each,
//       and the finding's bot has usable evidence on the fix commit or a descendant of it with the current identity
//       (CodeRabbit: a non-empty review; Codex: a non-empty review or its completed state marker, V2; Gemini: a usable
//       verdict on the current identity), and a thread is resolved; or
//   (b) `by` names a record in an accepted (substituteOk) `substitute:<bot>` chain whose head holds the finding's gate
//       ID with a `fixed` disposition.
// Every ordering is by ancestry, never by dates. A reported commit that is unknown (a cr: finding read from an issue
// comment) or cannot be fetched fails (a), so only (b) remains. A bot that re-reports a defect raises a new finding
// (a new thread or Gemini index), which needs its own disposition: the clean re-review of D-7.
//
// Grandfathering: a PR created before the `review-gate` time in .github/review-activation.json, read from the BASE
// branch through the API, is exempt. A missing file or key exempts nothing; the `review-evidence` key never applies.
//
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo PR_NUMBER=n node scripts/ci/review-gate.mjs
// Locally: npm run review -- check --pr <n> (scripts/review/pr-record.mjs).
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOTS, BOT_VENDOR, GEMINI_DIFF_LIMIT, REQUIRED_BOTS, coderabbitFailedOn, diffTooLarge, makeHave, makeIdentityOf, makeIsAncestor, requiredMet,
  slotState, substituteOk, substitutionClockStart,
} from '../review/coverage.mjs'
import {
  GEMINI_LOGIN, codexHistory, codexState, coderabbitCheck, fullReviewRequests, geminiDispatchRuns, geminiVerdicts,
  listIssueComments, listReviews, listThreads, outsideDiffFindings, prRuns,
} from '../review/github.mjs'
import { CODERABBIT_LOGIN, CODEX_LOGIN, severityOf } from '../review/severity.mjs'
import { EVIDENCE_DIR, git, inputIdentity, mergeBase } from '../review/identity.mjs'
import { addedRecordStems, chainHeads, readRecords } from '../review/records.mjs'
import { defaultGit, isGrandfathered, readActivation, recordResultReasons, requiredDepth } from './review-evidence.mjs'
import { DEPTH_LABELS, parseControlFiles } from './label-gate.mjs'

export const GATE_ACTIVATION_KEY = 'review-gate'
export const PR_RECORD_DIR = `${EVIDENCE_DIR}/pr`
export const prRecordPath = (n) => `${PR_RECORD_DIR}/${n}.json`
export const PR_RECORD_COMMAND = (n) => `npm run review -- pr-record --pr ${n}`

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
// The three bot logins (REST form; listThreads gives GraphQL Bot authors the same suffix).
const BOT_OF_LOGIN = new Map([[CODERABBIT_LOGIN, 'coderabbit'], [CODEX_LOGIN, 'codex'], [GEMINI_LOGIN, 'gemini']])
// Bot-resolved threads (§5.5: "CodeRabbit's 'addressed in <sha>'") pass without a disposition only when the bot itself
// wrote that it was addressed in a commit, and that commit verifiably follows the report (botResolution below).
// A bare resolution proves nothing: `@coderabbitai resolve`, which anyone on the PR can post, resolves every CodeRabbit
// thread as the bot. Only CodeRabbit: Codex resolved no thread on the PRs read (#44, #46, #52, #54, #69, #87, #88,
// 2026-11-10), so its format is unknown and its resolutions are not accepted; nor is github-actions[bot]'s, which any
// workflow holding the job token can make, a PR's own copy included.
// GraphQL `resolvedBy` is typed `User` and returns the login WITH the `[bot]` suffix (`coderabbitai[bot]`, measured on
// PR #52, 15 threads, 2026-11-10), unlike comment authors (typed `Bot`, returned without it and suffixed by listThreads).
export const BOT_RESOLVERS = new Set([CODERABBIT_LOGIN])
// CodeRabbit appends a status to its own first comment (an edit by the coderabbitai Bot) when it sees a later push
// address the finding. Measured live 2026-11-10 on all 41 CodeRabbit threads of PRs #44, #46, #52, #54, #69, #87: the
// finding ends with its `<!-- cr-comment:v1:<hex> -->` marker; after the last one there may be a `_Source: Path
// instructions_` line, then the appended status begins at `<!-- This is an auto-generated reply by CodeRabbit -->`
// (or `... comment by CodeRabbit -->`; both seen). With HTML comments removed, the status is one line: "✅ Addressed in
// commit 672a4b4" or "✅ Addressed in commits 4930cb3 to fc4c90c" (7-hex short SHAs, no link). Also seen, and never
// accepted: "✅ Confirmed as addressed by @<user>" (a person said so) and "✅ Addressed in the latest update" (no commit).
const ADDRESSED = /^✅ Addressed in commits? ([0-9a-f]{7,40})(?: to ([0-9a-f]{7,40}))?$/
const CR_FINDING_END = /<!-- cr-comment:v1:[0-9a-f]+ -->/g
const CR_STATUS_START = /<!-- This is an auto-generated (?:reply|comment) by CodeRabbit -->/
const CR_BLOCKING = new Set(['Critical', 'Major'])

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== ''
const short = (s) => (typeof s === 'string' ? s.slice(0, 12) : String(s))
const safe = async (fn, fallback) => { try { return await fn() } catch { return fallback } }
// §5.5: a finding located only in the evidence directory is outside the gate, whichever bot raised it.
const inEvidence = (path) => typeof path === 'string' && path.startsWith(`${EVIDENCE_DIR}/`)
// The first line of prose in a comment body, for the author and the substitute's prompt. Never judged.
const summaryOf = (body) => {
  const line = String(body ?? '').split('\n').map((l) => l.replace(/<[^>]*>|!\[[^\]]*\]\([^)]*\)|[*_`#>]/g, '').trim()).find((l) => l !== '')
  return (line ?? '').slice(0, 200)
}
// The finding's full text, for the substitute's prompt (a summary line cannot show the defect). Never judged.
export const DETAIL_MAX = 8000
const detailOf = (text) => {
  const t = String(text ?? '').trim()
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}\n[truncated at ${DETAIL_MAX} characters]` : t
}

// ---------------------------------------------------------------- blocking findings

// The commits CodeRabbit's appended status says addressed the thread: [] or [[sha]] or [[from, to]]. Read only from the
// thread's FIRST comment, authored by CodeRabbit and last edited by CodeRabbit (or never edited: no editor and no edit
// time); never from a reply (CodeRabbit's chat replies share its login and say what they are asked to), and never from
// the finding's own text (a quoted line or code block): only the status after the last finding marker, which must be
// exactly one line.
const addressedClaims = (t) => {
  const c = t.comments?.[0]
  if (!c || c.login !== CODERABBIT_LOGIN) return []
  if (!(c.editor === CODERABBIT_LOGIN || (c.editor === null && c.lastEditedAt === null))) return []
  const body = String(c.body ?? '')
  const ends = [...body.matchAll(CR_FINDING_END)]
  if (ends.length === 0) return []
  const after = body.slice(ends.at(-1).index + ends.at(-1)[0].length)
  const start = CR_STATUS_START.exec(after)
  if (!start) return []
  const lines = after.slice(start.index + start[0].length).replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const m = lines.length === 1 ? ADDRESSED.exec(lines[0]) : null
  return m ? [m.slice(1, 3).filter(Boolean)] : []
}

// Every finding that blocks by default on the PR (§5.6): [{ id, source, severity, raisedAt, kind, reported, resolved,
// path, summary, detail }]. `detail` is the finding's full text (a substitute reviewer must see the defect). `source` is the bot ('coderabbit' | 'codex' | 'gemini'); `reported` lists the commit(s) it was
// reported on (null when unknown). Throws when CodeRabbit's outside-diff section cannot be parsed (could not judge).
export function blockingFindings(state) {
  const out = []
  // Threads opened by one of the three bot logins. A thread a person opens stays with branch protection's
  // conversation resolution; a bot-resolved thread passes as it is.
  for (const t of state.threads ?? []) {
    const c = t.firstComment
    const bot = BOT_OF_LOGIN.get(c?.login)
    if (!bot) continue
    if (inEvidence(t.path)) continue
    const sev = severityOf({ login: c.login, body: c.body })
    if (!sev.blocking) continue
    const botResolved = t.isResolved === true && BOT_RESOLVERS.has(t.resolvedBy)
    out.push({
      id: `thread:${t.id}`, source: bot, severity: sev.label ?? 'unlabelled', raisedAt: null, kind: 'thread', reported: [c.originalCommit ?? null],
      resolved: t.isResolved === true, path: t.path ?? null, summary: summaryOf(c.body), detail: detailOf(c.body),
      ...(botResolved ? { botResolved: true, resolvedBy: t.resolvedBy, addressed: addressedClaims(t) } : {}),
    })
  }
  // CodeRabbit's outside-diff findings, from review bodies (reported on the review's commit) and issue comments
  // (commit unknown). One marker seen in several places keeps every commit it was reported on.
  const cr = new Map()
  const addCr = (f, at) => {
    if (inEvidence(f.path)) return
    if (!(f.severity === null || CR_BLOCKING.has(f.severity))) return
    const seen = cr.get(f.id)
    if (seen) { seen.reported.push(f.reportedCommit); return }
    cr.set(f.id, { id: f.id, source: 'coderabbit', severity: f.severity ?? 'unlabelled', raisedAt: at ?? null, kind: 'cr', reported: [f.reportedCommit], resolved: false, path: f.path, summary: `CodeRabbit outside-diff finding (${f.severity ?? 'no label'})${f.path ? ` in ${f.path}` : ''}`, detail: detailOf(f.text) })
  }
  for (const r of state.reviews ?? []) for (const f of outsideDiffFindings({ reviews: [r], comments: [] })) addCr(f, r.submittedAt)
  for (const c of state.comments ?? []) for (const f of outsideDiffFindings({ reviews: [], comments: [c] })) addCr(f, c.createdAt)
  out.push(...cr.values())
  // Every finding in every Gemini verdict on the PR, across identities (V5): none is dropped.
  const bodyOf = new Map((state.comments ?? []).map((c) => [c.id, c.body]))
  for (const v of state.geminiVerdicts ?? []) {
    for (const f of v.findings ?? []) {
      const body = bodyOf.get(v.commentId) ?? ''
      const line = new RegExp(`^${f.index}\\. (.*)$`, 'm').exec(body)?.[1]
      // The numbered item through the line before the next numbered item, the marker, or the end of the comment.
      const item = new RegExp(`^${f.index}\\. [\\s\\S]*?(?=^\\d+\\. |^<!-- gemini-review:v1 |(?![\\s\\S]))`, 'm').exec(body)?.[0]
      out.push({ id: `gemini:${v.commentId}:${f.index}`, source: 'gemini', severity: f.severity, raisedAt: v.at ?? null, kind: 'gemini', reported: [v.head ?? null], resolved: false, path: null, summary: line ? summaryOf(line) : `Gemini finding ${f.index} (${f.severity}) in comment ${v.commentId}`, detail: detailOf(item) })
    }
  }
  return out
}

// ---------------------------------------------------------------- slots

const SUBSTITUTE = (bot) => `substitute:${bot}`
const substituteRecords = (state) => (state.records ?? []).filter((r) => typeof r.slot === 'string' && r.slot.startsWith('substitute:'))

// Each bot's live slot state (Task 22), and whether an accepted substitute fills it. A substitute fills a slot only
// when the slot needs one (§5.5 "When it applies"): never while the bot's review is still pending, so no substitute
// turns the gate green ahead of a verdict about to arrive (gate point 2). Returns { slots: { <bot>: { status, by?,
// reason } }, accepted: { <bot>: boolean }, counted: { <bot>: string[] } }.
export async function judgeSlots(state) {
  // The clock starts when the current input identity arrived, not the current head (final review I-1): an
  // identity-preserving commit, such as the one adding a substitute record and this PR review record, does not restart it.
  const pushedAt = await substitutionClockStart({
    runs: state.runs, pr: state.pr.number, head: state.pr.head, headRepo: state.pr.headRepo, prCreatedAt: state.pr.createdAt,
    identityOf: state.identityOf, currentIdentity: state.currentIdentity,
  })
  const live = {}
  for (const bot of BOTS) {
    live[bot] = await slotState({ bot, state, identityOf: state.identityOf, isAncestor: state.isAncestor, currentIdentity: state.currentIdentity, now: state.now, headPushedAt: pushedAt })
  }
  const subs = substituteRecords(state)
  const heads = chainHeads(subs)
  // A substitute counts toward the PR only when it can fill its slot: a completed review of the current identity
  // (review-evidence's own record check), for a bot whose slot needs a substitute. A stale record, or one for a slot
  // the bot covered or is still pending on, counts no vendor (pre-publish Codex review, 2026-11-10).
  const want = { kind: 'pr', identity: state.currentIdentity }
  const headVendors = (bot) => (live[bot].status !== 'needs-substitute' ? [] : heads
    .filter((r) => r.slot === SUBSTITUTE(bot) && r.input?.kind === 'pr' && typeof r.reviewer?.vendor === 'string' && recordResultReasons(r, want).length === 0)
    .map((r) => r.reviewer.vendor))
  // §5.5: a substitute's vendor is not one already counted on the PR: the vendors of the bots that covered it, and of
  // the other bots' substitutes.
  const counted = {}, accepted = {}
  for (const bot of BOTS) {
    counted[bot] = [...new Set(BOTS.filter((b) => b !== bot).flatMap((b) => (live[b].status === 'covered' ? [BOT_VENDOR[b]].filter(Boolean) : headVendors(b))))]
    accepted[bot] = substituteOk({ bot, records: subs, currentIdentity: state.currentIdentity, countedVendors: counted[bot] })
  }
  const slots = {}
  for (const bot of BOTS) {
    const s = live[bot]
    if (s.status === 'covered') slots[bot] = { status: 'covered', by: s.by, reason: s.reason }
    else if (s.status === 'needs-substitute' && accepted[bot]) {
      slots[bot] = { status: 'substituted', by: heads.filter((r) => r.slot === SUBSTITUTE(bot)).map((r) => r.stem).join(','), reason: s.reason }
    } else if (s.status === 'needs-substitute') {
      slots[bot] = { status: 'needs-substitute', reason: `${s.reason}; no accepted ${SUBSTITUTE(bot)} record (a completed review of the current identity, every finding disposed, by a vendor not in [${counted[bot].join(', ')}])` }
    } else slots[bot] = { status: s.status, reason: s.reason }
  }
  return { slots, accepted, counted }
}

// ---------------------------------------------------------------- the PR review record

// Shape problems of a parsed PR review record for PR `pr` (empty when it is well formed). Dispositions are judged
// by evaluateGate, not here.
export function validatePrRecord(rec, pr) {
  if (!isObj(rec)) return ['the PR review record must be a JSON object']
  const p = []
  if (rec.schema !== 1) p.push('schema: must be 1')
  if (rec.pr !== pr) p.push(`pr: is ${JSON.stringify(rec.pr)}, not this PR (${pr})`)
  if (!Array.isArray(rec.slots)) p.push('slots: must be an array')
  else rec.slots.forEach((s, i) => {
    if (!isObj(s) || !BOTS.includes(s.bot) || !['covered', 'substituted'].includes(s.status) || !nonEmpty(s.by)) p.push(`slots[${i}]: must be { bot: ${BOTS.join('|')}, status: covered|substituted, by: string }`)
  })
  if (!Array.isArray(rec.findings)) p.push('findings: must be an array')
  else {
    const ids = new Set()
    rec.findings.forEach((f, i) => {
      if (!isObj(f) || !nonEmpty(f.id)) { p.push(`findings[${i}]: must be an object with a non-empty id`); return }
      if (ids.has(f.id)) p.push(`findings[${i}]: ${f.id} is listed twice`)
      ids.add(f.id)
      if (f.disposition !== null && f.disposition !== undefined && !isObj(f.disposition)) p.push(`findings[${i}].disposition: must be an object or null`)
    })
  }
  if (!Array.isArray(rec.reclassified)) p.push('reclassified: must be an array')
  else rec.reclassified.forEach((r, i) => { if (!isObj(r) || !nonEmpty(r.id)) p.push(`reclassified[${i}]: must be { id, reason }`) })
  if (typeof rec.writtenAt !== 'string') p.push('writtenAt: must be a string')
  return p
}

// The PR review record in a checkout: { record } (null when there is none) or { record: null, problems }.
export function readPrRecord({ cwd, pr }) {
  const file = join(cwd, prRecordPath(pr))
  if (!existsSync(file)) return { record: null, problems: [] }
  let rec
  try { rec = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { record: null, problems: [`${prRecordPath(pr)} is not JSON: ${e.message}`] } }
  const problems = validatePrRecord(rec, pr)
  return problems.length ? { record: null, problems: problems.map((x) => `${prRecordPath(pr)}: ${x}`) } : { record: rec, problems: [] }
}

// ---------------------------------------------------------------- dispositions

// The bot's usable evidence: [{ sha, identity? }] (identity known only for Gemini, whose marker carries it). A CodeRabbit
// review is usable only when its OWN commit's CodeRabbit check is known and not a terminal failure: a failed or unknown
// check (no entry in state.coderabbitChecks) makes it unusable (coverage.mjs coderabbitFailedOn, the same rule slotState
// applies).
function botEvidence(bot, state) {
  const reviewsBy = (login) => (state.reviews ?? []).filter((r) => r.login === login && r.empty !== true && typeof r.commitId === 'string').map((r) => ({ sha: r.commitId }))
  if (bot === 'coderabbit') return reviewsBy(CODERABBIT_LOGIN).filter((e) => !coderabbitFailedOn(state, e.sha))
  if (bot === 'codex') {
    // The marker's current body counts only when the Codex bot made its last edit (codexHistory.currentTrusted).
    const cs = state.codexHistory?.currentTrusted === true ? state.codexState : null
    return [...reviewsBy(CODEX_LOGIN), ...(cs && cs.status === 'completed' && typeof cs.commitSha === 'string' ? [{ sha: cs.commitSha }] : [])]
  }
  if (bot === 'gemini') {
    return (state.geminiVerdicts ?? []).filter((v) => (v.verdict === 'findings' || v.verdict === 'no-findings') && nonEmpty(v.identity)).map((v) => ({ sha: v.head, identity: v.identity }))
  }
  return []
}

// Rule (a): null when it verifies `fix`, else the reason it does not.
async function ruleA(f, fix, state) {
  const anc = (a, b) => (typeof a === 'string' && typeof b === 'string' ? safe(() => state.isAncestor(a, b), false) : Promise.resolve(false))
  const idOf = (s) => safe(() => state.identityOf(s), null)
  if (!Array.isArray(f.reported) || f.reported.length === 0) return 'the commit it was reported on is unknown: only an accepted substitute can verify it (name its record in disposition.by)'
  for (const r of f.reported) {
    if (typeof r !== 'string' || !SHA.test(r)) return 'the commit it was reported on is unknown: only an accepted substitute can verify it (name its record in disposition.by)'
    if (r === fix || !(await anc(r, fix))) {
      return `fix commit ${short(fix)} is not a strict descendant of ${short(r)}, the commit it was reported on (or that commit cannot be fetched): naming that commit, an earlier one, or an amend or rebase of it does not count; fix in a new commit, or have an accepted substitute verify it`
    }
    const [ir, ifx] = [await idOf(r), await idOf(fix)]
    if (!ir || !ifx) return `cannot compute the input identity of ${short(ir ? fix : r)}`
    if (ir === ifx) return `fix commit ${short(fix)} leaves the input identity of ${short(r)}, the commit it was reported on, unchanged`
  }
  if (f.kind === 'thread' && !f.resolved) return 'fixed, but the thread is not resolved'
  for (const e of botEvidence(f.source, state)) {
    if (!(await anc(fix, e.sha))) continue
    if ((e.identity ?? await idOf(e.sha)) === state.currentIdentity) return null
  }
  return `no usable ${f.source} review on ${short(fix)} or a later commit with the current input identity (the review that raised a finding cannot verify its own fix)`
}

// Rule (b): null when `by` names a record in an accepted substitute:<bot> chain whose head holds the finding fixed.
function ruleB(f, by, state, accepted, counted) {
  const slot = SUBSTITUTE(f.source)
  if (!BOTS.includes(f.source)) return `no substitute slot for source ${f.source}`
  const subs = substituteRecords(state).filter((r) => r.slot === slot)
  const byStem = new Map(subs.map((r) => [r.stem, r]))
  if (!byStem.has(by)) return `${by} is not a ${slot} record this PR adds`
  const chainOf = (h) => { const c = []; for (let r = h; r && !c.includes(r); r = byStem.get(r.supersedes)) c.push(r); return c }
  const head = chainHeads(subs).find((h) => chainOf(h).some((r) => r.stem === by))
  if (!head) return `${by} is in no ${slot} chain`
  if (!accepted[f.source] || !substituteOk({ bot: f.source, records: chainOf(head), currentIdentity: state.currentIdentity, countedVendors: counted[f.source] })) {
    return `the ${slot} chain of ${by} is not accepted (it must be a completed review of the current identity with every finding disposed, by a vendor not already counted, and no other ${slot} head may leave a finding open)`
  }
  const g = head.findings.find((x) => x.id === f.id)
  if (!g || g.disposition?.kind !== 'fixed') return `${head.stem}, the head of that ${slot} chain, does not hold ${f.id} as fixed`
  return null
}

// A bot-resolved thread's resolution: null when the thread is not bot-resolved; { ok, how } when the bot's own "addressed
// in" commit (every SHA it names) resolves to exactly one commit, strictly descends from the commit the thread was
// reported on, and is in the head's history; else { ok: false, why }. Ordering by ancestry only.
async function botResolution(f, state) {
  if (!f.botResolved) return null
  const no = (m) => ({ ok: false, why: `resolved by ${f.resolvedBy}, but that resolution is not accepted: ${m}` })
  if (!f.addressed?.length) return no(`no "✅ Addressed in commit <sha>" status appended by ${f.resolvedBy} to its own first comment (a resolve command, a chat reply, "Confirmed as addressed by @<user>", a line in the finding's text, or an edit by anyone else does not count)`)
  const reported = f.reported[0]
  if (typeof reported !== 'string' || !SHA.test(reported)) return no('the commit the thread was reported on is unknown')
  const anc = (a, b) => safe(() => state.isAncestor(a, b), false)
  let last = null
  for (const claim of f.addressed) {
    last = null
    for (const sha of claim) {
      const full = await safe(() => state.resolveCommit(sha), null)
      if (typeof full !== 'string' || !SHA.test(full)) { last = `${sha} does not resolve to exactly one commit (unknown, unfetched or ambiguous)`; break }
      if (full === reported || !(await anc(reported, full))) { last = `${sha} is not a strict descendant of ${short(reported)}, the commit the thread was reported on`; break }
      if (!(await anc(full, state.pr.head))) { last = `${sha} is not in the head's history`; break }
    }
    if (last === null) return { ok: true, how: `resolved by ${f.resolvedBy}, addressed in ${claim.join(' to ')}` }
  }
  return no(last)
}

// The findings the gate judges: blockingFindings minus every thread whose bot resolution is accepted (spec §5.5:
// "Bot-resolved threads pass as they are"). Such a thread is no blocking finding: it needs no record entry and does not
// by itself require a record. -> { blocking, botResolved: [{ finding, how }] }
export async function gateFindings(state) {
  const blocking = [], botResolved = []
  for (const f of blockingFindings(state)) {
    const b = await botResolution(f, state)
    if (b?.ok) botResolved[botResolved.length] = { finding: f, how: b.how }
    else blocking[blocking.length] = f
  }
  return { blocking, botResolved }
}

// Whether the bot's resolution, or a pre-existing / reclassified / fixed-by-(a) disposition, makes the finding
// acceptable, without rule (b): { ok, how } or { ok: false, why, fixed }. `fixed` is true for a `fixed` disposition (so
// (b) may still apply). When a bot resolution is refused, its reason leads the failure.
async function judgeOwn(f, rec, state) {
  const bot = await botResolution(f, state)
  if (bot?.ok) return bot
  const own = await judgeDisposition(f, rec, state)
  return bot && !own.ok ? { ...own, why: `${bot.why}; ${own.why}` } : own
}

async function judgeDisposition(f, rec, state) {
  const recl = (rec?.reclassified ?? []).find((x) => x.id === f.id)
  if (recl) return nonEmpty(recl.reason) ? { ok: true, how: `reclassified to nit: ${recl.reason}` } : { ok: false, why: 'reclassified to nit without a reason (D-14 needs a one-line reason)' }
  const entry = (rec?.findings ?? []).find((x) => x.id === f.id)
  if (!entry) return { ok: false, why: `not in the PR review record: run ${PR_RECORD_COMMAND(state.pr.number)}, dispose it, commit` }
  const d = entry.disposition
  if (!isObj(d)) return { ok: false, why: 'no disposition in the PR review record' }
  if (d.kind === 'pre-existing') return nonEmpty(d.reason) && nonEmpty(d.issue) ? { ok: true, how: `pre-existing (${d.issue})` } : { ok: false, why: 'pre-existing needs a reason and the issue that tracks it' }
  if (d.kind !== 'fixed') return { ok: false, why: `disposition ${JSON.stringify(d.kind)} is not fixed or pre-existing (reclassify through "reclassified", with a reason)` }
  if (typeof d.commit !== 'string' || !SHA.test(d.commit)) return { ok: false, why: 'fixed needs the fix commit\'s full SHA in disposition.commit', fixed: false }
  if (!(await safe(() => state.isAncestor(d.commit, state.pr.head), false))) return { ok: false, why: `fix commit ${short(d.commit)} is not in the head's history`, fixed: false }
  const a = await ruleA(f, d.commit, state)
  return a === null ? { ok: true, how: `fixed in ${short(d.commit)}, verified by a later ${f.source} review` } : { ok: false, why: a, fixed: true, by: d.by }
}

// Whether the PR review record already settles the finding without a substitute (pr-record.mjs uses this to pick the
// findings a substitute run carries: open, or fixed without verifying evidence).
export async function settledWithoutSubstitute(f, rec, state) {
  return (await judgeOwn(f, rec, state)).ok
}

// ---------------------------------------------------------------- the gate

// state: the live aggregate (readGateState, or a test fixture): Task 22's slotState fields plus threads, comments,
// records (the substitute records this PR adds), currentIdentity, identityOf, isAncestor, resolveCommit, now and tooLarge.
export async function evaluateGate({ state, record, depth }) {
  if (!Object.hasOwn(REQUIRED_BOTS, depth)) return { ok: false, lines: [`FAIL depth: ${JSON.stringify(depth)} is not one of ${Object.keys(REQUIRED_BOTS).join(', ')}`] }
  if (state.tooLarge === true) return { ok: false, lines: [`FAIL diff: over Gemini's ${GEMINI_DIFF_LIMIT}-byte limit: split this PR (no substitute clears this, spec §5.5)`] }
  if (state.tooLarge !== false) return { ok: false, lines: ['FAIL could not judge: the diff size is unknown'] }
  let blocking, botResolved
  try { ({ blocking, botResolved } = await gateFindings(state)) } catch (e) { return { ok: false, lines: [`FAIL could not judge: ${e.message}`] } }
  const n = state.pr.number
  const lines = botResolved.map((b) => `ok ${b.finding.id} (${b.finding.source} ${b.finding.severity}): no blocking finding: ${b.how}`)
  let ok = true
  const failLine = (l) => { ok = false; lines.push(`FAIL ${l}`) }

  if (record !== null && record !== undefined) {
    const problems = validatePrRecord(record, n)
    if (problems.length) return { ok: false, lines: problems.map((p) => `FAIL record ${prRecordPath(n)}: ${p}`) }
  }
  const required = REQUIRED_BOTS[depth]
  if (required.length === 0 && blocking.length === 0) {
    lines.push(`ok: ${depth} needs no slot and the PR has no finding that blocks by default: no PR review record needed`)
    return { ok, lines }
  }
  if (record === null || record === undefined) {
    failLine(`record: no PR review record at ${prRecordPath(n)} (${depth} needs ${required.length ? required.join(', ') : 'no slot'}; ${blocking.length} finding(s) block by default): run ${PR_RECORD_COMMAND(n)}, fill the dispositions, commit`)
  }

  // Slots.
  const { slots, accepted, counted } = await judgeSlots(state)
  const statuses = Object.fromEntries(BOTS.map((b) => [b, slots[b].status]))
  for (const req of required) {
    const bots = req.split('|')
    const met = bots.filter((b) => statuses[b] === 'covered' || statuses[b] === 'substituted')
    if (met.length) for (const b of met) lines.push(`ok slot ${b}: ${slots[b].status} (${slots[b].by})`)
    else failLine(`slot ${req}: ${bots.length > 1 ? 'one of them must be' : 'must be'} covered or substituted: ${bots.map((b) => `${b} ${slots[b].status}: ${slots[b].reason}`).join('; ')}`)
  }
  if (!requiredMet(depth, statuses)) ok = false
  // The record lists each required slot (§5.5 "What it lists"). Live coverage above stays the control; this checks only
  // that the record names a slot entry, with a non-empty `by`, for every required slot.
  if (record !== null && record !== undefined) {
    for (const req of required) {
      const bots = req.split('|')
      const listed = bots.filter((b) => record.slots.some((s) => isObj(s) && s.bot === b && nonEmpty(s.by)))
      if (listed.length === 0) failLine(`record slot ${req}: ${prRecordPath(n)} lists no entry with a non-empty \`by\` for ${bots.length > 1 ? `either of ${bots.join(', ')}` : req}: run ${PR_RECORD_COMMAND(n)}, commit`)
    }
  }

  // Findings.
  for (const f of blocking) {
    const tag = `${f.id} (${f.source} ${f.severity})`
    const own = await judgeOwn(f, record, state)
    if (own.ok) { lines.push(`ok ${tag}: ${own.how}`); continue }
    if (own.fixed && nonEmpty(own.by)) {
      const b = ruleB(f, own.by, state, accepted, counted)
      if (b === null) { lines.push(`ok ${tag}: fixed, verified by ${own.by} (${SUBSTITUTE(f.source)})`); continue }
      failLine(`${tag}: ${own.why}; and by ${own.by}: ${b}`)
      continue
    }
    failLine(`${tag}: ${own.why}`)
  }
  return { ok, lines }
}

// ---------------------------------------------------------------- live state

// resolveCommit(sha) -> Promise<string | null>: the full SHA of the one commit a 7-to-64-hex SHA names in this clone
// (fetch-depth: 0), or null when it names none or is ambiguous (git refuses an ambiguous short SHA). Cached. Anything
// but 7 to 64 lowercase hex never reaches git (`gitRun` exists for the test that proves it).
export function makeResolveCommit({ cwd, gitRun = git }) {
  const cache = new Map()
  return (sha) => {
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) return Promise.resolve(null)
    if (!cache.has(sha)) {
      cache.set(sha, (async () => {
        const r = await gitRun(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd })
        const out = r.stdout.toString().trim()
        return r.code === 0 && SHA.test(out) && out.startsWith(sha) ? out : null
      })().catch(() => null))
    }
    return cache.get(sha)
  }
}

// The PR's base commit, read from the API after the checkout: when main moved in between, the clone lacks it, so it is
// fetched once from origin (makeHave, as for reviewed commits). Throws when it cannot be had (could not judge).
export async function ensureBase({ cwd, base }) {
  if (!(await makeHave({ cwd })(base))) throw new Error(`the PR's base commit ${short(base)} is not in the checkout and could not be fetched from origin`)
}

// The gate's state aggregate, read live. pr: the API's pull-request object. Records come from the checkout at `cwd`:
// those `recordsHead` adds since its merge base with the base (the PR head in CI; with `untracked`, also records not
// committed yet, for a local check).
export async function readGateState({ repo, token, fetchImpl = fetch, pr, cwd, recordsHead, untracked = false, now = Date.now() }) {
  const n = pr.number, head = pr.head.sha, base = pr.base.sha
  await ensureBase({ cwd, base })
  const args = { repo, pr: n, token, fetchImpl }
  const [reviews, comments, threads, runs, dispatched, crCheck] = await Promise.all([
    listReviews(args), listIssueComments(args), listThreads(args), prRuns({ ...args, headRef: pr.head.ref }),
    geminiDispatchRuns(args), coderabbitCheck({ ...args, sha: head }),
  ])
  // Each CodeRabbit review is judged by its OWN commit's CodeRabbit check (coverage.mjs coderabbitChecks): read it for
  // every distinct commit carrying a non-empty CodeRabbit review, plus the head. A read error throws (could not judge).
  // A commitId that is not a SHA is not read: it has no entry, so its review is not usable (fail closed).
  const crShas = [...new Set([head, ...reviews.filter((r) => r.login === CODERABBIT_LOGIN && r.empty !== true && typeof r.commitId === 'string' && SHA.test(r.commitId)).map((r) => r.commitId)])]
  const coderabbitChecks = {}
  for (const sha of crShas) coderabbitChecks[sha] = sha === head ? crCheck : await coderabbitCheck({ ...args, sha })
  const cs = codexState(comments)
  const history = cs ? await codexHistory({ ...args, commentId: cs.commentId }) : null
  const currentIdentity = await inputIdentity({ cwd, base, head })
  const rh = recordsHead ?? head
  const added = await addedRecordStems({ cwd, mergeBase: await mergeBase({ cwd, base, head: rh }), head: rh, untracked })
  const records = readRecords({ cwd }).filter((r) => added.has(r.stem))
  const headRepo = pr.head.repo?.full_name ?? null
  return {
    pr: {
      number: n, head, headRef: pr.head.ref, headRepo, base, draft: pr.draft === true,
      fork: headRepo === null || headRepo !== pr.base.repo?.full_name, dependabot: pr.user?.login === 'dependabot[bot]', createdAt: pr.created_at,
    },
    reviews, comments, threads, requests: fullReviewRequests(comments), codexState: cs, codexHistory: history,
    geminiVerdicts: geminiVerdicts(comments), coderabbitCheck: crCheck, coderabbitChecks, runs, geminiDispatchRuns: dispatched, records,
    currentIdentity, identityOf: makeIdentityOf({ cwd, base }), isAncestor: makeIsAncestor({ cwd }), resolveCommit: makeResolveCommit({ cwd }), now,
    tooLarge: await diffTooLarge({ cwd, base, head }),
  }
}

// The depth judged: the PR's depth label, raised to subtle-correctness when label-gate's inferLabel says so from the
// changed paths (as review-evidence judges). No depth label judges at `standard`, several at the highest
// (label-gate is the check that enforces exactly one). -> { depth, note? }
export async function judgedDepth({ labels, cwd, base, head, gitImpl = defaultGit }) {
  const depths = labels.filter((l) => DEPTH_LABELS.includes(l))
  const label = depths.length === 0 ? 'standard' : DEPTH_LABELS.filter((d) => depths.includes(d)).at(-1)
  const mb = await gitImpl.mergeBase({ cwd, base, head })
  const paths = await gitImpl.changedPaths({ cwd, base: mb, head })
  const agents = await gitImpl.agentsAt({ cwd, rev: head })
  if (agents === null) throw new Error('the head has no AGENTS.md, so the depth floor (its control-file list) cannot be computed')
  const depth = requiredDepth({ label, paths, controlFiles: parseControlFiles(agents) })
  const notes = []
  if (depths.length !== 1) notes.push(`depth: ${depths.length ? `several depth labels (${depths.join(', ')})` : 'no depth label'}; judging at ${label} (label-gate enforces exactly one)`)
  if (depth !== label) notes.push(`depth: judged as ${depth}, not the ${label} label, from the changed paths (label-gate's inferLabel)`)
  return { depth, notes }
}

// ---------------------------------------------------------------- CI entry

async function getJson(fetchImpl, token, url) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  if (!res.ok) throw new Error(`GitHub API ${res.status} on GET ${new URL(url).pathname}`)
  return res.json()
}

// Re-read (bounded) while the depth-label count is not one: label-gate's reconcile normally lands within seconds.
const LABEL_READS = 6
const LABEL_WAIT_MS = 10_000

export async function main({ env = process.env, fetchImpl = fetch, cwd = process.cwd(), gitImpl = defaultGit, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const cnj = (m) => { console.log(`review-gate: FAIL (could not judge): ${m}`); return 1 }
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: num } = env
  if (!token || !repo || !num) return cnj('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
  const n = Number(num)
  if (!Number.isInteger(n) || n <= 0) return cnj(`PR_NUMBER ${JSON.stringify(num)} is not a PR number`)
  try {
    // 1. PR state, live.
    let pr
    for (let i = 1; ; i++) {
      pr = await getJson(fetchImpl, token, `https://api.github.com/repos/${repo}/pulls/${n}`)
      if (!isObj(pr) || !SHA.test(pr.head?.sha ?? '') || !SHA.test(pr.base?.sha ?? '') || typeof pr.base?.ref !== 'string' || typeof pr.head?.ref !== 'string' || !Array.isArray(pr.labels)) return cnj(`PR #${n}: the API reply lacks head, base or labels`)
      if (pr.labels.filter((l) => DEPTH_LABELS.includes(l?.name)).length === 1 || i >= LABEL_READS) break
      await sleep(LABEL_WAIT_MS)
    }
    // 2. Grandfathering, from the BASE branch's activation file, by this check's own key.
    const act = await readActivation({ fetchImpl, token, repo, ref: pr.base.ref, key: GATE_ACTIVATION_KEY })
    if (act.error) return cnj(act.error)
    if (isGrandfathered({ prCreatedAt: pr.created_at, requiredSince: act.since })) {
      console.log(`review-gate: ok (grandfathered: PR #${n} was created ${pr.created_at}, before review-gate was required at ${act.since})`)
      return 0
    }
    // 3. The checkout must be the PR's current head: the records are read from it.
    const local = await gitImpl.head({ cwd })
    if (local !== pr.head.sha) return cnj(`the checkout is ${local}, but the PR's head is now ${pr.head.sha} (a newer push; its own run judges it)`)
    await ensureBase({ cwd, base: pr.base.sha })
    const { depth, notes } = await judgedDepth({ labels: pr.labels.map((l) => l?.name), cwd, base: pr.base.sha, head: pr.head.sha, gitImpl })
    for (const l of notes) console.log(l)
    const { record, problems } = readPrRecord({ cwd, pr: n })
    if (problems.length) {
      for (const p of problems) console.log(`FAIL record ${p}`)
      console.log('review-gate: FAIL')
      return 1
    }
    const state = await readGateState({ repo, token, fetchImpl, pr, cwd, now: now() })
    const result = await evaluateGate({ state, record, depth })
    for (const l of result.lines) console.log(l)
    console.log(result.ok ? 'review-gate: ok' : 'review-gate: FAIL')
    return result.ok ? 0 : 1
  } catch (e) {
    return cnj(e && e.message)
  }
}

const isMain = () => {
  if (process.argv[1] === undefined) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
if (isMain()) process.exitCode = await main()
