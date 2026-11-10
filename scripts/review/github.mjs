// Read-only layer over GitHub for the PR review gate (spec §5.5): reviews, issue comments, review
// threads, check runs, workflow runs and the bots' markers. Every list is read through every page,
// and every API error throws, so a caller never mistakes a short read for a complete one (fail
// closed). The one exception is codexHistory, which reports `complete: false` instead of throwing.
// Nothing here writes to GitHub. Task 22 (slot coverage) and Task 23 (review-gate) consume it.
//
// Every reader takes `{ repo: 'owner/name', pr, token, fetchImpl = fetch }` plus its own argument.
import { CODERABBIT_LOGIN, CODEX_LOGIN, crLabelIn } from './severity.mjs'

export const GEMINI_LOGIN = 'github-actions[bot]'

const API = 'https://api.github.com'

async function http(fetchImpl, token, url, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${init.method ?? 'GET'} ${new URL(url).pathname}`)
  return res.json()
}

const withPage = (base, page) => `${base}${base.includes('?') ? '&' : '?'}per_page=100&page=${page}`

// A REST endpoint that answers a bare array.
async function paginate(fetchImpl, token, base) {
  const all = []
  for (let page = 1; ; page++) {
    const batch = await http(fetchImpl, token, withPage(base, page))
    if (!Array.isArray(batch)) throw new Error('GitHub API returned a non-array list')
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

// A REST endpoint that answers `{ total_count, <key>: [...] }` (check runs, workflow runs).
async function paginateKey(fetchImpl, token, base, key) {
  const all = []
  for (let page = 1; ; page++) {
    const body = await http(fetchImpl, token, withPage(base, page))
    if (!Array.isArray(body?.[key])) throw new Error(`GitHub API response has no ${key} list`)
    all.push(...body[key])
    if (body[key].length < 100) return all
  }
}

async function graphql(fetchImpl, token, query, variables) {
  const body = await http(fetchImpl, token, `${API}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) })
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new Error(`GraphQL error: ${body.errors.map((e) => e?.message).join('; ')}`)
  }
  if (!body || typeof body.data !== 'object' || body.data === null) throw new Error('GraphQL response has no data')
  return body.data
}

const split = (repo) => String(repo ?? '').split('/')

// ---------------------------------------------------------------- reviews and comments

// Raw REST review objects -> the listReviews shape. `empty` is a blank body: a review that only
// carries inline comments, or none at all, says nothing the gate reads (plan V4).
export function listReviewsFrom(rawReviews) {
  return rawReviews.map((r) => {
    const body = r.body ?? ''
    return { id: r.id, login: r.user?.login ?? null, commitId: r.commit_id, submittedAt: r.submitted_at, body, empty: body.trim() === '' }
  })
}

export async function listReviews({ repo, pr, token, fetchImpl = fetch }) {
  return listReviewsFrom(await paginate(fetchImpl, token, `${API}/repos/${repo}/pulls/${pr}/reviews`))
}

export async function listIssueComments({ repo, pr, token, fetchImpl = fetch }) {
  const raw = await paginate(fetchImpl, token, `${API}/repos/${repo}/issues/${pr}/comments`)
  return raw.map((c) => ({ id: c.id, login: c.user?.login ?? null, body: c.body ?? '', createdAt: c.created_at, updatedAt: c.updated_at }))
}

// ---------------------------------------------------------------- review threads (GraphQL)

// `editor` is the comment's last editor and `lastEditedAt` the time of that edit (both null when never edited; an
// editor GitHub cannot name is null with a time): CodeRabbit marks a fix by editing its own first
// comment ("✅ Addressed in commit <sha>"), and review-gate accepts that only when the bot itself made the last edit.
const COMMENT_FIELDS = 'author { login __typename } editor { login __typename } lastEditedAt body url originalCommit { oid }'

const THREADS_QUERY = `query($owner: String!, $name: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved path
          resolvedBy { login }
          comments(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }
        }
      }
    }
  }
}`

// A thread's later comment pages, when it has more than 100 comments.
const THREAD_COMMENTS_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }
    }
  }
}`

// `originalCommit` is the commit the finding was reported on. The comment's `commit` is never read:
// GitHub re-anchors it to the newest head (PR #52 comment 4438353270).
// GraphQL names a Bot actor without the `[bot]` suffix that REST (and severity.mjs's logins) use: measured on PR #52,
// 2026-11-10, `author { login: "chatgpt-codex-connector", __typename: "Bot" }`. A Bot author gets the suffix, so
// the gate's login checks match; a User account of the same name keeps its plain login and is never a bot.
const authorLogin = (a) => {
  if (typeof a?.login !== 'string') return null
  return a.__typename === 'Bot' && !a.login.endsWith('[bot]') ? `${a.login}[bot]` : a.login
}
const comment = (c) => ({ login: authorLogin(c.author), editor: authorLogin(c.editor), lastEditedAt: c.lastEditedAt ?? null, body: c.body ?? '', url: c.url, originalCommit: c.originalCommit?.oid ?? null })

// Every comment of a thread: the first page from the threads query, then the rest by cursor. A short read throws.
async function threadComments(fetchImpl, token, t) {
  let page = t.comments
  const all = []
  for (;;) {
    if (!page || !Array.isArray(page.nodes) || !Number.isInteger(page.totalCount)) throw new Error(`GraphQL thread ${t.id} has no readable comments`)
    all.push(...page.nodes)
    if (!page.pageInfo?.hasNextPage) break
    const cursor = page.pageInfo.endCursor
    if (!cursor) throw new Error(`GraphQL thread ${t.id} comments have a next page but no cursor`)
    page = (await graphql(fetchImpl, token, THREAD_COMMENTS_QUERY, { id: t.id, cursor })).node?.comments
  }
  if (all.length < page.totalCount) throw new Error(`GraphQL thread ${t.id}: read ${all.length} of ${page.totalCount} comments`)
  return all.map(comment)
}

export async function listThreads({ repo, pr, token, fetchImpl = fetch }) {
  const [owner, name] = split(repo)
  const threads = []
  let cursor = null
  for (;;) {
    const data = await graphql(fetchImpl, token, THREADS_QUERY, { owner, name, pr: Number(pr), cursor })
    const page = data.repository?.pullRequest?.reviewThreads
    if (!page || !Array.isArray(page.nodes)) throw new Error('GraphQL response has no reviewThreads for the pull request')
    for (const t of page.nodes) {
      const comments = await threadComments(fetchImpl, token, t)
      const c = comments[0]
      threads.push({
        id: t.id, isResolved: t.isResolved, resolvedBy: t.resolvedBy?.login ?? null, path: t.path ?? null,
        firstComment: c ? { login: c.login, body: c.body, url: c.url, originalCommit: c.originalCommit } : null,
        comments: comments.map(({ login, editor, lastEditedAt, body }) => ({ login, editor, lastEditedAt, body })),
      })
    }
    if (!page.pageInfo?.hasNextPage) return threads
    cursor = page.pageInfo.endCursor
    if (!cursor) throw new Error('GraphQL reviewThreads has a next page but no cursor')
  }
}

// ---------------------------------------------------------------- checks and workflow runs

// The check run named `CodeRabbit` from app `coderabbitai` on `sha` (plan V3), newest first; null if
// there is none. A same-named run from another app is ignored.
export async function coderabbitCheck({ repo, token, sha, fetchImpl = fetch }) {
  const runs = await paginateKey(fetchImpl, token, `${API}/repos/${repo}/commits/${sha}/check-runs?check_name=CodeRabbit`, 'check_runs')
  const mine = runs.filter((r) => r.name === 'CodeRabbit' && r.app?.slug === 'coderabbitai').sort((a, b) => b.id - a.id)
  return mine.length ? { conclusion: mine[0].conclusion ?? null, title: mine[0].output?.title ?? null } : null
}

// Every `pull_request` run on the PR's head branch (gate point 1). Needs `actions: read`.
export async function prRuns({ repo, token, headRef, fetchImpl = fetch }) {
  const runs = await paginateKey(fetchImpl, token, `${API}/repos/${repo}/actions/runs?branch=${encodeURIComponent(headRef)}&event=pull_request`, 'workflow_runs')
  return runs.map((r) => ({
    id: r.id, name: r.name, event: r.event, status: r.status, conclusion: r.conclusion ?? null, headSha: r.head_sha,
    headRepo: r.head_repository?.full_name ?? null, createdAt: r.created_at, prNumbers: (r.pull_requests ?? []).map((p) => p.number),
  }))
}

// `workflow_dispatch` runs of gemini-review.yml for this PR; its run-name is `Gemini review PR #<n>`.
export async function geminiDispatchRuns({ repo, pr, token, fetchImpl = fetch }) {
  const runs = await paginateKey(fetchImpl, token, `${API}/repos/${repo}/actions/workflows/gemini-review.yml/runs?event=workflow_dispatch&branch=main`, 'workflow_runs')
  return runs
    .filter((r) => r.display_title === `Gemini review PR #${pr}`)
    .map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion ?? null, createdAt: r.created_at }))
}

// ---------------------------------------------------------------- Codex (plan V2)

const CODEX_MARKER = /^<!-- codex-review-state:v1 (\{.*\}) -->$/gm

const parseJson = (s) => { try { return JSON.parse(s) } catch { return null } }

// The latest `codex-review-state:v1` marker from the Codex bot's own comments. Only the marker is
// read, never the table beside it. `at` is the comment's `updatedAt`: Codex edits one comment.
export function codexState(comments) {
  let best = null
  for (const c of comments) {
    if (c.login !== CODEX_LOGIN) continue
    const found = [...(c.body ?? '').matchAll(CODEX_MARKER)]
    if (found.length !== 1) continue
    const m = parseJson(found[0][1])
    const sha = m?.code_review?.commit_sha
    if (typeof sha !== 'string' || sha === '') continue
    const at = Date.parse(c.updatedAt)
    if (best === null || at > best.time) {
      best = { time: at, state: { commitSha: sha, status: m.code_review.status ?? null, at: c.updatedAt, commentId: c.id } }
    }
  }
  return best?.state ?? null
}

const NODE_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on IssueComment {
      body updatedAt
      userContentEdits(first: 100, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { editedAt diff }
      }
    }
  }
}`

// Every `codex-review-state:v1` code_review entry the comment has ever held, as `{sha, at, status}`
// (`status` is code_review.status, or null). Entries are kept whatever their status: a `running`
// entry names a sha whose review has not finished, so consumers treat only `completed` entries as
// reviews. Each `userContentEdits` diff is the full comment body after that edit, not a unified diff.
// Sources: the current body (`at`: the comment's `updatedAt`) and each edit's diff (`at`: that
// edit's `editedAt`). `complete` is false
// when anything fails to read or the edits read fall short of `totalCount`; it never throws.
export async function codexHistory({ repo, token, commentId, fetchImpl = fetch }) {
  const reviews = []
  const add = (text, at) => {
    const entries = new Map()
    for (const m of (text ?? '').matchAll(/<!-- codex-review-state:v1 (\{.*?\}) -->/g)) {
      const cr = parseJson(m[1])?.code_review
      if (typeof cr?.commit_sha === 'string' && cr.commit_sha !== '') {
        entries.set(`${cr.commit_sha}|${cr.status ?? ''}`, { sha: cr.commit_sha, at, status: typeof cr.status === 'string' ? cr.status : null })
      }
    }
    reviews.push(...entries.values())
  }
  try {
    const comment = await http(fetchImpl, token, `${API}/repos/${repo}/issues/comments/${commentId}`)
    if (typeof comment?.node_id !== 'string') throw new Error('comment has no node_id')
    let cursor = null, seen = 0, total = 0, first = true
    for (;;) {
      const node = (await graphql(fetchImpl, token, NODE_QUERY, { id: comment.node_id, cursor })).node
      if (!node || typeof node.body !== 'string') throw new Error('comment node unreadable')
      if (first) { add(node.body, node.updatedAt); first = false }
      const edits = node.userContentEdits
      if (!edits || !Array.isArray(edits.nodes)) throw new Error('edit history unreadable')
      total = edits.totalCount
      for (const e of edits.nodes) add(e.diff, e.editedAt)
      seen += edits.nodes.length
      if (!edits.pageInfo?.hasNextPage) break
      cursor = edits.pageInfo.endCursor
      if (!cursor) throw new Error('edit history has a next page but no cursor')
    }
    return { reviews, complete: Number.isInteger(total) && seen >= total }
  } catch {
    return { reviews, complete: false }
  }
}

// ---------------------------------------------------------------- Gemini (Task 20 marker)

// The same pattern gemini-review.yml's skip step reads (a test pins them together).
const GEMINI_MARKER = /^<!-- gemini-review:v1 (\{.*\}) -->$/gm
const GEMINI_VERDICTS = new Set(['no-findings', 'findings', 'could-not-run', 'skipped-same-identity'])

const validFinding = (f) => f !== null && typeof f === 'object' && Number.isInteger(f.index) && (f.severity === 'P0' || f.severity === 'P1')

// Gemini's verdicts: one per unedited comment from `github-actions[bot]` that carries exactly one
// well-formed marker. An edited comment (`updatedAt` != `createdAt`) is ignored, as the workflow's
// skip step does: anyone with write access can edit a bot's comment. `identity` may be "" (the
// workflow writes that when it could not compute one); such a verdict parses, and its consumer must
// never count an empty identity as coverage.
export function geminiVerdicts(comments) {
  const out = []
  for (const c of comments) {
    if (c.login !== GEMINI_LOGIN || c.updatedAt !== c.createdAt) continue
    const found = [...(c.body ?? '').matchAll(GEMINI_MARKER)]
    if (found.length !== 1) continue
    const m = parseJson(found[0][1])
    if (m === null || typeof m !== 'object' || Array.isArray(m)) continue
    if (typeof m.head !== 'string' || m.head === '' || typeof m.identity !== 'string' || !GEMINI_VERDICTS.has(m.verdict)) continue
    if (!Array.isArray(m.findings) || !m.findings.every(validFinding)) continue
    out.push({
      head: m.head, identity: m.identity, verdict: m.verdict,
      findings: m.findings.map((f) => ({ index: f.index, severity: f.severity })), commentId: c.id, at: c.createdAt,
    })
  }
  return out
}

// ---------------------------------------------------------------- full-review requests

const REQUESTS = new Map([['@coderabbitai full review', 'coderabbit'], ['@codex review', 'codex']])

// A comment whose whole trimmed body is the request. Anything longer is not one.
export function fullReviewRequests(comments) {
  const out = []
  for (const c of comments) {
    const bot = REQUESTS.get((c.body ?? '').trim())
    if (bot) out.push({ bot, at: c.createdAt })
  }
  return out
}

// ---------------------------------------------------------------- CodeRabbit outside-diff findings

// CodeRabbit puts findings it cannot anchor inline under "Outside diff range comments (N)" in the
// review body, inside one blockquote (a CAUTION callout): the section is the run of `>` lines from
// the heading to the first line that is not quoted. Blocks that follow (Duplicate comments,
// Nitpicks, prompts) are not quoted and are not read. Each finding ends with
// `<!-- cr-comment:v1:<id> -->` and starts with a summary holding the severity and a `path:lines`
// line. The parsed count must equal the heading's N, else this throws (the gate cannot judge).
function outsideDiffSection(body) {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => /Outside diff range comments/.test(l))
  if (start === -1) return null
  let end = start
  while (end < lines.length && /^>/.test(lines[end])) end++
  return lines.slice(start, end).map((l) => l.replace(/^> ?/, '')).join('\n')
}

function findingsIn(body, reportedCommit, what) {
  const section = outsideDiffSection(body ?? '')
  if (section === null) return []
  const out = []
  let from = 0
  for (const m of section.matchAll(/<!-- cr-comment:v1:([0-9a-f]+) -->/g)) {
    const chunk = section.slice(from, m.index)
    from = m.index + m[0].length
    const path = /^`([^`\s]+?)(?::\d[\d-]*)?`$/m.exec(chunk)?.[1] ?? null
    out.push({ id: `cr:${m[1]}`, severity: crLabelIn(chunk), path, reportedCommit })
  }
  const declared = /Outside diff range comments \((\d+)\)/.exec(section)?.[1]
  if (declared === undefined || Number(declared) !== out.length) {
    throw new Error(`CodeRabbit ${what}: outside-diff heading declares ${declared ?? 'no count'} but ${out.length} finding(s) were parsed; cannot judge`)
  }
  return out
}

// Reviews carry their `commitId`; an issue comment names no commit (`null`). Only CodeRabbit's own.
export function outsideDiffFindings({ reviews, comments }) {
  return [
    ...reviews.filter((r) => r.login === CODERABBIT_LOGIN).flatMap((r) => findingsIn(r.body, r.commitId ?? null, `review ${r.id}`)),
    ...comments.filter((c) => c.login === CODERABBIT_LOGIN).flatMap((c) => findingsIn(c.body, null, `comment ${c.id}`)),
  ]
}
