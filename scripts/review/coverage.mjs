// PR-stage review slots (spec §5.5): per bot, whether the slot is covered, needs a substitute, or is
// pending; whether a substitute record fills it; and the diff-size check the gate runs first.
// Consumed by review-gate (plan Task 23). Every doubt fails closed: nothing here answers `covered`
// unless the evidence proves it.
//
// ---------------------------------------------------------------- the `state` contract (Task 23 fills it)
//
// slotState's `state` is one object built from Task 21's readers (scripts/review/github.mjs):
//
// @typedef {object} SlotStateInput
// @property {object}  pr                  PR facts, read live:
// @property {number}  pr.number           the PR number (matches prRuns' `prNumbers`)
// @property {string}  pr.head             the head SHA
// @property {?string} pr.headRepo         the head repository, `owner/name` (matches an empty-list fork run)
// @property {boolean} pr.draft            draft PR
// @property {boolean} pr.fork             head repository is not the base repository
// @property {boolean} pr.dependabot       authored by Dependabot
// @property {Array}   reviews             listReviews()                  [{id, login, commitId, submittedAt, body, empty}]
// @property {Array}   requests            fullReviewRequests(comments)   [{bot, at}]
// @property {?object} codexState          codexState(comments)           {commitSha, status, at, commentId} | null
// @property {?object} codexHistory        codexHistory({commentId: codexState.commentId}) {reviews: [{sha, at, status}], complete};
//                                         null when codexState is null (and then it is not read)
// @property {Array}   geminiVerdicts      geminiVerdicts(comments)       [{head, identity, verdict, findings, commentId, at}]
// @property {?object} coderabbitCheck     coderabbitCheck({sha: pr.head}) {conclusion, title} | null
// @property {Array}   runs                prRuns({headRef})              [{id, name, status, conclusion, headSha, headRepo, createdAt, prNumbers}]
// @property {Array}   geminiDispatchRuns  geminiDispatchRuns({pr})       [{id, status, conclusion, createdAt}]
//
// The other slotState arguments: `headPushedAt` is this module's substitutionClockStart() over the same `runs` (the
// gate's choice; headPushedAt() alone restarts the clock on every head);
// `identityOf` and `isAncestor` come from makeIdentityOf / makeIsAncestor (or a stand-in with the same
// contract); `now` is an ISO string or epoch milliseconds.
import { chainHeads, undisposedBlocking } from './records.mjs'
import { CODERABBIT_LOGIN, CODEX_LOGIN } from './severity.mjs'
import { geminiDiff, git, inputIdentity } from './identity.mjs'
import { recordFindingReasons, recordResultReasons } from '../ci/review-evidence.mjs'

export const REQUIRED_BOTS = { mechanical: [], standard: ['coderabbit|codex'], 'subtle-correctness': ['coderabbit', 'codex', 'gemini'] }
export const BOTS = ['coderabbit', 'codex', 'gemini']
// The vendor each bot counts for a substitute's independence (§5.5). CodeRabbit's model is not disclosed, so it
// counts none and never excludes a substitute.
export const BOT_VENDOR = { coderabbit: null, codex: 'openai', gemini: 'google' }
export const FULL_REVIEW_COMMAND = { coderabbit: '@coderabbitai full review', codex: '@codex review' }
export const SUBSTITUTE_AFTER_MS = 30 * 60 * 1000
export const GEMINI_DIFF_LIMIT = 400_000
export const GEMINI_WORKFLOW = 'Gemini review'
const CR_TERMINAL = new Set(['skipped', 'failure', 'cancelled', 'timed_out', 'action_required'])
const GEMINI_RUN_TERMINAL = new Set(['cancelled', 'failure', 'timed_out'])

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t))

// Whether a CodeRabbit review on commit `sha` is unusable because its run failed (§5.5 "Usable": a failed review never
// establishes coverage): `sha` is the head, the commit whose CodeRabbit check the state carries, and that check
// concluded a terminal failure. A review on an earlier commit keeps its standing. Shared by slotState (coverage) and
// review-gate (fix evidence, rule (a)), so the two cannot drift.
export function coderabbitFailedOn(state, sha) {
  return typeof sha === 'string' && sha !== '' && sha === state?.pr?.head && CR_TERMINAL.has(state?.coderabbitCheck?.conclusion)
}
const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 12) : String(sha))
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

// A slot status counts toward the depth when it is `covered`, or `substituted` (the gate's name for a slot whose
// substituteOk holds). `a|b` is one of the two. An unknown depth is never met.
export function requiredMet(depth, statuses) {
  if (!Object.hasOwn(REQUIRED_BOTS, depth)) return false
  const met = (bot) => statuses?.[bot] === 'covered' || statuses?.[bot] === 'substituted'
  return REQUIRED_BOTS[depth].every((slot) => slot.split('|').some(met))
}

// ---------------------------------------------------------------- the substitution clock

// A run belongs to the PR when its PR list names it, or when the list is empty (fork runs, merged PRs) and the
// run's head repository is the PR's.
const runOfPr = (pr, headRepo) => (r) => (Array.isArray(r.prNumbers) && r.prNumbers.includes(pr))
  || ((r.prNumbers?.length ?? 0) === 0 && typeof headRepo === 'string' && headRepo !== '' && r.headRepo === headRepo)

// When the current head last arrived on the PR (plan Task 22, gate point 1): the earliest of the PR's runs on `head`
// created after the latest PR run on any other SHA, floored at the PR's creation. null when there is no such run,
// or when a time cannot be read (the caller then stays pending: fail closed).
export function headPushedAt({ runs, pr, head, headRepo, prCreatedAt }) {
  const floor = ms(prCreatedAt)
  if (Number.isNaN(floor) || !Array.isArray(runs)) return null
  const mine = runs.filter(runOfPr(pr, headRepo))
  if (mine.some((r) => Number.isNaN(ms(r.createdAt)))) return null
  const a = arrivalOf(mine, head)
  if (a === null) return null
  return ms(a.run.createdAt) >= floor ? a.run.createdAt : prCreatedAt
}

// The last arrival of `sha` among `runs` (the PR's runs, every time readable): the earliest run on `sha` created after
// the latest run on any other SHA. -> { run, before } or null. `before` is the head the PR had just before that
// arrival: the SHA of the latest run on another SHA, or null when there is none or several SHAs share that instant.
function arrivalOf(runs, sha) {
  const others = runs.filter((r) => r.headSha !== sha)
  const lastOther = Math.max(-Infinity, ...others.map((r) => ms(r.createdAt)))
  const arrivals = runs.filter((r) => r.headSha === sha && ms(r.createdAt) > lastOther)
  if (arrivals.length === 0) return null
  const run = arrivals.reduce((a, b) => (ms(b.createdAt) < ms(a.createdAt) ? b : a))
  const prev = [...new Set(others.filter((r) => ms(r.createdAt) === lastOther).map((r) => r.headSha))]
  return { run, before: prev.length === 1 ? prev[0] : null }
}

// When the substitution clock starts (final review I-1): the earliest arrival among the trailing run of the PR's heads
// that share the current input identity. From the current head's arrival (headPushedAt), walk back through the heads
// the PR had before it, in arrival order, while each one's identity (identityOf) equals currentIdentity. The walk stops
// at the first head whose identity differs or cannot be computed (an error or null counts as different: fail closed,
// the later time stands), or whose predecessor is ambiguous. The 30 minutes are the bot's time to review the change; an
// identity-preserving push (an evidence commit, a rebase that keeps the identity, D-10) does not change what it must
// review, so it does not restart them. Floored at the PR's creation, as headPushedAt; null as headPushedAt (no run on
// the head, or an unreadable time): the caller then stays pending naming the missing run.
export async function substitutionClockStart({ runs, pr, head, headRepo, prCreatedAt, identityOf, currentIdentity }) {
  const floor = ms(prCreatedAt)
  if (Number.isNaN(floor) || !Array.isArray(runs)) return null
  const mine = runs.filter(runOfPr(pr, headRepo))
  if (mine.some((r) => Number.isNaN(ms(r.createdAt)))) return null
  let a = arrivalOf(mine, head)
  if (a === null) return null
  let start = a.run.createdAt
  if (typeof currentIdentity === 'string' && currentIdentity !== '' && typeof identityOf === 'function') {
    while (typeof a.before === 'string' && a.before !== '') {
      if ((await safe(() => identityOf(a.before), null)) !== currentIdentity) break
      const at = ms(a.run.createdAt)
      const earlier = arrivalOf(mine.filter((r) => ms(r.createdAt) < at), a.before)
      if (earlier === null) break
      a = earlier
      start = a.run.createdAt
    }
  }
  return ms(start) >= floor ? start : prCreatedAt
}

// ---------------------------------------------------------------- git oracles

// have(sha) -> Promise<boolean>: one SHA, present locally or fetched once from origin. A non-SHA argument never
// reaches git. Exported for review-gate, which fetches the PR's base when the checkout lacks it.
export function makeHave({ cwd }) {
  const cache = new Map()
  return (sha) => {
    if (typeof sha !== 'string' || !SHA.test(sha)) return Promise.resolve(false)
    if (!cache.has(sha)) {
      cache.set(sha, (async () => {
        const present = async () => (await git(['cat-file', '-e', `${sha}^{commit}`], { cwd })).code === 0
        if (await present()) return true
        if ((await git(['fetch', '--no-tags', '--quiet', 'origin', sha], { cwd })).code !== 0) return false
        return present()
      })().catch(() => false))
    }
    return cache.get(sha)
  }
}

// identityOf(sha) -> Promise<string | null>: the input identity of `sha` against its merge base with `base`,
// fetching the commit if it is missing; null when it cannot be fetched or computed. Cached per SHA.
export function makeIdentityOf({ cwd, base }) {
  const have = makeHave({ cwd })
  const cache = new Map()
  return (sha) => {
    if (!cache.has(sha)) {
      cache.set(sha, (async () => ((await have(sha)) ? inputIdentity({ cwd, base, head: sha }) : null))().catch(() => null))
    }
    return cache.get(sha)
  }
}

// isAncestor(a, b) -> Promise<boolean>: `git merge-base --is-ancestor a b`, after fetching either if missing. An
// unfetchable commit, or any git error, is not an ancestor. Cached per pair.
export function makeIsAncestor({ cwd }) {
  const have = makeHave({ cwd })
  const cache = new Map()
  return (a, b) => {
    const key = `${a} ${b}`
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        if (!(await have(a)) || !(await have(b))) return false
        return (await git(['merge-base', '--is-ancestor', a, b], { cwd })).code === 0
      })().catch(() => false))
    }
    return cache.get(key)
  }
}

// ---------------------------------------------------------------- slot state

const safe = async (fn, fallback) => { try { return await fn() } catch { return fallback } }

// CodeRabbit and Codex: what the bot reviewed, and what of it is usable evidence. `entries` is every commit the
// bot is known to have reviewed or started (rewrite detection); `evidence` is the usable subset (coverage and
// the "latest rewritten-away review" ordering). Empty reviews are entries, never evidence (V4); for Codex every
// edit-history entry is an entry, and only a `completed` one is evidence (gate point 3).
// A CodeRabbit review on the head, when the CodeRabbit check on that head (the one check the state carries) concluded a
// terminal failure, is an entry and never evidence: a failed review never establishes coverage (§5.5 "Usable"). A review
// on an earlier commit keeps its standing, so an evidence-only head that CodeRabbit skips stays covered.
// An entry with no commit (REST allows a null `commit_id`) or an unreadable time is never evidence. It stays an
// entry, and the rewrite check treats it like an unfetchable commit: not an ancestor of the head, so it takes the
// full-review-request path. It never blocks the slot, because nobody can delete a bot's review.
const hasCommit = (e) => typeof e.sha === 'string' && e.sha !== ''
const readable = (e) => !Number.isNaN(ms(e.at))
// This bot's full-review requests. One with an unreadable time is ignored (GitHub always sets `created_at`).
const botRequests = (state, bot) => state.requests.filter((r) => r.bot === bot && readable(r))
function incrementalInputs(bot, state) {
  const login = bot === 'coderabbit' ? CODERABBIT_LOGIN : CODEX_LOGIN
  const entries = [], evidence = []
  const add = (e, usable) => {
    entries.push(e)
    if (usable && hasCommit(e) && readable(e)) evidence.push(e)
  }
  for (const r of state.reviews) {
    if (r.login !== login) continue
    add({ sha: r.commitId, at: r.submittedAt, by: `review:${r.id}` }, !r.empty && !(bot === 'coderabbit' && coderabbitFailedOn(state, r.commitId)))
  }
  if (bot === 'codex') {
    const cs = state.codexState
    for (const h of state.codexHistory?.reviews ?? []) {
      add({ sha: h.sha, at: h.at, by: `codex-comment:${cs?.commentId}@${short(h.sha)}` }, h.status === 'completed')
    }
    if (cs) add({ sha: cs.commitSha, at: cs.at, by: `codex-comment:${cs.commentId}@${short(cs.commitSha)}` }, cs.status === 'completed')
  }
  return { entries, evidence }
}

// The incremental coverage rule (§5.5) for CodeRabbit and Codex. Returns { covered, by } or { covered: false,
// needsRequest, reason }.
async function incrementalCoverage({ bot, state, entries, evidence, identityOf, isAncestor, currentIdentity }) {
  const head = state.pr.head
  const idOf = (sha) => safe(() => identityOf(sha), null)
  // A commitless entry is never an ancestor (and so counts as rewritten away, like an unfetchable commit).
  const anc = (a, b) => (typeof a !== 'string' || a === '' ? Promise.resolve(false) : a === b ? Promise.resolve(true) : safe(() => isAncestor(a, b), false))
  const latestOf = (list) => {
    const top = Math.max(...list.map((e) => ms(e.at)))
    return list.filter((e) => ms(e.at) === top)
  }
  // The latest usable evidence counts only when every entry at that instant is on the current identity.
  const latestOnCurrent = async (list) => {
    if (list.length === 0) return null
    const latest = latestOf(list)
    for (const e of latest) if ((await idOf(e.sha)) !== currentIdentity) return null
    return latest[0]
  }

  // Rewrite: some commit the bot reviewed (or started) is not an ancestor of the head.
  const rewritten = []
  for (const e of entries) if (!(await anc(e.sha, head))) rewritten.push(e)
  // A rewritten-away commit is carried when a usable review no earlier than it, on the current identity, is on it or
  // on a descendant of it: the bot's incremental reviews up to that commit followed real ancestry, so a rewrite
  // that kept that identity (a rebase onto a newer main, D-10) changed nothing reviewed. Every other rewritten-away
  // commit is an identity-changing rewrite.
  const onCurrent = []
  for (const d of evidence) if ((await idOf(d.sha)) === currentIdentity) onCurrent.push(d)
  const changed = []
  for (const c of rewritten) {
    let carried = false
    for (const d of onCurrent) if (ms(d.at) >= ms(c.at) && (await anc(c.sha, d.sha))) { carried = true; break }
    if (!carried) changed.push(c)
  }

  if (changed.length === 0) {
    const l = await latestOnCurrent(evidence)
    return l ? { covered: true, by: l.by } : { covered: false, reason: evidence.length ? 'the latest usable review is not on the current input identity' : 'no usable review yet' }
  }

  // After an identity-changing rewrite: a full-review request after the latest rewritten-away review, then usable
  // evidence after that request on the current identity. The ordering uses usable reviews (completed, for Codex);
  // when the rewrite is known only from unusable entries, their times stand in (fail closed). An entry whose time
  // cannot be read is left out of the floor, so any request counts as after it: excluding it is the only choice
  // that keeps the request path reachable, and coverage still needs a usable review after that request.
  const changedUsable = changed.filter((c) => evidence.includes(c))
  const floor = Math.max(-Infinity, ...(changedUsable.length ? changedUsable : changed).filter(readable).map((c) => ms(c.at)))
  const asked = botRequests(state, bot).filter((r) => ms(r.at) > floor)
  const cmd = FULL_REVIEW_COMMAND[bot]
  const what = `a rewrite changed the input identity (reviewed ${changed.map((c) => (hasCommit(c) ? short(c.sha) : 'a review with no commit')).join(', ')} no longer in the head's history)`
  if (asked.length === 0) {
    return { covered: false, needsRequest: true, reason: `${what}: post "${cmd}" for a full review` }
  }
  const askedAt = Math.min(...asked.map((r) => ms(r.at)))
  const l = await latestOnCurrent(evidence.filter((e) => ms(e.at) > askedAt))
  // The equality is implied today (every entry after the request is later than every entry before it, and every
  // evidence time is readable), so no test can make it fail; it is kept so a change to the filter above cannot let an
  // older review stand in for the latest one.
  if (l && ms(l.at) === Math.max(...evidence.map((e) => ms(e.at)))) return { covered: true, by: l.by }
  return { covered: false, reason: `${what}: waiting for a usable review answering the full review request ("${cmd}") on the current identity` }
}

function geminiRunsOnHead(state, pushedAt) {
  const pushed = ms(pushedAt)
  const prRunsOnHead = state.runs.filter(runOfPr(state.pr.number, state.pr.headRepo))
    .filter((r) => r.headSha === state.pr.head && r.name === GEMINI_WORKFLOW)
  const dispatched = state.geminiDispatchRuns.filter((r) => ms(r.createdAt) >= pushed)
  return [...prRunsOnHead, ...dispatched]
}

const requireArrays = (state) => {
  for (const k of ['reviews', 'requests', 'geminiVerdicts', 'runs', 'geminiDispatchRuns']) {
    if (!Array.isArray(state?.[k])) throw new TypeError(`slotState: state.${k} must be an array`)
  }
  if (!state.pr || typeof state.pr.head !== 'string') throw new TypeError('slotState: state.pr.head must be a string')
}

export async function slotState({ bot, state, identityOf, isAncestor, currentIdentity, now, headPushedAt: pushedAt }) {
  if (!BOTS.includes(bot)) throw new TypeError(`slotState: unknown bot ${bot}`)
  if (typeof identityOf !== 'function' || typeof isAncestor !== 'function') throw new TypeError('slotState: identityOf and isAncestor must be functions')
  requireArrays(state)
  const pending = (reason) => ({ status: 'pending', reason })
  const substitute = (reason) => ({ status: 'needs-substitute', reason })
  if (typeof currentIdentity !== 'string' || currentIdentity === '') return pending('the current input identity is unknown')
  const head = state.pr.head

  if (bot === 'codex' && state.codexState && state.codexHistory?.complete !== true) {
    return pending(`the Codex summary comment's edit history could not be read in full (comment ${state.codexState.commentId}): earlier reviewed commits are unknown`)
  }

  // Coverage.
  let inc = null
  if (bot === 'gemini') {
    const usable = state.geminiVerdicts.filter((v) => (v.verdict === 'no-findings' || v.verdict === 'findings') && v.identity !== '' && v.identity === currentIdentity)
    if (usable.length) {
      const v = usable.reduce((a, b) => (ms(b.at) > ms(a.at) ? b : a))
      return { status: 'covered', by: `gemini-comment:${v.commentId}`, reason: `Gemini verdict ${v.verdict} on the current identity` }
    }
  } else {
    const { entries, evidence } = incrementalInputs(bot, state)
    inc = await incrementalCoverage({ bot, state, entries, evidence, identityOf, isAncestor, currentIdentity })
    if (inc.covered) return { status: 'covered', by: inc.by, reason: `usable ${bot} review on the current identity` }
  }

  // Not covered. Without the head's arrival time there is no clock, so nothing substitutes.
  const pushed = ms(pushedAt)
  if (pushedAt === null || pushedAt === undefined || Number.isNaN(pushed)) {
    return pending(`no pull_request workflow run found for head ${short(head)}: cannot start the substitution clock`)
  }

  // Not configured: Gemini does not run on fork, Dependabot or draft PRs.
  if (bot === 'gemini' && (state.pr.draft || state.pr.fork || state.pr.dependabot)) {
    const why = state.pr.draft ? 'draft' : state.pr.fork ? 'fork' : 'Dependabot'
    return substitute(`Gemini is not configured on ${why} PRs`)
  }

  // Terminal failure on the head.
  if (bot === 'coderabbit' && state.coderabbitCheck && CR_TERMINAL.has(state.coderabbitCheck.conclusion)) {
    return substitute(`CodeRabbit check on ${short(head)} concluded ${state.coderabbitCheck.conclusion}${state.coderabbitCheck.title ? ` ("${state.coderabbitCheck.title}")` : ''}`)
  }
  const geminiRuns = bot === 'gemini' ? geminiRunsOnHead(state, pushedAt) : []
  const inFlight = geminiRuns.filter((r) => r.status !== 'completed')
  if (bot === 'gemini') {
    if (state.geminiVerdicts.some((v) => v.head === head && v.verdict === 'could-not-run')) return substitute(`Gemini could not run on ${short(head)}`)
    // Task 20 Step 3b: a job timeout is a cancellation, and its post step writes no verdict.
    const completed = geminiRuns.filter((r) => r.status === 'completed')
    const named = state.geminiVerdicts.some((v) => v.head === head)
    if (inFlight.length === 0 && completed.length && !named) {
      const last = completed.reduce((a, b) => (ms(b.createdAt) > ms(a.createdAt) ? b : a))
      if (GEMINI_RUN_TERMINAL.has(last.conclusion)) return substitute(`the latest ${GEMINI_WORKFLOW} run on ${short(head)} (${last.id}) concluded ${last.conclusion} with no verdict`)
    }
  }

  // An identity-changing rewrite with no full-review request waits for the author.
  if (inc?.needsRequest) return pending(inc.reason)

  // Gemini hold (gate point 2): a run that has not completed is about to post a verdict.
  if (inFlight.length) {
    return pending(`${GEMINI_WORKFLOW} run ${inFlight.map((r) => `${r.id} (${r.status})`).join(', ')} on ${short(head)} has not finished`)
  }

  // Timeout.
  const requests = botRequests(state, bot).map((r) => ms(r.at))
  const start = Math.max(pushed, ...requests)
  const t = ms(now)
  if (!Number.isNaN(t) && t - start >= SUBSTITUTE_AFTER_MS) {
    return substitute(`no usable ${bot} review ${Math.floor((t - start) / 60000)} minutes after ${requests.length && start > pushed ? 'the last full-review request' : `the current input identity arrived (head ${short(head)} or an earlier head with its identity)`}`)
  }
  // Nothing re-runs the gate when the 30 minutes pass, so the line says when to re-run it.
  const allowed = new Date(start + SUBSTITUTE_AFTER_MS).toISOString()
  return pending(`${inc?.reason ?? `waiting for a ${bot} review of ${short(head)}`}; substitution allowed after ${allowed}; re-run review-gate then`)
}

// ---------------------------------------------------------------- substitutes

// A `substitute:<bot>` chain head that passes parts 1, 2 and 4 of the review-evidence predicate on currentIdentity
// (the same code review-evidence runs), by a vendor not in countedVendors (§5.5's rule replaces part 3's
// author-vendor rule, so the author's vendor may substitute). As in review-evidence, an invalid record, or another
// head of this slot that leaves a blocking finding open, fails it: an open head must be superseded, not bypassed.
// `records` are the PR's records (Task 23 passes those this PR adds).
export function substituteOk({ bot, records, currentIdentity, countedVendors }) {
  if (!BOTS.includes(bot) || !Array.isArray(records) || !Array.isArray(countedVendors)) return false
  if (typeof currentIdentity !== 'string' || currentIdentity === '') return false
  if (records.some((r) => r.invalid)) return false
  const slot = `substitute:${bot}`
  const byStem = new Map(records.map((r) => [r.stem, r]))
  const heads = chainHeads(records).filter((r) => r.slot === slot)
  if (heads.some((r) => undisposedBlocking(r).length)) return false
  const want = { kind: 'pr', identity: currentIdentity }
  return heads.some((r) => r.input?.kind === 'pr'
    && typeof r.reviewer?.vendor === 'string' && !countedVendors.includes(r.reviewer.vendor)
    && recordResultReasons(r, want).length === 0
    && recordFindingReasons(r, { byStem }).length === 0)
}

// ---------------------------------------------------------------- diff size

// Gemini's diff (the same bytes the workflow sends) exceeds its 400,000-byte limit. The gate checks this before
// coverage: an oversized PR is split, and no substitute clears it (§5.5). `limit` exists for tests.
export async function diffTooLarge({ cwd, base, head, limit = GEMINI_DIFF_LIMIT }) {
  return (await geminiDiff({ cwd, base, head })).length > limit
}
