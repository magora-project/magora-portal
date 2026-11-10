// Self-test for scripts/review/coverage.mjs: slot coverage and substitution for the PR-stage gate
// (spec §5.5). The GitHub state is synthetic; ancestry and diffs come from real git repos built in a
// temporary directory and deleted at the end.
// Run: node scripts/review/coverage.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BOT_VENDOR, GEMINI_DIFF_LIMIT, REQUIRED_BOTS, diffTooLarge, headPushedAt, makeIdentityOf, makeIsAncestor, requiredMet,
  slotState, substituteOk,
} from './coverage.mjs'
import { geminiDispatchRuns } from './github.mjs'
import { geminiDiff, inputIdentity } from './identity.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c !== null && typeof c === 'object' && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c === true) pass++; else { fail++; console.log('  FAIL', n) }
}

// ---------------------------------------------------------------- git fixtures
const tmp = mkdtempSync(join(tmpdir(), 'coverage-test-'))
const GIT_ENV = {
  ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
const g = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, shell: false, env: GIT_ENV, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const newRepo = (name) => {
  const dir = join(tmp, name)
  g(tmp, ['init', '-q', '-b', 'main', dir])
  return dir
}

try {
  // Commit graph for ancestry (identities are a stub map; only ancestry is read from git):
  //   M0 - A1 - A2 - E        (E: evidence-only commit, same identity as A2)
  //    \ - F1 - F2            (a force-push that rewrote A1/A2)
  //    \ - M1 - R1 - R2       (A1/A2 rebased onto a newer main; R2 keeps A2's identity)
  //    \ - L1                 (a force-push away from F1, later rebased: see the laundering case)
  const repo = newRepo('graph')
  writeFileSync(join(repo, 'f.txt'), 'x\n')
  g(repo, ['add', 'f.txt'])
  g(repo, ['commit', '-q', '-m', 'M0'])
  const M0 = g(repo, ['rev-parse', 'HEAD'])
  const tree = g(repo, ['rev-parse', 'HEAD^{tree}'])
  const commit = (parent, msg) => g(repo, ['commit-tree', tree, '-p', parent, '-m', msg])
  const A1 = commit(M0, 'A1'), A2 = commit(A1, 'A2'), E = commit(A2, 'E')
  const F1 = commit(M0, 'F1'), F2 = commit(F1, 'F2')
  const M1 = commit(M0, 'M1'), R1 = commit(M1, 'R1'), R2 = commit(R1, 'R2')
  const L1 = commit(M1, 'L1')
  const UNFETCHABLE = 'dead'.repeat(10)
  const IDS = new Map([[A1, 'I1'], [A2, 'I2'], [E, 'I2'], [F1, 'IF1'], [F2, 'IF2'], [R1, 'I1'], [R2, 'I2'], [L1, 'IF1']])
  const identityOf = async (sha) => IDS.get(sha) ?? null
  const isAncestor = makeIsAncestor({ cwd: repo }) // real git; the repo has no origin, so a missing commit is unfetchable

  const CR = 'coderabbitai[bot]', CODEX = 'chatgpt-codex-connector[bot]'
  const T = (hhmm) => `2026-11-01T${hhmm}:00Z`
  const review = (login, sha, at, body = 'Reviewed', id = Math.floor(Math.random() * 1e9)) => ({ id, login, commitId: sha, submittedAt: T(at), body, empty: body.trim() === '' })
  const cr = (sha, at, body) => review(CR, sha, at, body)
  const req = (bot, at) => ({ bot, at: T(at) })
  const verdict = (head, identity, v, at, findings = []) => ({ head, identity, verdict: v, findings, commentId: 7, at: T(at) })
  const runOn = (pr, head, at, extra = {}) => ({ id: 1, name: 'CI', event: 'pull_request', status: 'completed', conclusion: 'success', headSha: head, headRepo: 'o/r', createdAt: at, prNumbers: [pr], ...extra })
  const run = (pr, at) => runOn(pr, 'A', at)
  const forkRun = (headRepo, head, at) => ({ ...runOn(44, head, at), headRepo, prNumbers: [] })
  const gemRun = (head, at, status, conclusion = null) => runOn(44, head, T(at), { name: 'Gemini review', status, conclusion })

  const baseState = (head) => ({
    pr: { number: 44, head, headRepo: 'o/r', draft: false, fork: false, dependabot: false },
    reviews: [], requests: [], codexState: null, codexHistory: null, geminiVerdicts: [], coderabbitCheck: null, runs: [], geminiDispatchRuns: [],
  })
  // fx: { bot, head, current, now, pushed, ...state overrides }
  const s = (fx) => {
    const { bot, head, current, now = T('10:10'), pushed = T('10:00'), pr, ...rest } = fx
    const st = baseState(head)
    return slotState({
      bot, state: { ...st, ...rest, pr: { ...st.pr, ...pr } }, identityOf, isAncestor, currentIdentity: current, now, headPushedAt: pushed,
    })
  }
  const codexFx = ({ head, current, history, reviews = [], requests = [], complete = true, now, marker = history.at(-1) }) => ({
    bot: 'codex', head, current, now, reviews, requests,
    codexState: marker ? { commitSha: marker.sha, status: marker.status, at: marker.at, commentId: 9 } : null,
    codexHistory: { reviews: history, complete },
  })
  const hist = (sha, at, status = 'completed') => ({ sha, at: T(at), status })

  // ------------------------------------------------------------ the brief's cases
  const codexMarkerOnly = codexFx({ head: A2, current: 'I2', history: [hist(A2, '10:05')] })
  const crSkippedOnEvidenceHead = { bot: 'coderabbit', head: E, current: 'I2', reviews: [cr(A2, '09:30')], coderabbitCheck: { conclusion: 'skipped', title: 'No files to review' } }
  const crFullThenEmpties = { bot: 'coderabbit', head: E, current: 'I2', reviews: [cr(A2, '09:30'), cr(E, '10:02', ''), cr(E, '10:03', '  ')] }
  const crRateLimited = { bot: 'coderabbit', head: A2, current: 'I2', coderabbitCheck: { conclusion: 'failure', title: 'Review rate limit exceeded' } }
  const geminiCouldNotRun = { bot: 'gemini', head: A2, current: 'I2', geminiVerdicts: [verdict(A2, 'I2', 'could-not-run', '10:04')] }
  const geminiDraft = { bot: 'gemini', head: A2, current: 'I2', pr: { draft: true }, now: T('10:01') }
  const forcePushIncrementalOnly = { bot: 'coderabbit', head: F1, current: 'IF1', reviews: [cr(A2, '09:30'), cr(F1, '10:02')], requests: [req('coderabbit', '10:05')] }
  const forcePushNoRequest = { bot: 'coderabbit', head: F1, current: 'IF1', reviews: [cr(A2, '09:30'), cr(F1, '10:02')] }
  const ordinaryPushIncremental = { bot: 'coderabbit', head: A2, current: 'I2', reviews: [cr(A1, '09:30'), cr(A2, '10:02')] }
  const geminiAfterForcePush = { bot: 'gemini', head: F1, current: 'IF1', geminiVerdicts: [verdict(A2, 'I2', 'findings', '09:30', [{ index: 1, severity: 'P1' }]), verdict(F1, 'IF1', 'no-findings', '10:05')] }
  const crRebaseSameIdentity = { bot: 'coderabbit', head: R2, current: 'I2', reviews: [cr(A1, '09:20'), cr(A2, '09:30')] }
  const forcePushAnswered = { bot: 'coderabbit', head: F1, current: 'IF1', reviews: [cr(A2, '09:30'), cr(F1, '10:03')], requests: [req('coderabbit', '10:01')] }
  const unfetchable = { bot: 'coderabbit', head: A2, current: 'I2', reviews: [cr(UNFETCHABLE, '09:30')] }
  const at29 = { bot: 'coderabbit', head: A2, current: 'I2', now: T('10:29') }
  const at31 = { bot: 'coderabbit', head: A2, current: 'I2', now: T('10:31') }
  const failedNoRuns = { bot: 'coderabbit', head: A2, current: 'I2', pushed: headPushedAt({ runs: [], pr: 44, head: A2, headRepo: 'o/r', prCreatedAt: T('09:00') }), coderabbitCheck: { conclusion: 'failure', title: 'x' }, now: T('11:00') }
  // The commit was authored at 08:00 (its committer date is not an input); the push created its runs at 10:00.
  const oldCommitFreshPush = { bot: 'coderabbit', head: A2, current: 'I2', now: T('10:20'), pushed: headPushedAt({ runs: [runOn(44, A2, T('10:00'))], pr: 44, head: A2, headRepo: 'o/r', prCreatedAt: T('07:00') }) }
  const geminiInFlightAt31 = { bot: 'gemini', head: A2, current: 'I2', now: T('10:31'), runs: [runOn(44, A2, T('10:00')), gemRun(A2, '10:00', 'in_progress')] }
  const geminiJobTimedOut = { bot: 'gemini', head: A2, current: 'I2', now: T('10:28'), runs: [gemRun(A2, '10:00', 'completed', 'cancelled')] }
  const geminiDispatchInFlightAt31 = { bot: 'gemini', head: A2, current: 'I2', now: T('10:31'), geminiDispatchRuns: [{ id: 5, status: 'in_progress', conclusion: null, createdAt: T('10:05') }] }
  // The dispatched runs come through Task 21's reader, which keeps only this PR's by run-name.
  const otherPrDispatch = await geminiDispatchRuns({
    repo: 'o/r', pr: 44, token: 't',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ total_count: 1, workflow_runs: [{ id: 6, status: 'in_progress', conclusion: null, created_at: T('10:05'), display_title: 'Gemini review PR #12' }] }) }),
  })
  const otherPrDispatchInFlightAt31 = { bot: 'gemini', head: A2, current: 'I2', now: T('10:31'), geminiDispatchRuns: otherPrDispatch }
  const codexMarkerRewrittenNoRequest = codexFx({ head: F1, current: 'IF1', history: [hist(A2, '09:30'), hist(F1, '10:05')] })
  const codexRequestBeforeHistoricalReview = codexFx({ head: F1, current: 'IF1', history: [hist(A2, '09:30'), hist(F1, '10:05')], requests: [req('codex', '09:20')] })
  const codexRequestAfterHistoricalReviewAnswered = codexFx({ head: F1, current: 'IF1', history: [hist(A2, '09:30'), hist(F1, '10:05')], requests: [req('codex', '10:01')] })
  const codexHistoryIncomplete = codexFx({ head: A2, current: 'I2', history: [hist(A2, '10:05')], complete: false, reviews: [review(CODEX, A2, '10:06')] })

  // Substitutes
  const id = 'I-current'
  const sub = (bot, vendor, extra = {}) => ({
    stem: `substitute-${bot}--${vendor}--1`, schema: 1, type: 'substitute', slot: `substitute:${bot}`, input: { kind: 'pr', identity: id },
    reviewer: { vendor, model: 'm' }, authorVendor: 'anthropic', outcome: 'completed', verdict: 'pass', findings: [], supersedes: null,
    createdAt: '2026-11-01T10:00:00Z', ...extra,
  })
  const subWithOpenP1 = sub('coderabbit', 'openai', { verdict: 'fail', findings: [{ id: 'thread:T1', severity: 'P1', summary: 'new' }] })
  const subByAnthropic = sub('gemini', 'anthropic')
  const subByOpenai = sub('gemini', 'openai')
  const THREE = { coderabbit: 'openai', codex: 'anthropic', gemini: 'google' }
  const threeSubsFor = (b) => ({ bot: b, records: [sub(b, THREE[b])], currentIdentity: id, countedVendors: Object.entries(THREE).filter(([k]) => k !== b).map(([, v]) => v) })
  const secondSameVendor = { bot: 'codex', records: [sub('codex', 'google')], currentIdentity: id, countedVendors: ['google'] }

  // Diff-size repos
  const diffRepo = (name) => {
    const dir = newRepo(name)
    writeFileSync(join(dir, 'base.txt'), 'b\n')
    g(dir, ['add', 'base.txt']); g(dir, ['commit', '-q', '-m', 'base'])
    const base = g(dir, ['rev-parse', 'HEAD'])
    g(dir, ['checkout', '-q', '-b', 'pr'])
    const put = (len) => { writeFileSync(join(dir, 'big.txt'), `${'y'.repeat(len - 1)}\n`); g(dir, ['add', 'big.txt']); g(dir, ['commit', '-q', '--amend', '--allow-empty', '-m', 'pr']) }
    g(dir, ['commit', '-q', '--allow-empty', '-m', 'pr'])
    return { dir, base, put }
  }
  const sized = async (name, target) => {
    const r = diffRepo(name)
    r.put(10)
    const probe = { cwd: r.dir, base: r.base, head: g(r.dir, ['rev-parse', 'HEAD']) }
    const header = (await geminiDiff(probe)).length - 10
    r.put(target - header)
    return { cwd: r.dir, base: r.base, head: g(r.dir, ['rev-parse', 'HEAD']) }
  }
  const bigRepo = await sized('big', GEMINI_DIFF_LIMIT + 1)
  const limitRepo = await sized('limit', GEMINI_DIFF_LIMIT)
  const binRenameRepo = (() => {
    const dir = newRepo('binrename')
    writeFileSync(join(dir, 'old-name.txt'), Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n')
    g(dir, ['add', '.']); g(dir, ['commit', '-q', '-m', 'base'])
    const base = g(dir, ['rev-parse', 'HEAD'])
    g(dir, ['mv', 'old-name.txt', 'new-name.txt'])
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 255, 0, 7, 0, 9]))
    g(dir, ['add', '.']); g(dir, ['commit', '-q', '-m', 'rename + binary'])
    return { cwd: dir, base, head: g(dir, ['rev-parse', 'HEAD']) }
  })()
  // The size diffTooLarge measured: the smallest limit it does not exceed.
  const sizeSeenBy = async (fn, r) => {
    let lo = 0, hi = 1 << 24
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (await fn({ ...r, limit: mid })) lo = mid + 1; else hi = mid }
    return lo
  }
  // Test-local stand-in for the gate's ordering (Task 23 builds the real one): size first, then coverage.
  const evaluateGateLike = async ({ repo: r, depth, statuses, subs }) => {
    if (await diffTooLarge(r)) return { ok: false, lines: ['split this PR'] }
    const st = { ...statuses }
    for (const [bot, args] of Object.entries(subs)) if (substituteOk(args)) st[bot] = 'substituted'
    return { ok: requiredMet(depth, st), lines: [] }
  }
  const allFailed = { coderabbit: 'needs-substitute', codex: 'needs-substitute', gemini: 'needs-substitute' }
  const bigWithSubs = { repo: bigRepo, depth: 'subtle-correctness', statuses: allFailed, subs: Object.fromEntries(['coderabbit', 'codex', 'gemini'].map((b) => [b, threeSubsFor(b)])) }

  ok('clean Codex review seen only through the marker -> covered', (await s(codexMarkerOnly)).status === 'covered')
  ok('evidence-only commit: CodeRabbit check "skipped / No files to review" on the new head, earlier review on the same identity -> covered', (await s(crSkippedOnEvidenceHead)).status === 'covered')
  ok('empty reviews after a full one do not uncover it', (await s(crFullThenEmpties)).status === 'covered')
  ok('rate-limited CodeRabbit with no usable review -> needs-substitute', (await s(crRateLimited)).status === 'needs-substitute')
  ok('Gemini could-not-run -> needs-substitute', (await s(geminiCouldNotRun)).status === 'needs-substitute')
  ok('Gemini on a draft PR -> needs-substitute immediately', (await s(geminiDraft)).status === 'needs-substitute')
  ok('force-push then incremental review only, no answer to the full-review request -> not covered', ['pending', 'needs-substitute'].includes((await s(forcePushIncrementalOnly)).status))
  ok('force-push, incremental review on the new identity, no request at all -> not covered, reason names the request', ['pending', 'needs-substitute'].includes((await s(forcePushNoRequest)).status) && /full review/.test((await s(forcePushNoRequest)).reason))
  ok('ordinary push, incremental review on the new identity -> covered (no request needed)', (await s(ordinaryPushIncremental)).status === 'covered')
  ok('substitute with a completed outcome but a new open P1 -> not ok', substituteOk({ bot: 'coderabbit', records: [subWithOpenP1], currentIdentity: id, countedVendors: [] }) === false)
  ok('a 400,001-byte diff is too large, and no substitute clears the gate', (await diffTooLarge(bigRepo)) === true && (await evaluateGateLike(bigWithSubs)).ok === false)
  ok('three substitutes from openai, anthropic, google on an anthropic-authored PR -> all ok', ['coderabbit', 'codex', 'gemini'].every((b) => substituteOk(threeSubsFor(b))))
  ok('two substitutes from the same vendor -> the second is not ok', substituteOk(secondSameVendor) === false)
  ok('Gemini after a force-push: a fresh verdict on the new identity -> covered, no request needed', (await s(geminiAfterForcePush)).status === 'covered')
  ok('identity-preserving force-push (rebase onto main): earlier CodeRabbit coverage stands', (await s(crRebaseSameIdentity)).status === 'covered')
  ok('geminiDiff and diffTooLarge measure the same bytes, binary and rename included', await (async () => { const n = (await geminiDiff(binRenameRepo)).length; return Number.isInteger(n) && n > 0 && n === await sizeSeenBy(diffTooLarge, binRenameRepo) })())
  ok('force-push then a usable review after the request -> covered', (await s(forcePushAnswered)).status === 'covered')
  ok('review on an unfetchable commit -> not usable, no throw', (await s(unfetchable)).status === 'pending' && /full review/.test((await s(unfetchable)).reason))
  ok('29 minutes, nothing -> pending; 31 minutes -> needs-substitute', (await s(at29)).status === 'pending' && (await s(at31)).status === 'needs-substitute')
  ok('headPushedAt is the earliest run creation for this PR, not the committer date', headPushedAt({ runs: [run(44, '2026-11-01T10:05:00Z'), run(44, '2026-11-01T10:00:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
  ok('a SHA whose runs predate the PR: the clock starts at PR creation', headPushedAt({ runs: [run(44, '2026-11-01T08:00:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T09:00:00Z')
  ok('no pull_request run for the head -> null, and the slot stays pending naming the missing run', headPushedAt({ runs: [], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === null && await (async () => { const r = await s(failedNoRuns); return r.status === 'pending' && /run/.test(r.reason) })())
  ok('runs for another PR on the same SHA are ignored', headPushedAt({ runs: [run(12, '2026-11-01T07:00:00Z'), run(44, '2026-11-01T10:00:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T06:00:00Z' }) === '2026-11-01T10:00:00Z')
  ok('a gate re-run adds a later run and leaves the clock unchanged', headPushedAt({ runs: [run(44, '2026-11-01T10:00:00Z'), run(44, '2026-11-01T10:40:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
  ok('a commit authored two hours before its push does not start the clock early', (await s(oldCommitFreshPush)).status === 'pending')
  ok('subtle-correctness: CodeRabbit and Codex covered, Gemini failed, anthropic substitute -> ok', substituteOk({ bot: 'gemini', records: [subByAnthropic], currentIdentity: id, countedVendors: ['openai'] }))
  ok('standard: one of CodeRabbit or Codex is enough', requiredMet('standard', { coderabbit: 'pending', codex: 'covered' }))
  ok('substitute by a vendor already counted -> not ok', substituteOk({ bot: 'gemini', records: [subByOpenai], currentIdentity: id, countedVendors: ['openai'] }) === false)
  // Gate points 1-3 (amended in PR D). run(pr, at) above is runOn(pr, 'A', at): a run on head 'A' from 'o/r'.
  ok('a returning head A -> B -> A starts the clock at A\'s second arrival', headPushedAt({ runs: [runOn(44, 'A', '2026-11-01T10:00:00Z'), runOn(44, 'B', '2026-11-01T10:10:00Z'), runOn(44, 'A', '2026-11-01T10:20:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:20:00Z')
  ok('an empty-list run from another head repository is ignored; one from the PR\'s fork counts', headPushedAt({ runs: [forkRun('x/r', 'B', '2026-11-01T10:30:00Z'), forkRun('f/r', 'A', '2026-11-01T10:00:00Z')], pr: 44, head: 'A', headRepo: 'f/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
  ok('a later edited/labeled run on the same head leaves the clock at its arrival', headPushedAt({ runs: [runOn(44, 'A', '2026-11-01T10:00:00Z'), runOn(44, 'A', '2026-11-01T10:45:00Z')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: '2026-11-01T09:00:00Z' }) === '2026-11-01T10:00:00Z')
  ok('Gemini 31 minutes after the push with its run in progress -> pending naming the run', await (async () => { const r = await s(geminiInFlightAt31); return r.status === 'pending' && /Gemini review/.test(r.reason) })())
  ok('Gemini run cancelled by its job timeout, no verdict for the head, none in flight -> needs-substitute', (await s(geminiJobTimedOut)).status === 'needs-substitute')
  ok('a dispatched Gemini run created after the head arrived and still in progress at 31 minutes -> pending', (await s(geminiDispatchInFlightAt31)).status === 'pending')
  ok('a dispatched Gemini run for another PR does not hold this one', (await s(otherPrDispatchInFlightAt31)).status === 'needs-substitute')
  ok('a clean Codex marker overwritten after a force-push with no full-review request -> not covered, reason names the request', await (async () => { const r = await s(codexMarkerRewrittenNoRequest); return r.status !== 'covered' && /full review/.test(r.reason) })())
  ok('a full-review request before the rewritten-away clean Codex review (known only from edit history) does not count; one after it, answered on the current identity, does', (await s(codexRequestBeforeHistoricalReview)).status !== 'covered' && (await s(codexRequestAfterHistoricalReviewAnswered)).status === 'covered')
  ok('unreadable Codex edit history -> pending, never covered', await (async () => { const r = await s(codexHistoryIncomplete); return r.status === 'pending' && /edit history/.test(r.reason) })())

  // ------------------------------------------------------------ controller rulings and extra guards
  // `is(result, status, reasonRe?)`: the expected status, and the reason when a pattern is given.
  const is = (r, status, re) => r.status === status && (re === undefined || re.test(r.reason))
  // Ruling 3: an empty Gemini identity is never coverage.
  ok('a Gemini verdict with identity "" is never coverage (pending at 10 minutes)', is(await s({ bot: 'gemini', head: A2, current: 'I2', geminiVerdicts: [verdict(A2, '', 'no-findings', '10:05')] }), 'pending', /waiting for a gemini review/))
  ok('a Gemini verdict with identity "" does not cover an empty current identity either', is(await s({ bot: 'gemini', head: A2, current: '', geminiVerdicts: [verdict(A2, '', 'no-findings', '10:05')] }), 'pending', /identity is unknown/))
  ok('a skipped-same-identity verdict is not itself coverage', is(await s({ bot: 'gemini', head: A2, current: 'I2', geminiVerdicts: [verdict(A2, 'I2', 'skipped-same-identity', '10:05')] }), 'pending', /waiting for a gemini review/))
  ok('a usable Gemini verdict on another identity is not coverage', is(await s({ bot: 'gemini', head: F1, current: 'IF1', geminiVerdicts: [verdict(A2, 'I2', 'no-findings', '10:05')] }), 'pending', /waiting for a gemini review/))
  // Ruling 4: Codex running entries count for rewrite detection, never for coverage.
  ok('a running-only Codex entry on a rewritten-away commit still triggers the rewrite rule', await (async () => {
    const r = await s(codexFx({ head: F1, current: 'IF1', history: [hist(A2, '09:30', 'running'), hist(F1, '10:05')] }))
    return is(r, 'pending', /post "@codex review" for a full review/)
  })())
  ok('the same history without the rewritten-away entry is covered (control)', (await s(codexFx({ head: F1, current: 'IF1', history: [hist(F1, '10:05')] }))).status === 'covered')
  ok('a running Codex entry is never coverage', is(await s(codexFx({ head: A2, current: 'I2', history: [hist(A2, '10:05', 'running')] })), 'pending', /no usable review yet/))
  ok('a running entry after a completed one does not hide it (latest completed review counts)', (await s(codexFx({ head: A2, current: 'I2', history: [hist(A2, '10:05'), hist(A2, '10:07', 'running')] }))).status === 'covered')
  ok('a non-empty Codex review object on the head is coverage', (await s({ bot: 'codex', head: A2, current: 'I2', reviews: [review(CODEX, A2, '10:05')] })).status === 'covered')
  ok('a marker without an edit history -> pending naming the edit history', await (async () => {
    const r = await s({ ...codexFx({ head: A2, current: 'I2', history: [hist(A2, '10:05')] }), codexHistory: null })
    return r.status === 'pending' && /edit history/.test(r.reason)
  })())
  // Rewrite rule details.
  ok('a rebase after an unanswered identity-changing force-push does not launder it', await (async () => {
    // A2 (I2) reviewed; rewritten to L1 (IF1), reviewed incrementally with no request; then rebased to F1 (still IF1).
    // The latest rewritten-away review (L1) kept the identity, but the A2 -> L1 rewrite changed it and was never answered.
    const r = await s({ bot: 'coderabbit', head: F1, current: 'IF1', reviews: [cr(A2, '09:30'), cr(L1, '09:50')] })
    return is(r, 'pending', /post "@coderabbitai full review"/)
  })())
  ok('a rewrite whose latest rewritten-away review kept the identity, after earlier pushes, stays covered (D-10)', (await s(crRebaseSameIdentity)).status === 'covered')
  ok('an unanswered request\'s clock: request at 10:20, 10:31 -> pending; 10:51 -> needs-substitute', await (async () => {
    const fx = { ...forcePushIncrementalOnly, requests: [req('coderabbit', '10:20')] }
    return (await s({ ...fx, now: T('10:31') })).status === 'pending' && (await s({ ...fx, now: T('10:51') })).status === 'needs-substitute'
  })())
  ok('a request for the other bot does not count', is(await s({ ...forcePushAnswered, requests: [req('codex', '10:01')] }), 'pending', /post "@coderabbitai full review"/))
  ok('a review submitted at the same second as the request does not answer it', is(await s({ ...forcePushAnswered, reviews: [cr(A2, '09:30'), cr(F1, '10:01')] }), 'pending', /waiting for a usable review answering the full review request/))

  // I-1: a review with no commit, or an unreadable time, never covers and never pins the slot.
  const nullCommit = { ...cr(A2, '09:30'), commitId: null }
  ok('(a) CodeRabbit review with commitId null plus a failure check -> needs-substitute', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit], coderabbitCheck: { conclusion: 'failure', title: 'x' } }), 'needs-substitute', /concluded failure/))
  ok('(b) null-commit review, a full-review request answered by a usable review on the current identity -> covered', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit, cr(A2, '10:05')], requests: [req('coderabbit', '10:01')] }), 'covered'))
  ok('(b\') the same review before the request does not answer it', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit, cr(A2, '09:50')], requests: [req('coderabbit', '10:01')] }), 'pending', /full review request/))
  ok('a null-commit review with no request -> pending naming the request (the author can clear it)', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit, cr(A2, '10:05')] }), 'pending', /post "@coderabbitai full review"/))
  ok('(c) null-commit review, a request, nothing after it, 31 minutes -> needs-substitute', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit], requests: [req('coderabbit', '10:01')], now: T('10:32') }), 'needs-substitute', /last full-review request/))
  ok('(c\') ... and 29 minutes after the request -> pending', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [nullCommit], requests: [req('coderabbit', '10:01')], now: T('10:30') }), 'pending', /full review request/))
  const badTime = { ...cr(A2, '10:05'), submittedAt: 'not a time' }
  ok('(d) an unparseable submittedAt on the head is never coverage: pending at 10 minutes', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [badTime] }), 'pending', /no usable review yet/))
  ok('(d) ... and needs-substitute at 31 minutes (not pending forever)', is(await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [badTime], now: T('10:31') }), 'needs-substitute'))
  ok('(d) an unparseable time on a rewritten-away review: any request counts after it; answered -> covered, unanswered at 31 min -> needs-substitute', await (async () => {
    const old = { ...cr(A2, '09:30'), submittedAt: 'garbage' }
    const answered = await s({ bot: 'coderabbit', head: F1, current: 'IF1', reviews: [old, cr(F1, '10:05')], requests: [req('coderabbit', '10:01')] })
    const late = await s({ bot: 'coderabbit', head: F1, current: 'IF1', reviews: [old], requests: [req('coderabbit', '10:01')], now: T('10:32') })
    const none = await s({ bot: 'coderabbit', head: F1, current: 'IF1', reviews: [old, cr(F1, '10:05')] })
    return is(answered, 'covered') && is(late, 'needs-substitute') && is(none, 'pending', /full review/)
  })())
  ok('a Codex history entry with no sha and an unreadable time is never coverage and does not pin the slot', is(await s({ ...codexFx({ head: A2, current: 'I2', history: [{ sha: null, at: 'x', status: 'completed' }], marker: null }), codexState: { commitSha: A2, status: 'running', at: T('10:05'), commentId: 9 }, requests: [req('codex', '10:01')], now: T('10:32') }), 'needs-substitute'))
  ok('latest usable review on an older identity -> not covered (ordinary push not yet reviewed)', (await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [cr(A1, '09:30')] })).status === 'pending')
  ok('reviews from another login are not CodeRabbit evidence', (await s({ bot: 'coderabbit', head: A2, current: 'I2', reviews: [review('mallory', A2, '10:05')] })).status === 'pending')
  // 30-minute boundary and clocks.
  ok('exactly 30 minutes -> needs-substitute', (await s({ ...at29, now: T('10:30') })).status === 'needs-substitute')
  ok('a CodeRabbit check that succeeded is no terminal failure', (await s({ ...crRateLimited, coderabbitCheck: { conclusion: 'success', title: 'ok' } })).status === 'pending')
  for (const c of ['skipped', 'failure', 'cancelled', 'timed_out', 'action_required']) {
    ok(`CodeRabbit check ${c} -> needs-substitute`, (await s({ ...crRateLimited, coderabbitCheck: { conclusion: c, title: 'x' } })).status === 'needs-substitute')
  }
  ok('Gemini on a fork or Dependabot PR -> needs-substitute', (await s({ ...geminiDraft, pr: { fork: true } })).status === 'needs-substitute' && (await s({ ...geminiDraft, pr: { dependabot: true } })).status === 'needs-substitute')
  ok('a covered Gemini slot on a draft PR stays covered', (await s({ ...geminiDraft, geminiVerdicts: [verdict(A2, 'I2', 'no-findings', '10:01')] })).status === 'covered')
  ok('Gemini, nothing yet at 10 minutes -> pending', (await s({ bot: 'gemini', head: A2, current: 'I2' })).status === 'pending')
  ok('Gemini with a queued run at 31 minutes -> pending', (await s({ ...geminiInFlightAt31, runs: [gemRun(A2, '10:00', 'queued')] })).status === 'pending')
  ok('Gemini in-progress run on another head does not hold', (await s({ ...geminiInFlightAt31, runs: [gemRun(F1, '10:00', 'in_progress')] })).status === 'needs-substitute')
  ok('Gemini in-progress run of another PR on the head does not hold', (await s({ ...geminiInFlightAt31, runs: [{ ...gemRun(A2, '10:00', 'in_progress'), prNumbers: [12] }] })).status === 'needs-substitute')
  ok('a dispatched run created before the head arrived does not hold', (await s({ ...geminiDispatchInFlightAt31, geminiDispatchRuns: [{ id: 5, status: 'in_progress', conclusion: null, createdAt: T('09:55') }] })).status === 'needs-substitute')
  ok('Gemini cancelled run but a verdict names the head -> not the job-timeout case', (await s({ ...geminiJobTimedOut, geminiVerdicts: [verdict(A2, 'I2', 'skipped-same-identity', '10:05')] })).status === 'pending')
  ok('Gemini cancelled run, a newer run in flight -> pending', (await s({ ...geminiJobTimedOut, runs: [gemRun(A2, '10:00', 'completed', 'cancelled'), gemRun(A2, '10:10', 'in_progress')] })).status === 'pending')
  ok('Gemini latest completed run succeeded after an earlier cancel -> not terminal', (await s({ ...geminiJobTimedOut, runs: [gemRun(A2, '10:00', 'completed', 'cancelled'), gemRun(A2, '10:10', 'completed', 'success')] })).status === 'pending')
  ok('Gemini could-not-run on another head is not a failure on this one', (await s({ ...geminiCouldNotRun, geminiVerdicts: [verdict(F1, 'IF1', 'could-not-run', '10:04')] })).status === 'pending')
  ok('a covered slot reports what it relies on', await (async () => { const r = await s(codexMarkerOnly); return typeof r.by === 'string' && r.by !== '' })())
  ok('an unknown bot throws', /bot/.test(await (async () => { try { await s({ bot: 'mallory', head: A2, current: 'I2' }); return '' } catch (e) { return e.message } })()))

  // headPushedAt edge cases
  ok('headPushedAt: runs only on other SHAs -> null', headPushedAt({ runs: [runOn(44, 'B', T('10:00'))], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: T('09:00') }) === null)
  ok('headPushedAt: an unparseable run time -> null (fail closed)', headPushedAt({ runs: [runOn(44, 'A', 'garbage')], pr: 44, head: 'A', headRepo: 'o/r', prCreatedAt: T('09:00') }) === null)
  ok('headPushedAt: an empty-list run is not matched by a null head repository', headPushedAt({ runs: [{ ...forkRun(null, 'A', T('10:00')) }], pr: 44, head: 'A', headRepo: null, prCreatedAt: T('09:00') }) === null)

  // requiredMet and constants
  ok('REQUIRED_BOTS matches §5.5', JSON.stringify(REQUIRED_BOTS) === JSON.stringify({ mechanical: [], standard: ['coderabbit|codex'], 'subtle-correctness': ['coderabbit', 'codex', 'gemini'] }))
  ok('mechanical needs nothing', requiredMet('mechanical', {}) === true)
  ok('standard with neither covered -> not met', requiredMet('standard', { coderabbit: 'pending', codex: 'needs-substitute' }) === false)
  ok('subtle-correctness needs all three (substituted counts)', requiredMet('subtle-correctness', { coderabbit: 'covered', codex: 'substituted', gemini: 'covered' }) === true && requiredMet('subtle-correctness', { coderabbit: 'covered', codex: 'covered', gemini: 'pending' }) === false)
  ok('an unknown depth is never met', requiredMet('bogus', { coderabbit: 'covered', codex: 'covered', gemini: 'covered' }) === false)
  ok('vendors: Codex openai, Gemini google, CodeRabbit none', BOT_VENDOR.codex === 'openai' && BOT_VENDOR.gemini === 'google' && BOT_VENDOR.coderabbit === null)

  // substituteOk: parts 1, 2 and 4 reused from review-evidence
  ok('substitute on a stale identity -> not ok', substituteOk({ bot: 'gemini', records: [sub('gemini', 'anthropic', { input: { kind: 'pr', identity: 'old' } })], currentIdentity: id, countedVendors: [] }) === false)
  ok('substitute that did not complete -> not ok', substituteOk({ bot: 'gemini', records: [sub('gemini', 'anthropic', { outcome: 'timeout', verdict: null })], currentIdentity: id, countedVendors: [] }) === false)
  ok('substitute for another slot does not fill this one', substituteOk({ bot: 'codex', records: [sub('gemini', 'anthropic')], currentIdentity: id, countedVendors: [] }) === false)
  ok('the author\'s vendor may substitute', substituteOk({ bot: 'codex', records: [sub('codex', 'anthropic')], currentIdentity: id, countedVendors: ['openai', 'google'] }) === true)
  ok('a gate-ID finding fixed by a record of the chain -> ok', substituteOk({ bot: 'codex', records: [sub('codex', 'anthropic', { findings: [{ id: 'thread:T1', severity: 'P1', summary: 's', disposition: { kind: 'fixed', by: 'substitute-codex--anthropic--1' } }] })], currentIdentity: id, countedVendors: [] }) === true)
  ok('a finding fixed by a record outside the chain -> not ok', substituteOk({ bot: 'codex', records: [sub('codex', 'anthropic', { findings: [{ id: 'thread:T1', severity: 'P1', summary: 's', disposition: { kind: 'fixed', by: 'elsewhere' } }] })], currentIdentity: id, countedVendors: [] }) === false)
  ok('a superseded open head is replaced by its passing successor', substituteOk({ bot: 'codex', records: [subWithOpenP1Codex(), sub('codex', 'anthropic', { stem: 'substitute-codex--anthropic--2', supersedes: 'substitute-codex--x--1' })], currentIdentity: id, countedVendors: [] }) === true)
  ok('an open head beside a passing one -> not ok (as review-evidence)', substituteOk({ bot: 'codex', records: [subWithOpenP1Codex(), sub('codex', 'anthropic')], currentIdentity: id, countedVendors: [] }) === false)
  ok('an invalid record -> not ok', substituteOk({ bot: 'codex', records: [sub('codex', 'anthropic'), { stem: 'bad', invalid: ['x'] }], currentIdentity: id, countedVendors: [] }) === false)
  ok('no records -> not ok', substituteOk({ bot: 'codex', records: [], currentIdentity: id, countedVendors: [] }) === false)
  function subWithOpenP1Codex() { return sub('codex', 'openai', { stem: 'substitute-codex--x--1', verdict: 'fail', findings: [{ id: 'thread:T1', severity: 'P1', summary: 'open' }] }) }

  // diffTooLarge boundary
  ok('exactly 400,000 bytes is not too large; 400,001 is', (await geminiDiff(limitRepo)).length === GEMINI_DIFF_LIMIT && (await diffTooLarge(limitRepo)) === false && (await geminiDiff(bigRepo)).length === GEMINI_DIFF_LIMIT + 1)
  ok('the same gate on a small diff passes with the substitutes (control for the size test)', (await evaluateGateLike({ ...bigWithSubs, repo: binRenameRepo })).ok === true)

  // makeIdentityOf / makeIsAncestor against a real origin
  const origin = newRepo('origin')
  writeFileSync(join(origin, 'a.txt'), 'a\n'); g(origin, ['add', 'a.txt']); g(origin, ['commit', '-q', '-m', 'o0'])
  const clone = join(tmp, 'clone')
  g(tmp, ['clone', '-q', origin, clone])
  writeFileSync(join(origin, 'a.txt'), 'a\nb\n'); g(origin, ['commit', '-q', '-am', 'o1'])
  const O1 = g(origin, ['rev-parse', 'HEAD'])
  const O0 = g(origin, ['rev-parse', 'HEAD~1'])
  const idOf = makeIdentityOf({ cwd: clone, base: O0 })
  ok('identityOf fetches a missing commit from origin and computes its identity', (await idOf(O1)) === await inputIdentity({ cwd: origin, base: O0, head: O1 }))
  ok('identityOf returns null for a commit origin does not have', (await idOf(UNFETCHABLE)) === null)
  ok('identityOf refuses a non-SHA argument without running git on it', (await idOf('--upload-pack=touch /tmp/x')) === null)
  ok('identityOf caches per SHA', (await idOf(O1)) === (await idOf(O1)))
  ok('isAncestor: real ancestry', (await isAncestor(A1, A2)) === true && (await isAncestor(A2, A1)) === false && (await isAncestor(A2, F1)) === false)
  ok('isAncestor: an unfetchable commit is not an ancestor', (await isAncestor(UNFETCHABLE, A2)) === false)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (fail) { console.log(`coverage: ${fail} FAILED, ${pass} passed`); process.exit(1) }
console.log(`coverage: ${pass} passed`)
