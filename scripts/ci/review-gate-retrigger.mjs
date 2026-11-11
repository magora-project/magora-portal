// review-gate-retrigger (plan Task 23, gate point 2; spec §5.5 "A bot review that arrives after the record").
// Gemini's verdict and Codex's clean-review marker are issue comments, which start no review-gate run. This re-runs
// the latest `review-gate` run on the PR's CURRENT head when either lands, so the gate re-reads the live state (a
// verdict on an older head still matters: review-gate collects findings from every usable Gemini verdict).
//
// Triggers (.github/workflows/review-gate-retrigger.yml): `workflow_run` of `Gemini review` (completed), and
// `issue_comment` (created, edited) on a PR by chatgpt-codex-connector[bot] carrying `codex-review-state:v1`. The
// workflow checks out only this file from the default branch, never PR code, and holds `actions: write` (to re-run)
// with read-only contents and pull requests. This script reads the event JSON and calls the REST API; it executes
// nothing from the event, and it uses no import beyond Node's own, so the sparse checkout is all it needs.
//
// PR resolution: the comment's issue number; else the workflow run's `pull_requests`; else (a dispatched Gemini run,
// which has none) its display_title `Gemini review PR #<n>`; else the one open PR whose head branch and head repository
// match the run's. Then the PR's current head, and the latest review-gate run (event pull_request) on it. A run still
// queued or in progress is polled for up to ten minutes and then re-run: a run already past its API reads would miss
// the new comment. Outcomes: `rerun`, or `none` with a reason (no open PR; no gate run on the head, which the next push
// creates). An API error, or a run still unfinished after the limit, exits 1. When a run lists several PRs, each is
// attempted at once and independently; any failure exits 1 after the others are re-run.
//
// Run (CI): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo GITHUB_EVENT_NAME=… GITHUB_EVENT_PATH=… node scripts/ci/review-gate-retrigger.mjs
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const CODEX_LOGIN = 'chatgpt-codex-connector[bot]'
export const CODEX_MARKER = 'codex-review-state:v1'
export const GEMINI_WORKFLOW = 'Gemini review'
// A run is matched to the workflow by its path, never its `name`: gemini-review.yml sets a `run-name`, and the API
// reports that run name (`Gemini review PR #<n>`) as the run's `name` (issue #97).
export const GEMINI_WORKFLOW_PATH = '.github/workflows/gemini-review.yml'
export const GATE_WORKFLOW_FILE = 'review-gate.yml'
export const POLL_INTERVAL_MS = 15_000
export const POLL_LIMIT_MS = 10 * 60 * 1000
const DISPATCH_TITLE = /^Gemini review PR #(\d+)$/

// The REST calls retrigger needs. Every error throws (the job then fails, visibly).
export function makeApi({ repo, token, fetchImpl = fetch, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const call = async (path, method = 'GET') => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} on ${method} ${path.split('?')[0]}`)
    return method === 'GET' ? res.json() : null
  }
  const pages = async (path, key) => {
    const all = []
    for (let page = 1; ; page++) {
      const body = await call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      const list = key ? body?.[key] : body
      if (!Array.isArray(list)) throw new Error(`GitHub API: no list in the reply to ${path.split('?')[0]}`)
      all.push(...list)
      if (list.length < 100) return all
    }
  }
  return {
    pr: (n) => call(`/pulls/${n}`),
    openPrs: () => pages('/pulls?state=open'),
    gateRuns: async ({ headSha }) => (await pages(`/actions/workflows/${GATE_WORKFLOW_FILE}/runs?event=pull_request&head_sha=${headSha}`, 'workflow_runs'))
      .map((r) => ({
        id: r.id, status: r.status, createdAt: r.created_at, headBranch: r.head_branch, headRepo: r.head_repository?.full_name,
        prNumbers: (r.pull_requests ?? []).map((p) => p?.number).filter((x) => Number.isInteger(x)),
      })),
    run: async (id) => { const r = await call(`/actions/runs/${id}`); return { id: r.id, status: r.status } },
    rerun: (id) => call(`/actions/runs/${id}/rerun`, 'POST'),
    sleep: sleepImpl,
  }
}

const none = (reason) => ({ action: 'none', reason })

// The PR an event is about: { n } or { reason } when there is none to act on.
async function prOf({ event, payload, api }) {
  if (event === 'issue_comment') {
    const c = payload?.comment, issue = payload?.issue
    if (!issue?.pull_request) return { reason: 'the comment is on an issue, not a pull request' }
    if (c?.user?.login !== CODEX_LOGIN) return { reason: `the comment is by ${c?.user?.login ?? 'nobody'}, not ${CODEX_LOGIN}` }
    if (typeof c.body !== 'string' || !c.body.includes(CODEX_MARKER)) return { reason: `the comment carries no ${CODEX_MARKER} marker` }
    return { n: issue.number }
  }
  if (event === 'workflow_run') {
    const run = payload?.workflow_run
    if (run?.path !== GEMINI_WORKFLOW_PATH) return { reason: `the run is of ${JSON.stringify(run?.path)}, not ${GEMINI_WORKFLOW_PATH}` }
    const listed = (run.pull_requests ?? []).map((p) => p?.number).filter((x) => Number.isInteger(x))
    // A run on a commit two PRs share lists both: each one's gate is re-run.
    if (listed.length) return { ns: [...new Set(listed)] }
    const t = DISPATCH_TITLE.exec(run.display_title ?? '')
    if (t) return { n: Number(t[1]) }
    const repoName = run.head_repository?.full_name
    const match = (await api.openPrs()).filter((p) => p.head?.ref === run.head_branch && typeof repoName === 'string' && p.head?.repo?.full_name === repoName)
    if (match.length !== 1) return { reason: match.length ? `several open PRs have head ${repoName}:${run.head_branch}` : `no open PR has head ${repoName}:${run.head_branch}` }
    return { n: match[0].number }
  }
  return { reason: `event ${event} is not handled` }
}

export async function retrigger({ event, payload, api }) {
  const which = await prOf({ event, payload, api })
  if (which.reason) return none(which.reason)
  if (which.ns) {
    if (which.ns.length === 1) return retriggerPr({ n: which.ns[0], api })
    // Each listed PR is attempted independently and at the same time (issue #91): one PR's stalled or failing gate run
    // neither stops the others nor delays them, and the total wait stays within one polling limit, inside the job's
    // 15-minute deadline. Every failure is reported at the end, after the other PRs' re-runs are made.
    const settled = await Promise.allSettled(which.ns.map((n) => retriggerPr({ n, api })))
    const results = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)
    const failures = settled.flatMap((s, i) => (s.status === 'rejected' ? [`PR #${which.ns[i]}: ${s.reason?.message ?? s.reason}`] : []))
    const reran = results.filter((x) => x.action === 'rerun')
    const reason = results.map((x) => x.reason).join('; ')
    if (failures.length) throw new Error(`${failures.join('; ')}${reason ? ` (the other PRs: ${reason})` : ''}`)
    return { action: reran.length ? 'rerun' : 'none', runIds: reran.map((x) => x.runId), reason }
  }
  return retriggerPr({ n: which.n, api })
}

async function retriggerPr({ n, api }) {
  if (!Number.isInteger(n) || n <= 0) return none('no pull request number')
  const pr = await api.pr(n)
  if (pr?.state !== 'open') return none(`PR #${n} is not open`)
  const head = pr.head?.sha
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) throw new Error(`PR #${n}: the API reply has no head SHA`)
  // Only this PR's runs: two PRs can share a head commit. A run that names no PR (a fork PR's run lists none) counts only
  // when its head branch and head repository are this PR's; one whose branch or repository is unknown, or another's, is
  // left out (two fork PRs can share a head commit too), so it is never re-run as this PR's.
  const repoName = pr.head?.repo?.full_name
  const ours = (r) => Array.isArray(r.prNumbers) && r.prNumbers.length > 0
    ? r.prNumbers.includes(n)
    : typeof r.headBranch === 'string' && r.headBranch === pr.head?.ref && typeof repoName === 'string' && r.headRepo === repoName
  const runs = (await api.gateRuns({ headSha: head })).filter(ours)
  if (runs.length === 0) return none(`no review-gate run of PR #${n} (its own number, or ${repoName ?? 'an unknown repository'}:${pr.head?.ref ?? '?'} for a run that names no PR) on its head ${head.slice(0, 12)}: the next push runs it`)
  const latest = runs.reduce((a, b) => (b.id > a.id ? b : a))
  let status = latest.status
  for (let waited = 0; status !== 'completed'; waited += POLL_INTERVAL_MS) {
    if (waited >= POLL_LIMIT_MS) throw new Error(`review-gate run ${latest.id} on PR #${n} is still in progress (${status}) after ${POLL_LIMIT_MS / 60_000} minutes; re-run it by hand`)
    await api.sleep(POLL_INTERVAL_MS)
    status = (await api.run(latest.id)).status
  }
  await api.rerun(latest.id)
  return { action: 'rerun', runId: latest.id, reason: `re-ran review-gate run ${latest.id} on PR #${n}'s head ${head.slice(0, 12)}` }
}

export async function main({ env = process.env, fetchImpl = fetch, sleepImpl } = {}) {
  const say = (s) => console.log(`review-gate-retrigger: ${s}`)
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: path } = env
  if (!token || !repo || !event || !path) { say('FAIL: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required'); return 1 }
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'))
    const r = await retrigger({ event, payload, api: makeApi({ repo, token, fetchImpl, ...(sleepImpl ? { sleepImpl } : {}) }) })
    say(`${r.action}: ${r.reason}`)
    return 0
  } catch (e) {
    say(`FAIL: ${e && e.message}`)
    return 1
  }
}

const isMain = () => {
  if (process.argv[1] === undefined) return false
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
if (isMain()) process.exitCode = await main()
