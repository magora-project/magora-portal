// Self-test for scripts/review/github.mjs: the read-only layer over GitHub. The API is a stub, no
// network. Live fixtures (fixtures/bot-formats.json) are trimmed bot output measured 2026-11-09;
// pagination pages, spoofed logins and the Gemini markers are synthetic and live here.
// Run: node scripts/review/github.test.mjs
import { readFileSync } from 'node:fs'
import {
  coderabbitCheck, codexHistory, codexState, fullReviewRequests, geminiDispatchRuns, geminiVerdicts,
  listIssueComments, listReviews, listReviewsFrom, listThreads, outsideDiffFindings, prRuns,
} from './github.mjs'

const fx = JSON.parse(readFileSync(new URL('./fixtures/bot-formats.json', import.meta.url), 'utf8'))
let pass = 0, fail = 0
const ok = (n, c) => {
  if (c !== null && typeof c === 'object' && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c === true) pass++; else { fail++; console.log('  FAIL', n) }
}
const errSync = (fn) => { try { fn(); return null } catch (e) { return e.message } }
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

const CODEX = 'chatgpt-codex-connector[bot]', CR = 'coderabbitai[bot]', GHA = 'github-actions[bot]'
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const base = { repo: 'o/r', pr: 44, token: 't' }
// REST stub over a list pager: page N of `pages` (query `page`), empty past the end. `key` wraps the
// array for endpoints that answer { total_count, <key>: [...] }.
const pager = (pages, key) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'))
  const items = pages[page - 1] ?? []
  return res(key ? { total_count: 0, [key]: items } : items)
}
const hundred = (make) => Array.from({ length: 100 }, (_, i) => make(i))

// ---------------------------------------------------------------- codexState (V2)
const codex = fx.codexStateComment
const asComment = (c) => ({ id: c.id, login: c.login, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt })
const SHA_FC4 = 'fc4c90cffba12716c1b3dee3737174359251e2e6'
ok('codexState reads the marker, not the table (live comment; the table shows the short sha)', (() => {
  const s = codexState([asComment(codex)])
  return s !== null && s.commitSha === SHA_FC4 && s.status === 'completed' && s.at === codex.updatedAt && s.commentId === codex.id
})())
ok('the marker wins over a table that names another commit', (() => {
  const tampered = { ...asComment(codex), body: codex.body.replaceAll('`fc4c90c`', '`1111111`') }
  return codexState([tampered]).commitSha === SHA_FC4
})())
ok('a marker in a comment from another login is ignored', codexState([{ ...asComment(codex), login: 'mallory' }]) === null)
ok('a marker whose JSON does not parse yields null for that comment', codexState([{ ...asComment(codex), body: '<!-- codex-review-state:v1 {not json} -->' }]) === null)
ok('a marker with no commit_sha yields null', codexState([{ ...asComment(codex), body: '<!-- codex-review-state:v1 {"code_review":{"status":"completed"}} -->' }]) === null)
ok('no comments -> null', codexState([]) === null)
ok('the latest marker (by updatedAt) wins', (() => {
  const older = { ...asComment(codex), id: 1, updatedAt: '2026-11-01T00:00:00Z', body: codex.body.replaceAll(SHA_FC4, 'a'.repeat(40)) }
  const newer = { ...asComment(codex), id: 2, updatedAt: '2026-11-03T00:00:00Z' }
  return codexState([newer, older]).commentId === 2 && codexState([older, newer]).commentId === 2
})())
ok('a malformed newer comment does not hide a valid older one', (() => {
  const bad = { ...asComment(codex), id: 9, updatedAt: '2026-12-01T00:00:00Z', body: '<!-- codex-review-state:v1 {oops} -->' }
  return codexState([bad, asComment(codex)]).commentId === codex.id
})())

// ---------------------------------------------------------------- geminiVerdicts (Task 20 marker)
const SHA = 'c388d74c388d74c388d74c388d74c388d74c388d', ID = 'f'.repeat(64)
const marker = (m) => `<!-- gemini-review:v1 ${JSON.stringify(m)} -->`
const botComment = (over = {}) => ({ id: 10, login: GHA, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', ...over })
// Exactly as the workflow writes it: python json.dumps(meta, separators=(",", ":")), last line.
const emitted = `{"head":"${SHA}","identity":"${ID}","verdict":"findings","findings":[{"index":1,"severity":"P1"},{"index":2,"severity":"P0"},{"index":3,"severity":"P1"}]}`
const findingsBody = `## Gemini review\n\nHead \`${SHA}\`, 1234 byte diff.\n\n\`\`\`\n1. P1 | a.js | x\n2. P0 | b.js | y\n3. P1 | c.js | z\n\`\`\`\n\n---\n_Posted by gemini-review.yml (Gemini, advisory; not a required check)_\n<!-- gemini-review:v1 ${emitted} -->`
ok('the marker format and numbering are pinned: a marker exactly as the workflow emits it parses (1-based, in order)', (() => {
  const v = geminiVerdicts([botComment({ body: findingsBody })])
  return v.length === 1 && v[0].head === SHA && v[0].identity === ID && v[0].verdict === 'findings' &&
    JSON.stringify(v[0].findings) === '[{"index":1,"severity":"P1"},{"index":2,"severity":"P0"},{"index":3,"severity":"P1"}]' &&
    v[0].commentId === 10 && v[0].at === '2026-11-05T10:00:00Z'
})())
ok('the marker regex is the workflow reader\'s regex', (() => {
  const yml = readFileSync(new URL('../../.github/workflows/gemini-review.yml', import.meta.url), 'utf8')
  return yml.includes('marker = re.compile(r"^<!-- gemini-review:v1 (\\{.*\\}) -->$", re.MULTILINE)')
})())
ok('no-findings and skipped-same-identity verdicts parse with empty findings', (() => {
  const a = geminiVerdicts([botComment({ id: 1, body: marker({ head: SHA, identity: ID, verdict: 'no-findings', findings: [] }) })])
  const b = geminiVerdicts([botComment({ id: 2, body: marker({ head: SHA, identity: ID, verdict: 'skipped-same-identity', findings: [] }) })])
  return a[0].verdict === 'no-findings' && b[0].verdict === 'skipped-same-identity' && a[0].findings.length === 0
})())
ok('an edited comment (updatedAt != createdAt) is not the bot\'s own verdict', geminiVerdicts([botComment({ body: findingsBody, updatedAt: '2026-11-05T11:00:00Z' })]).length === 0)
ok('an empty identity in a could-not-run marker still parses, as that verdict', (() => {
  const v = geminiVerdicts([botComment({ body: marker({ head: SHA, identity: '', verdict: 'could-not-run', findings: [] }) })])
  return v.length === 1 && v[0].identity === '' && v[0].verdict === 'could-not-run'
})())
ok('a marker in a comment from another login is ignored', geminiVerdicts([botComment({ login: 'mallory', body: findingsBody })]).length === 0)
ok('two markers in one comment are ignored (the reader needs exactly one)', geminiVerdicts([botComment({ body: `${findingsBody}\n${marker({ head: SHA, identity: ID, verdict: 'no-findings', findings: [] })}` })]).length === 0)
ok('a marker quoted inside a line is not a marker (the opener must start its line)', geminiVerdicts([botComment({ body: `quote: ${marker({ head: SHA, identity: ID, verdict: 'no-findings', findings: [] })}` })]).length === 0)
ok('JSON that does not parse yields no verdict', geminiVerdicts([botComment({ body: '<!-- gemini-review:v1 {nope} -->' })]).length === 0)
ok('an unknown verdict is ignored', geminiVerdicts([botComment({ body: marker({ head: SHA, identity: ID, verdict: 'passed', findings: [] }) })]).length === 0)
ok('a finding that is not P0/P1 or has no integer index invalidates the marker', (() => {
  const p2 = geminiVerdicts([botComment({ body: marker({ head: SHA, identity: ID, verdict: 'findings', findings: [{ index: 1, severity: 'P2' }] }) })])
  const idx = geminiVerdicts([botComment({ body: marker({ head: SHA, identity: ID, verdict: 'findings', findings: [{ index: '1', severity: 'P1' }] }) })])
  return p2.length === 0 && idx.length === 0
})())
ok('a marker with no head is ignored', geminiVerdicts([botComment({ body: marker({ identity: ID, verdict: 'no-findings', findings: [] }) })]).length === 0)

// ---------------------------------------------------------------- fullReviewRequests
ok('"@codex review please" is not a full-review request', fullReviewRequests([{ body: '@codex review please', login: 'a' }]).length === 0)
ok('"@coderabbitai full review" and "@codex review" (trimmed) are requests, with their time', (() => {
  const r = fullReviewRequests([
    { body: '  @coderabbitai full review\n', login: 'a', createdAt: '2026-11-01T00:00:00Z' },
    { body: '@codex review', login: 'a', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
    { body: 'hello @codex review', login: 'a', createdAt: '2026-11-03T00:00:00Z' },
  ])
  return r.length === 2 && r[0].bot === 'coderabbit' && r[0].at === '2026-11-01T00:00:00Z' && r[1].bot === 'codex' && r[1].at === '2026-11-02T00:00:00Z'
})())
// Pre-publish Codex review 2026-11-10: a comment edited into a request asked when edited, not when first written.
ok('an edited comment\'s request dates from its edit', fullReviewRequests([{ body: '@coderabbitai full review', login: 'a', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' }])[0].at === '2026-11-05T00:00:00Z')

// ---------------------------------------------------------------- reviews
const pr43 = fx.pr43RawReviews.reviews
ok('empty CodeRabbit reviews are marked empty (PR #43 measured 2026-11-09: 8 reviews, 6 empty; the brief\'s planning-time 6 matches only when the 3 operator reviews are counted too)', (() => {
  const r = listReviewsFrom(pr43)
  return r.length === 8 && r.filter((x) => x.empty).length === 6 && r.filter((x) => x.empty && x.login === CR).length === 3
})())
ok('listReviewsFrom maps the REST shape', (() => {
  const r = listReviewsFrom(pr43)[0]
  return r.id === pr43[0].id && r.login === CR && r.commitId === pr43[0].commit_id && r.submittedAt === pr43[0].submitted_at && r.body === pr43[0].body && r.empty === false
})())
ok('a whitespace-only or null body is empty', (() => {
  const r = listReviewsFrom([{ id: 1, user: { login: 'a' }, commit_id: 'c', submitted_at: 't', body: ' \n ' }, { id: 2, user: null, commit_id: 'c', submitted_at: 't', body: null }])
  return r[0].empty === true && r[1].empty === true && r[1].login === null && r[1].body === ''
})())
ok('listReviews paginates past 100 and maps through listReviewsFrom', await (async () => {
  const rows = hundred((i) => ({ id: i, user: { login: 'a' }, commit_id: 'c', submitted_at: 't', body: 'x' }))
  const r = await listReviews({ ...base, fetchImpl: pager([rows, [{ id: 999, user: { login: 'a' }, commit_id: 'c', submitted_at: 't', body: '' }]]) })
  return r.length === 101 && r[100].empty === true
})())
ok('a review API error throws (fails closed)', /403/.test(await errOf(() => listReviews({ ...base, fetchImpl: async () => res({}, 403) })) ?? ''))
ok('a non-array list throws', /non-array/.test(await errOf(() => listReviews({ ...base, fetchImpl: async () => res({}) })) ?? ''))
ok('listIssueComments paginates and maps', await (async () => {
  const rows = hundred((i) => ({ id: i, user: { login: 'a' }, body: 'b', created_at: 'c', updated_at: 'u' }))
  const r = await listIssueComments({ ...base, fetchImpl: pager([rows, [{ id: 7, user: { login: CR }, body: 'z', created_at: 'c7', updated_at: 'u7' }]]) })
  return r.length === 101 && JSON.stringify(r[100]) === JSON.stringify({ id: 7, login: CR, body: 'z', createdAt: 'c7', updatedAt: 'u7' })
})())

// ---------------------------------------------------------------- threads (GraphQL)
const thread = (i, over = {}) => ({
  id: `T${i}`, isResolved: false, resolvedBy: null, path: 'a.js',
  comments: { totalCount: 1, nodes: [{ author: { login: CR }, body: 'b', url: `u${i}`, originalCommit: { oid: 'f'.repeat(40) } }] }, ...over,
})
const gql = (pages) => async (url, init) => {
  ok('GraphQL goes to /graphql by POST', new URL(url).pathname === '/graphql' && init.method === 'POST')
  const { variables } = JSON.parse(init.body)
  const i = variables.cursor ? Number(variables.cursor.slice(1)) : 0
  return res({ data: { repository: { pullRequest: { reviewThreads: pages[i] } } } })
}
const threadPage = (nodes, next) => ({ pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null }, nodes })
ok('threads paginate past 100', (await listThreads({ ...base, fetchImpl: gql([threadPage(hundred((i) => thread(i)), 'c1'), threadPage([thread(100)])]) })).length === 101)
ok('a thread reports its original commit, not the re-anchored one (PR #52 comment 4438353270: commit baafa0b, original f530f6d; the fixture holds one thread)', await (async () => {
  const t = await listThreads({ ...base, fetchImpl: gql([threadPage([thread(1, { comments: { totalCount: 1, nodes: [{ author: { login: CODEX }, body: 'b', url: 'u', originalCommit: { oid: 'f530f6d3f288a9ab9cd9d23f182befe33f2784d3' }, commit: { oid: 'baafa0b0000000000000000000000000000000000' } }] } })])]) })
  return t.length === 1 && t[0].firstComment.originalCommit === 'f530f6d3f288a9ab9cd9d23f182befe33f2784d3' && t[0].firstComment.login === CODEX
})())
ok('a thread has the documented shape and a resolver', await (async () => {
  const t = await listThreads({ ...base, fetchImpl: gql([threadPage([thread(1, { isResolved: true, resolvedBy: { login: 'david' } })])]) })
  return JSON.stringify(Object.keys(t[0])) === '["id","isResolved","resolvedBy","path","firstComment","comments"]' && t[0].resolvedBy === 'david' &&
    JSON.stringify(Object.keys(t[0].firstComment)) === '["login","body","url","originalCommit"]'
})())
// GraphQL names a Bot actor without the `[bot]` suffix REST uses (measured on PR #52, 2026-11-10: author
// { login: "chatgpt-codex-connector", __typename: "Bot" }, resolvedBy { login: "coderabbitai[bot]" }). The gate matches
// the REST logins, so a Bot author gets the suffix; a User of the same name does not.
ok('a Bot thread author gets the REST [bot] login; a User of that name does not', await (async () => {
  const node = (typename) => thread(1, { comments: { totalCount: 1, nodes: [{ author: { login: 'chatgpt-codex-connector', __typename: typename }, body: 'b', url: 'u', originalCommit: { oid: 'f'.repeat(40) } }] } })
  const [bot] = await listThreads({ ...base, fetchImpl: gql([threadPage([node('Bot')])]) })
  const [user] = await listThreads({ ...base, fetchImpl: gql([threadPage([node('User')])]) })
  return bot.firstComment.login === CODEX && user.firstComment.login === 'chatgpt-codex-connector'
})())
ok('the threads query asks for the author\'s __typename', await (async () => {
  let q = ''
  await listThreads({ ...base, fetchImpl: async (url, init) => { q = JSON.parse(init.body).query; return res({ data: { repository: { pullRequest: { reviewThreads: threadPage([]) } } } }) } })
  return /author\s*\{\s*login\s+__typename\s*\}/.test(q)
})())
// Every comment of a thread is read (CodeRabbit marks a fix in its own comment, edited), with its last editor.
const cmt = (i, author = { login: 'coderabbitai', __typename: 'Bot' }, editor = null) => ({ author, editor, body: `c${i}`, url: `u${i}`, originalCommit: { oid: 'f'.repeat(40) } })
ok('a thread\'s comments are all read, past 100, by cursor on the thread node, with Bot authors and editors suffixed', await (async () => {
  const first = { totalCount: 101, pageInfo: { hasNextPage: true, endCursor: 'k1' }, nodes: hundred((i) => cmt(i)) }
  const rest = { totalCount: 101, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [cmt(100, { login: 'dev', __typename: 'User' }, { login: 'coderabbitai', __typename: 'Bot' })] }
  const seen = []
  const f = async (url, init) => {
    const { query, variables } = JSON.parse(init.body)
    seen[seen.length] = variables
    if (/reviewThreads/.test(query)) return res({ data: { repository: { pullRequest: { reviewThreads: threadPage([thread(1, { comments: first })]) } } } })
    return res({ data: { node: { comments: rest } } })
  }
  const [t] = await listThreads({ ...base, fetchImpl: f })
  return t.comments.length === 101 && t.comments[0].login === CR && t.comments[0].editor === null && t.comments[100].login === 'dev' && t.comments[100].editor === CR && seen.some((v) => v.id === 'T1' && v.cursor === 'k1') && JSON.stringify(Object.keys(t.comments[0])) === '["login","editor","lastEditedAt","body"]'
})())
ok('a short comment read throws (fail closed)', /read 1 of 2/.test(await errOf(() => listThreads({ ...base, fetchImpl: gql([threadPage([thread(1, { comments: { totalCount: 2, nodes: [cmt(0)] } })])]) })) ?? ''))
ok('a thread whose comments carry no totalCount throws', /no readable comments/.test(await errOf(() => listThreads({ ...base, fetchImpl: gql([threadPage([thread(1, { comments: { nodes: [cmt(0)] } })])]) })) ?? ''))
ok('the threads query asks for each comment\'s editor', await (async () => {
  let q = ''
  await listThreads({ ...base, fetchImpl: async (url, init) => { q = JSON.parse(init.body).query; return res({ data: { repository: { pullRequest: { reviewThreads: threadPage([]) } } } }) } })
  return /editor\s*\{\s*login\s+__typename\s*\}\s*lastEditedAt/.test(q) && /comments\(first: 100\)/.test(q)
})())
ok('an unresolved thread has resolvedBy null',(await listThreads({ ...base, fetchImpl: gql([threadPage([thread(1)])]) }))[0].resolvedBy === null)
ok('GraphQL errors throw (fail closed)', /GraphQL/.test(await errOf(() => listThreads({ ...base, fetchImpl: async () => res({ errors: [{ message: 'boom' }] }) })) ?? ''))
ok('a GraphQL HTTP error throws', /502/.test(await errOf(() => listThreads({ ...base, fetchImpl: async () => res({}, 502) })) ?? ''))
ok('a missing pullRequest throws', /GraphQL/.test(await errOf(() => listThreads({ ...base, fetchImpl: async () => res({ data: { repository: { pullRequest: null } } }) })) ?? ''))
ok('hasNextPage without a cursor throws instead of looping', /cursor/.test(await errOf(() => listThreads({ ...base, fetchImpl: async () => res({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } } } } }) })) ?? ''))

// ---------------------------------------------------------------- CodeRabbit check (V3)
const run = (over) => ({ id: 1, name: 'CodeRabbit', app: { slug: 'coderabbitai' }, conclusion: 'skipped', output: { title: 'No files to review' }, ...over })
const checks = (rows) => async (url) => {
  const u = new URL(url)
  ok('coderabbitCheck reads the check runs of the sha', u.pathname === '/repos/o/r/commits/abc/check-runs')
  return res({ total_count: rows.length, check_runs: u.searchParams.get('page') === '1' ? rows : [] })
}
ok('coderabbitCheck returns the CodeRabbit run\'s conclusion and title', JSON.stringify(await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([run()]) })) === '{"conclusion":"skipped","title":"No files to review"}')
ok('a run named CodeRabbit from another app is ignored', await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([run({ app: { slug: 'mallory' } })]) }) === null)
ok('a run from the right app with another name is ignored', await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([run({ name: 'lint' })]) }) === null)
ok('no check run -> null', await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([]) }) === null)
ok('the newest run wins when there are several', (await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([run({ id: 5, conclusion: 'success', output: { title: 'ok' } }), run({ id: 9, conclusion: 'failure', output: { title: 'bad' } })]) })).conclusion === 'failure')
ok('a null title and a pending run map to nulls', JSON.stringify(await coderabbitCheck({ ...base, sha: 'abc', fetchImpl: checks([run({ conclusion: null, output: {} })]) })) === '{"conclusion":null,"title":null}')

// ---------------------------------------------------------------- workflow runs
const wf = (i, over = {}) => ({ id: i, name: 'ci', event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), head_repository: { full_name: 'o/r' }, created_at: '2026-11-05T00:00:00Z', pull_requests: [{ number: 44 }], ...over })
ok('prRuns paginates and keeps each run\'s PR numbers, head SHA, head repository and status', await (async () => {
  const seen = []
  const f = pager([hundred((i) => wf(i)), [wf(100)]], 'workflow_runs')
  const r = await prRuns({ ...base, headRef: 'docs/x', fetchImpl: async (u, i) => { seen.push(new URL(u)); return f(u, i) } })
  return r.length === 101 && r[0].prNumbers.join() === '44' && typeof r[0].headSha === 'string' && r[0].headRepo === 'o/r' && r[0].status === 'completed' &&
    JSON.stringify(Object.keys(r[0])) === '["id","name","event","status","conclusion","headSha","headRepo","createdAt","prNumbers"]' &&
    seen[0].searchParams.get('branch') === 'docs/x' && seen[0].searchParams.get('event') === 'pull_request' && seen[0].pathname === '/repos/o/r/actions/runs'
})())
ok('a run with no head repository or PRs maps to null / []', await (async () => {
  const r = await prRuns({ ...base, headRef: 'x', fetchImpl: pager([[wf(1, { head_repository: null, pull_requests: [] })]], 'workflow_runs') })
  return r[0].headRepo === null && r[0].prNumbers.length === 0
})())
ok('a prRuns page error throws (fails closed)', /500/.test(await errOf(() => prRuns({ ...base, headRef: 'x', fetchImpl: async () => res({}, 500) })) ?? ''))
ok('a prRuns response without workflow_runs throws', /workflow_runs/.test(await errOf(() => prRuns({ ...base, headRef: 'x', fetchImpl: async () => res({}) })) ?? ''))
ok('geminiDispatchRuns keeps only runs titled exactly "Gemini review PR #<pr>"', await (async () => {
  const seen = []
  const rows = [wf(1, { display_title: 'Gemini review PR #44' }), wf(2, { display_title: 'Gemini review PR #4' }), wf(3, { display_title: 'Gemini review PR #444' }), wf(4, { display_title: 'x Gemini review PR #44' }), wf(5, { display_title: 'Gemini review PR #44', status: 'in_progress', conclusion: null })]
  const f = pager([rows], 'workflow_runs')
  const r = await geminiDispatchRuns({ ...base, fetchImpl: async (u, i) => { seen.push(new URL(u)); return f(u, i) } })
  return JSON.stringify(r.map((x) => x.id)) === '[1,5]' && JSON.stringify(Object.keys(r[0])) === '["id","status","conclusion","createdAt"]' &&
    seen[0].pathname === '/repos/o/r/actions/workflows/gemini-review.yml/runs' && seen[0].searchParams.get('event') === 'workflow_dispatch' && seen[0].searchParams.get('branch') === 'main'
})())
ok('geminiDispatchRuns paginates past 100', (await geminiDispatchRuns({ ...base, fetchImpl: pager([hundred((i) => wf(i, { display_title: 'Gemini review PR #44' })), [wf(100, { display_title: 'Gemini review PR #44' })]], 'workflow_runs') })).length === 101)
ok('a geminiDispatchRuns page error throws', /500/.test(await errOf(() => geminiDispatchRuns({ ...base, fetchImpl: async () => res({}, 500) })) ?? ''))

// ---------------------------------------------------------------- codexHistory (gate point 3, M3)
const mk = (sha, status = 'completed') => `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"${status}"}} -->`
const [A, B, C] = ['a', 'b', 'c'].map((c) => c.repeat(40))
const CODEX_BOT = { login: 'chatgpt-codex-connector', __typename: 'Bot' }
const history = ({ pages, total, current = `x\n${mk(A)}\n`, failPage = 0, editor = CODEX_BOT, lastEditedAt = '2026-11-04T00:00:00Z' }) => async (url, init) => {
  const u = new URL(url)
  if (u.pathname === '/repos/o/r/issues/comments/777') return res({ node_id: 'IC_node' })
  if (u.pathname !== '/graphql') return res({}, 404)
  const { variables } = JSON.parse(init.body)
  const i = variables.cursor ? Number(variables.cursor.slice(1)) : 0
  if (failPage && i === failPage) return res({}, 502)
  const edits = pages[i]
  return res({ data: { node: { body: current, updatedAt: '2026-11-04T00:00:00Z', lastEditedAt, editor, userContentEdits: { totalCount: total, pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: `p${i + 1}` }, nodes: edits } } } })
}
// GitHub's userContentEdits `diff` is the FULL comment body after the edit, not a unified diff.
const edit = (at, marker, editor = CODEX_BOT) => ({ editedAt: at, editor, diff: `<!-- codex-pull-request-review-summary -->\n${marker}\n## Codex Review Summary\n` })
const twoEditPages = history({ total: 3, pages: [[edit('2026-11-03T00:00:00Z', mk(B)), edit('2026-11-02T00:00:00Z', mk(B))], [edit('2026-11-01T00:00:00Z', mk(C))]] })
ok('codexHistory reads every marker SHA across edit pages, each with its time', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: twoEditPages })
  const bySha = (s) => h.reviews.filter((r) => r.sha === s).map((r) => r.at)
  return h.complete === true && h.reviews.every((r) => typeof r.at === 'string') &&
    bySha(A).includes('2026-11-04T00:00:00Z') && bySha(B).includes('2026-11-02T00:00:00Z') && bySha(C).join() === '2026-11-01T00:00:00Z'
})())
ok('codexHistory returns 3 distinct reviews for a body and two edits', (await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 2, pages: [[edit('2026-11-03T00:00:00Z', mk(B)), edit('2026-11-02T00:00:00Z', mk(C))]] }) })).reviews.length === 3)
ok('an edit page short of totalCount is incomplete', (await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 5, pages: [[edit('2026-11-03T00:00:00Z', mk(B))]] }) })).complete === false)
ok('a page error is incomplete, not a throw, and keeps what was read', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 3, failPage: 1, pages: [[edit('2026-11-03T00:00:00Z', mk(B))], [edit('2026-11-01T00:00:00Z', mk(C))]] }) })
  return h.complete === false && h.reviews.some((r) => r.sha === B)
})())
ok('an unreadable comment is incomplete with no reviews', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: async () => res({}, 404) })
  return h.complete === false && h.reviews.length === 0
})())
ok('a null userContentEdits (not readable) is incomplete', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: async (u) => new URL(u).pathname === '/graphql' ? res({ data: { node: { body: mk(A), updatedAt: 't', userContentEdits: null } } }) : res({ node_id: 'n' }) })
  return h.complete === false
})())
ok('a running and a completed marker for the same sha are both kept, with their statuses', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 2, pages: [[edit('2026-11-03T00:00:00Z', mk(A)), edit('2026-11-02T00:00:00Z', mk(A, 'running'))]] }) })
  const forA = h.reviews.filter((r) => r.sha === A)
  const running = forA.filter((r) => r.status === 'running'), completed = forA.filter((r) => r.status === 'completed')
  return h.complete === true && forA.length === 3 && running.length === 1 && running[0].at === '2026-11-02T00:00:00Z' && completed.length === 2 &&
    JSON.stringify(Object.keys(forA[0])) === '["sha","at","status"]'
})())
ok('a marker with no status has status null', (await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 0, pages: [[]], current: '<!-- codex-review-state:v1 {"code_review":{"commit_sha":"' + A + '"}} -->' }) })).reviews[0].status === null)
// Editor provenance (pre-publish Codex review, 2026-11-10): anyone with write access can edit the bot's comment.
const HUMAN = { login: 'maintainer', __typename: 'User' }
ok('an edit by a human is not a review; the bot\'s own edits still are', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 2, pages: [[edit('2026-11-03T00:00:00Z', mk(B), HUMAN), edit('2026-11-02T00:00:00Z', mk(C))]] }) })
  return h.complete === true && h.currentTrusted === true && !h.reviews.some((r) => r.sha === B) && h.reviews.some((r) => r.sha === C) && h.reviews.some((r) => r.sha === A)
})())
ok('a current body last edited by a human is not trusted and not a review', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 1, editor: HUMAN, current: `x\n${mk(B)}\n`, pages: [[edit('2026-11-03T00:00:00Z', mk(B), HUMAN)]] }) })
  return h.complete === true && h.currentTrusted === false && h.reviews.length === 0
})())
ok('a User account named like the Codex bot is not the bot', await (async () => {
  const imp = { login: 'chatgpt-codex-connector', __typename: 'User' }
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 1, editor: imp, pages: [[edit('2026-11-03T00:00:00Z', mk(B), imp)]] }) })
  return h.currentTrusted === false && h.reviews.length === 0
})())
ok('a null editor on an edited body (a deleted account) is not trusted', (await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 0, pages: [[]], editor: null }) })).currentTrusted === false)
ok('current is the authenticated body\'s marker, and null when the body is not trusted', await (async () => {
  const ok1 = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 0, pages: [[]], current: `x\n${mk(B, 'running')}\n` }) })
  const no = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 0, pages: [[]], editor: HUMAN }) })
  return ok1.current?.commitSha === B && ok1.current.status === 'running' && ok1.current.at === '2026-11-04T00:00:00Z' && no.current === null
})())
ok('a never-edited body is trusted', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 0, pages: [[]], editor: null, lastEditedAt: null }) })
  return h.currentTrusted === true && h.reviews.length === 1 && h.reviews[0].sha === A
})())
ok('a node missing its editor fields is not trusted (fail closed)', await (async () => {
  const h = await codexHistory({ ...base, commentId: 777, fetchImpl: async (u) => new URL(u).pathname === '/graphql' ? res({ data: { node: { body: mk(A), updatedAt: 't', userContentEdits: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } }) : res({ node_id: 'n' }) })
  return h.complete === true && h.currentTrusted === false && h.reviews.length === 0
})())
ok('a diff whose marker JSON does not parse is skipped, not fatal', (await codexHistory({ ...base, commentId: 777, fetchImpl: history({ total: 1, pages: [[edit('2026-11-03T00:00:00Z', '<!-- codex-review-state:v1 {bad} -->')]] }) })).reviews.length === 1)

// ---------------------------------------------------------------- outsideDiffFindings (gate point 4)
const crReview = fx.crReviewOutsideDiff
const review = { id: crReview.id, login: crReview.login, commitId: crReview.commitId, submittedAt: crReview.submittedAt, body: crReview.body, empty: false }
const oneFinding = (() => {
  const b = crReview.body
  return b.slice(0, b.indexOf('</blockquote></details>') + '</blockquote></details>'.length).replace('comments (3)', 'comments (1)')
})()
const crReviewWithOutsideDiff = { ...review, body: oneFinding }
const crCommentWithOutsideDiff = { id: 5, login: CR, body: oneFinding, createdAt: 'c', updatedAt: 'c' }
ok('an outside-diff finding carries its review commit, or null from an issue comment (each fixture holds one finding)', (() => {
  const fromReview = outsideDiffFindings({ reviews: [crReviewWithOutsideDiff], comments: [] })
  const fromComment = outsideDiffFindings({ reviews: [], comments: [crCommentWithOutsideDiff] })
  return fromReview.length === 1 && fromReview[0].reportedCommit === crReviewWithOutsideDiff.commitId && fromComment.length === 1 && fromComment[0].reportedCommit === null
})())
ok('a blocking outside-diff finding present only in a review body is found', outsideDiffFindings({ reviews: [review], comments: [] }).some((f) => f.severity === 'Major' && f.id.startsWith('cr:')))
ok('all three live findings are read with marker id, severity and path (no line range)', (() => {
  const f = outsideDiffFindings({ reviews: [review], comments: [] })
  return f.length === 3 &&
    f[0].id === 'cr:956d1b3cd90766315da30417' && f[0].severity === 'Major' && f[0].path === 'docs/superpowers/plans/2026-10-28-staging-and-secrets.md' &&
    f[1].id === 'cr:97bc58def15aba789b90adc0' && f[1].severity === 'Minor' && f[2].id === 'cr:611baf72100b6a3cb565075e' && f[2].severity === 'Minor' &&
    f.every((x) => x.reportedCommit === crReview.commitId) && JSON.stringify(Object.keys(f[0])) === '["id","severity","path","reportedCommit"]'
})())
ok('a finding in an unlabeled block has severity null (the consumer treats it as blocking)', (() => {
  const body = oneFinding.replace(/Major<\/strong>/, 'Whatever</strong>').replace(/\*\*🟠 Major\*\*/, '**x**')
  const f = outsideDiffFindings({ reviews: [{ ...review, body }], comments: [] })
  return f.length === 1 && f[0].severity === null
})())
ok('a review from another login is ignored (spoof)', outsideDiffFindings({ reviews: [{ ...review, login: 'mallory' }], comments: [{ ...crCommentWithOutsideDiff, login: 'mallory' }] }).length === 0)
ok('a review with no outside-diff section yields nothing', outsideDiffFindings({ reviews: [{ ...review, body: '<!-- coderabbit-ai-generated:v1 -->\n\nActionable comments posted: 0' }], comments: [] }).length === 0)
ok('a cr-comment marker outside the outside-diff section (a nitpick follow-up) is not read', (() => {
  const nit = '<!-- coderabbit-ai-generated:v1 -->\n\n## Follow-up Comments\n\n<details>\n<summary>Nitpick</summary>\n\n`114-114`: **Trivial**\n\n<!-- cr-comment:v1:0ef4217fa9eb8eb9d8d7bb76 -->\n</details>\n'
  return outsideDiffFindings({ reviews: [{ ...review, body: nit }], comments: [] }).length === 0
})())
const pr54 = fx.crReviewOutsideThenDuplicate
const asReview = (r) => ({ id: r.id, login: r.login, commitId: r.commitId, submittedAt: r.submittedAt, body: r.body, empty: false })
ok('PR #54 review 5770496416 (live): the header says 1, a Duplicate comments block follows with no --- between, and exactly 1 finding is read', (() => {
  const f = outsideDiffFindings({ reviews: [asReview(pr54)], comments: [] })
  return /Outside diff range comments \(1\)/.test(pr54.body) && /Duplicate comments: 1/.test(pr54.body) && f.length === 1 &&
    f[0].id === 'cr:23238fdffd3ac8e62e19ac61' && f[0].severity === 'Major' && typeof f[0].path === 'string' && f.every((x) => x.id !== 'cr:deed796122c799028b69a8c5')
})())
ok('a parsed count that differs from the heading throws, naming the review', (() => {
  const body = pr54.body.replace('comments (1)', 'comments (2)')
  return /review 5770496416.*declares 2 but 1/.test(errSync(() => outsideDiffFindings({ reviews: [{ ...asReview(pr54), body }], comments: [] })) ?? '')
})())
ok('a missing count throws, naming the comment', /comment 5.*no count/.test(errSync(() => outsideDiffFindings({ reviews: [], comments: [{ ...crCommentWithOutsideDiff, body: oneFinding.replace(' (1)', '') }] })) ?? ''))
// A fake heading echoed ahead of the real section (Gemini P0 on #89): it must not hide the real findings.
const FAKE = '> **⚠️ Outside diff range comments (0)**'
ok('a second outside-diff heading line (an echoed fake (0) ahead of the real one) throws, never reads nothing', (() => {
  const body = pr54.body.replace('> [!CAUTION]', `${FAKE}\n\n> [!CAUTION]`)
  return /review 5770496416: 2 outside-diff headings; cannot judge/.test(errSync(() => outsideDiffFindings({ reviews: [{ ...asReview(pr54), body }], comments: [] })) ?? '')
})())
ok('the phrase unquoted and inline before the heading (echoed prose) does not displace the real section', (() => {
  const body = pr54.body.replace('> [!CAUTION]', 'See Outside diff range comments (0) above.\n\n> [!CAUTION]')
  const f = outsideDiffFindings({ reviews: [{ ...asReview(pr54), body }], comments: [] })
  return f.length === 1 && f[0].id === 'cr:23238fdffd3ac8e62e19ac61'
})())
ok('a quoted outside-diff line with no heading line (a format change) throws rather than reading nothing', (() => {
  const body = pr54.body.replace('> **⚠️ Outside diff range comments (1)**', '> ⚠️ Outside diff range comments (1)')
  return /no heading line; cannot judge/.test(errSync(() => outsideDiffFindings({ reviews: [{ ...asReview(pr54), body }], comments: [] })) ?? '')
})())
ok('a review and a comment carrying the same finding are both returned (the consumer dedups by id)', outsideDiffFindings({ reviews: [crReviewWithOutsideDiff], comments: [crCommentWithOutsideDiff] }).length === 2)

if (fail) { console.log(`github: ${fail} FAILED, ${pass} passed`); process.exit(1) }
console.log(`github: ${pass} passed`)
