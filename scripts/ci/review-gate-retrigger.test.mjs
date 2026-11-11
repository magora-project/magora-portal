// Self-test for scripts/ci/review-gate-retrigger.mjs (plan Task 23, gate point 2). The GitHub API is a stub object
// (and, for main(), a stubbed fetchImpl); nothing touches the network.
// Run: node scripts/ci/review-gate-retrigger.test.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CODEX_LOGIN, POLL_INTERVAL_MS, POLL_LIMIT_MS, main, makeApi, retrigger } from './review-gate-retrigger.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(40)
// A stub API for one open PR #44 (head HEAD, branch feat, repo o/r) with one completed review-gate run (id 501) on HEAD.
const makeStub = ({ gateStatus = ['completed'], prState = 'open', runs = true } = {}) => {
  const api = {
    prRead: null, reruns: [], polls: 0, sleeps: 0, currentHeadRunId: 501,
    pr: async (n) => { api.prRead = n; return { number: n, state: prState, head: { sha: HEAD, ref: 'feat', repo: { full_name: 'o/r' } } } },
    openPrs: async () => [{ number: 44, state: 'open', head: { sha: HEAD, ref: 'feat', repo: { full_name: 'o/r' } } }],
    gateRuns: async ({ headSha }) => (runs && headSha === HEAD ? [{ id: 400, status: 'completed', createdAt: '2026-11-05T09:00:00Z', headBranch: 'feat', headRepo: 'o/r' }, { id: 501, status: gateStatus[0], createdAt: '2026-11-05T10:00:00Z', headBranch: 'feat', headRepo: 'o/r' }] : []),
    run: async (id) => { api.polls++; return { id, status: gateStatus[Math.min(api.polls, gateStatus.length - 1)] } },
    rerun: async (id) => { api.reruns.push(id) },
    sleep: async () => { api.sleeps++ },
  }
  return api
}
const oneGateRun = makeStub()
const gateInProgressThenDone = makeStub({ gateStatus: ['in_progress', 'in_progress', 'completed'] })

const wfRun = (over = {}) => ({ workflow_run: { name: 'Gemini review', event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: HEAD, head_branch: 'feat', head_repository: { full_name: 'o/r' }, display_title: 'Gemini review PR #44', pull_requests: [{ number: 44 }], ...over } })
const geminiDoneOnHead = wfRun()
const geminiDoneOnOldHead = wfRun({ head_sha: OLD })
const geminiDispatchDone = wfRun({ event: 'workflow_dispatch', pull_requests: [], head_branch: 'main', head_sha: 'c'.repeat(40) })
const codexMarkerComment = { issue: { number: 44, pull_request: { url: 'x' } }, comment: { id: 9, user: { login: CODEX_LOGIN }, body: '<!-- codex-review-state:v1 {"code_review":{"commit_sha":"x","status":"completed"}} -->' } }

ok('retrigger: Gemini completed on the current head -> reruns the latest review-gate run on it', (await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api: oneGateRun })).action === 'rerun')
ok('... the run re-run is the latest one, and it is re-run once', oneGateRun.reruns.join() === '501')
ok('retrigger: Codex marker comment -> rerun; another login\'s comment with the marker -> none', (await retrigger({ event: 'issue_comment', payload: codexMarkerComment, api: oneGateRun })).action === 'rerun' && (await retrigger({ event: 'issue_comment', payload: { ...codexMarkerComment, comment: { ...codexMarkerComment.comment, user: { login: 'mallory' } } }, api: oneGateRun })).action === 'none')
ok('retrigger: a verdict on a superseded head still reruns the current head\'s gate run', await (async () => { const r = await retrigger({ event: 'workflow_run', payload: geminiDoneOnOldHead, api: oneGateRun }); return r.action === 'rerun' && r.runId === oneGateRun.currentHeadRunId })())
ok('retrigger: a dispatched Gemini run (no pull_requests) resolves its PR from display_title', await (async () => { const r = await retrigger({ event: 'workflow_run', payload: geminiDispatchDone, api: oneGateRun }); return r.action === 'rerun' && oneGateRun.prRead === 44 })())
ok('retrigger: the gate run is in progress -> waits, then reruns it', await (async () => { const r = await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api: gateInProgressThenDone }); return r.action === 'rerun' && gateInProgressThenDone.polls > 0 })())

// Negative and edge cases.
ok('a Codex comment without the marker -> none', (await retrigger({ event: 'issue_comment', payload: { ...codexMarkerComment, comment: { ...codexMarkerComment.comment, body: 'Codex says hi' } }, api: makeStub() })).action === 'none')
ok('a Codex marker on an issue (not a PR) -> none', (await retrigger({ event: 'issue_comment', payload: { ...codexMarkerComment, issue: { number: 44 } }, api: makeStub() })).action === 'none')
ok('a closed PR -> none, naming it', await (async () => { const r = await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api: makeStub({ prState: 'closed' }) }); return r.action === 'none' && /open/.test(r.reason) })())
ok('no gate run on the current head -> none, naming the next push', await (async () => { const api = makeStub({ runs: false }); const r = await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api }); return r.action === 'none' && /push/.test(r.reason) && api.reruns.length === 0 })())
ok('a workflow_run with no PR list and no title resolves its PR by head branch and head repository', await (async () => { const api = makeStub(); const r = await retrigger({ event: 'workflow_run', payload: wfRun({ pull_requests: [], display_title: 'something' }), api }); return r.action === 'rerun' && api.prRead === 44 })())
ok('... but not from another head repository', (await retrigger({ event: 'workflow_run', payload: wfRun({ pull_requests: [], display_title: 'x', head_repository: { full_name: 'evil/r' } }), api: makeStub() })).action === 'none')
ok('a run of another workflow -> none', (await retrigger({ event: 'workflow_run', payload: wfRun({ name: 'ci' }), api: makeStub() })).action === 'none')
ok('a gate run still in progress after the polling limit -> throws (exit 1), no rerun', await (async () => {
  const api = makeStub({ gateStatus: ['in_progress'] })
  try { await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api }); return false } catch (e) { return /in progress/.test(e.message) && api.reruns.length === 0 && api.sleeps >= 1 }
})())
ok('the polling limit is ten minutes', POLL_LIMIT_MS === 10 * 60 * 1000)

// makeApi: the REST calls it makes. Only the rerun is a POST.
const calls = []
const fetchStub = async (url, init = {}) => {
  calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}${new URL(url).search}`)
  const u = new URL(url)
  const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b })
  if (u.pathname === '/repos/o/r/pulls/44') return json({ number: 44, state: 'open', head: { sha: HEAD, ref: 'feat', repo: { full_name: 'o/r' } } })
  if (u.pathname === '/repos/o/r/actions/workflows/review-gate.yml/runs') return json({ total_count: 1, workflow_runs: [{ id: 501, status: 'completed', created_at: '2026-11-05T10:00:00Z', head_sha: HEAD, head_branch: 'feat', head_repository: { full_name: 'o/r' }, event: 'pull_request', pull_requests: [{ number: 44 }] }] })
  if (u.pathname === '/repos/o/r/actions/runs/501/rerun') return { ok: true, status: 201, json: async () => ({}) }
  return json({ message: 'nope' }, 404)
}
const api = makeApi({ repo: 'o/r', token: 't', fetchImpl: fetchStub, sleepImpl: async () => {} })
ok('makeApi: gateRuns reads review-gate.yml runs for the head SHA, event pull_request', await (async () => { const r = await api.gateRuns({ headSha: HEAD }); return r.length === 1 && r[0].id === 501 && r[0].prNumbers.join() === '44' && r[0].headBranch === 'feat' && r[0].headRepo === 'o/r' && calls.some((c) => c.includes('/actions/workflows/review-gate.yml/runs') && c.includes(`head_sha=${HEAD}`) && c.includes('event=pull_request')) })())
ok('makeApi: rerun POSTs to the run\'s rerun endpoint', await (async () => { await api.rerun(501); return calls.includes('POST /repos/o/r/actions/runs/501/rerun') })())
ok('makeApi: an API error throws', await (async () => { try { await makeApi({ repo: 'o/r', token: 't', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }).pr(44); return false } catch (e) { return /403/.test(e.message) } })())

// Correctness review 7abdac72c3eb F1: two PRs sharing a head commit. Only PR #44's run is re-run, even when another
// PR's run on the same commit is newer; a run naming no PR (a fork's) stays a candidate.
ok('a newer gate run of another PR on the same head is not re-run', await (async () => {
  const s = makeStub()
  s.gateRuns = async () => [{ id: 501, status: 'completed', createdAt: '2026-11-05T10:00:00Z', prNumbers: [44] }, { id: 600, status: 'completed', createdAt: '2026-11-05T11:00:00Z', prNumbers: [45] }]
  const r = await retrigger({ event: 'issue_comment', payload: codexMarkerComment, api: s })
  return r.action === 'rerun' && s.reruns.join() === '501'
})())
ok('a gate run naming no PR (a fork PR\'s) on this PR\'s head branch and repository is still re-run', await (async () => {
  const s = makeStub()
  s.gateRuns = async () => [{ id: 700, status: 'completed', createdAt: '2026-11-05T10:00:00Z', prNumbers: [], headBranch: 'feat', headRepo: 'o/r' }]
  const r = await retrigger({ event: 'issue_comment', payload: codexMarkerComment, api: s })
  return r.action === 'rerun' && s.reruns.join() === '700'
})())
// Codex marker review of #92 at 26b9625: two fork PRs sharing a head commit both have runs that name no PR.
ok('a run naming no PR on another branch is not this PR\'s, even when newer (two fork PRs share the head)', await (async () => {
  const s = makeStub()
  s.pr = async (n) => ({ number: n, state: 'open', head: { sha: HEAD, ref: 'fix-a', repo: { full_name: 'fork/r' } } })
  s.gateRuns = async () => [{ id: 501, status: 'completed', prNumbers: [], headBranch: 'fix-a', headRepo: 'fork/r' }, { id: 600, status: 'completed', prNumbers: [], headBranch: 'fix-b', headRepo: 'fork/r' }]
  const r = await retrigger({ event: 'issue_comment', payload: codexMarkerComment, api: s })
  return r.action === 'rerun' && s.reruns.join() === '501'
})())
ok('a run naming no PR from another repository, or with no branch or repository, is never re-run', await (async () => {
  const s = makeStub()
  s.gateRuns = async () => [{ id: 600, status: 'completed', prNumbers: [], headBranch: 'feat', headRepo: 'other/r' }, { id: 601, status: 'completed', prNumbers: [] }]
  const r = await retrigger({ event: 'issue_comment', payload: codexMarkerComment, api: s })
  return r.action === 'none' && s.reruns.length === 0 && /no review-gate run of PR #44/.test(r.reason)
})())

ok('a Gemini run listing two PRs re-runs each PR\'s own gate run', await (async () => {
  const s = makeStub()
  s.pr = async (n) => ({ number: n, state: 'open', head: { sha: HEAD, ref: `b${n}`, repo: { full_name: 'o/r' } } })
  s.gateRuns = async () => [{ id: 501, status: 'completed', createdAt: '2026-11-05T10:00:00Z', prNumbers: [44] }, { id: 600, status: 'completed', createdAt: '2026-11-05T11:00:00Z', prNumbers: [45] }]
  const r = await retrigger({ event: 'workflow_run', payload: { ...geminiDoneOnHead, workflow_run: { ...geminiDoneOnHead.workflow_run, pull_requests: [{ number: 44 }, { number: 45 }] } }, api: s })
  return r.action === 'rerun' && s.reruns.join() === '501,600'
})())

// Issue #91: a Gemini run listing two PRs whose first PR's gate run stalls past the polling limit. The second PR's
// completed run is still re-run, the failure is reported (throws, exit 1), and the total wait is one polling limit.
const twoPrsFirstStalled = () => {
  const s = makeStub()
  s.pr = async (n) => ({ number: n, state: 'open', head: { sha: HEAD, ref: `b${n}`, repo: { full_name: 'o/r' } } })
  s.gateRuns = async () => [{ id: 501, status: 'in_progress', prNumbers: [44] }, { id: 600, status: 'completed', prNumbers: [45] }]
  s.run = async (id) => { s.polls++; return { id, status: id === 501 ? 'in_progress' : 'completed' } }
  return s
}
const twoPrs = (s) => retrigger({ event: 'workflow_run', payload: { ...geminiDoneOnHead, workflow_run: { ...geminiDoneOnHead.workflow_run, pull_requests: [{ number: 44 }, { number: 45 }] } }, api: s })
ok('#91: a stalled first PR does not stop the second PR\'s re-run; the stall is still reported', await (async () => {
  const s = twoPrsFirstStalled()
  try { await twoPrs(s); return false } catch (e) { return s.reruns.join() === '600' && /PR #44: .*in progress/.test(e.message) && /re-ran review-gate run 600/.test(e.message) }
})())
// Both stalled: the PRs are polled side by side (PR #45's first poll comes before PR #44's last), so the total wait is
// one polling limit, not one per PR; each polls up to the limit, and both stalls are reported.
ok('#91: two stalled PRs are polled side by side, within one polling limit, and both are reported', await (async () => {
  const s = twoPrsFirstStalled(), order = []
  s.gateRuns = async () => [{ id: 501, status: 'in_progress', prNumbers: [44] }, { id: 600, status: 'in_progress', prNumbers: [45] }]
  s.run = async (id) => { order.push(id); return { id, status: 'in_progress' } }
  s.sleep = async () => { s.sleeps++; await new Promise((r) => setImmediate(r)) }
  try { await twoPrs(s); return false } catch (e) {
    const limit = POLL_LIMIT_MS / POLL_INTERVAL_MS
    return order.indexOf(600) < order.lastIndexOf(501) && order.filter((x) => x === 501).length === limit && order.filter((x) => x === 600).length === limit
      && /PR #44: .*run 501/.test(e.message) && /PR #45: .*run 600/.test(e.message) && s.reruns.length === 0
  }
})())
ok('#91: an API error on one listed PR does not stop the other\'s re-run', await (async () => {
  const s = makeStub()
  s.pr = async (n) => { if (n === 44) throw new Error('GitHub API 502 on GET /pulls/44'); return { number: n, state: 'open', head: { sha: HEAD, ref: `b${n}`, repo: { full_name: 'o/r' } } } }
  s.gateRuns = async () => [{ id: 600, status: 'completed', prNumbers: [45] }]
  try { await twoPrs(s); return false } catch (e) { return s.reruns.join() === '600' && /PR #44: GitHub API 502/.test(e.message) }
})())
ok('#91: a single listed PR whose run stalls throws its own message unchanged', await (async () => {
  const s = makeStub({ gateStatus: ['in_progress'] })
  try { await retrigger({ event: 'workflow_run', payload: geminiDoneOnHead, api: s }); return false } catch (e) { return /^review-gate run 501 on PR #44 is still in progress/.test(e.message) }
})())

// The workflow's trust boundary, read from the file: it is what keeps PR code away from the write token.
// CRLF normalised: a Windows checkout (core.autocrlf=true) rewrites the file's line endings.
const wf = readFileSync(new URL('../../.github/workflows/review-gate-retrigger.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const permissions = (/^permissions:\n((?: {2}.*\n)+)/m.exec(wf)?.[1] ?? '').trim().split('\n').map((l) => l.trim()).sort().join('|')
ok('workflow: permissions are exactly actions: write, contents: read, pull-requests: read', permissions ==='actions: write|contents: read|pull-requests: read')
ok('workflow: triggers are workflow_run of Gemini review (completed) and issue_comment (created, edited) only', /^on:\n {2}workflow_run:\n {4}workflows: \['Gemini review'\]\n {4}types: \[completed\]\n {2}issue_comment:\n {4}types: \[created, edited\]\npermissions:/m.test(wf.replace(/\n\n/g, '\n')))
ok('workflow: the if: admits only the Codex bot\'s PR comment carrying the marker', /github\.event\.issue\.pull_request &&\s+github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]' &&\s+contains\(github\.event\.comment\.body, 'codex-review-state:v1'\)/.test(wf))
ok('workflow: one checkout, of the default branch, without credentials, sparse to the script and .nvmrc', (wf.match(/actions\/checkout@/g) ?? []).length === 1 && /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(wf) && /persist-credentials: false/.test(wf) && /sparse-checkout: \|\n\s+scripts\/ci\/review-gate-retrigger\.mjs\n\s+\.nvmrc\n\s+sparse-checkout-cone-mode: false/.test(wf))
ok('workflow: concurrency is on the job (a comment the if: skips joins no group), one key form per PR, queued not cancelled', !/^concurrency:/m.test(wf)
  && /^ {4}concurrency:\n(?: {6}#.*\n)? {6}group: "review-gate-retrigger-\$\{\{ github\.event_name == 'issue_comment' && format\('Gemini review PR #\{0\}', github\.event\.issue\.number\) \|\| github\.event\.workflow_run\.display_title \|\| github\.run_id \}\}"\n {6}cancel-in-progress: false$/m.test(wf))
ok('workflow: the key form matches the Gemini run-name (display_title of every Gemini run)', /^run-name: 'Gemini review PR #\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr_number \}\}'$/m.test(readFileSync(new URL('../../.github/workflows/gemini-review.yml', import.meta.url), 'utf8')))
ok('workflow: no event text reaches a shell', !/run:.*\$\{\{/.test(wf) && !/pull_request_target/.test(wf))
ok('the script imports nothing outside Node (the sparse checkout holds only it)', [...readFileSync(new URL('./review-gate-retrigger.mjs', import.meta.url), 'utf8').matchAll(/^import .* from '([^']+)'/gm)].every((m) => m[1].startsWith('node:')))

// main(): the event comes from GITHUB_EVENT_PATH; output is one line, exit 0 for rerun/none, 1 for an error.
const tmp = mkdtempSync(join(tmpdir(), 'retrigger-test-'))
try {
  const evFile = join(tmp, 'event.json')
  writeFileSync(evFile, JSON.stringify({ ...geminiDoneOnHead, workflow_run: { ...geminiDoneOnHead.workflow_run, pull_requests: [{ number: 44 }] } }))
  const quiet = async (fn) => {
    const { log, error } = console
    const out = []
    console.log = console.error = (...a) => out.push(a.join(' '))
    try { return { code: await fn(), out: out.join('\n') } } finally { console.log = log; console.error = error }
  }
  const env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: evFile }
  ok('main: reruns through the REST API, exit 0', await (async () => { calls.length = 0; const r = await quiet(() => main({ env, fetchImpl: fetchStub, sleepImpl: async () => {} })); return r.code === 0 && /rerun/.test(r.out) && calls.includes('POST /repos/o/r/actions/runs/501/rerun') })())
  ok('main: an API error -> exit 1', (await quiet(() => main({ env, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), sleepImpl: async () => {} }))).code === 1)
  ok('main: missing env -> exit 1', (await quiet(() => main({ env: {} }))).code === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
