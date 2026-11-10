// Shared test fixture for the PR-stage gate (scripts/ci/review-gate.test.mjs, scripts/review/pr-record.test.mjs):
// one real git repo whose commits give the gate's ancestry and identity checks something real to read, plus
// builders for the live-state aggregate the gate judges. Not a test itself; nothing here touches the network.
//
// Commit graph (main: M0; branch pr):
//   M0 -- Q0 -- R -- S -- F -- E -- U        Q0 adds extra.js; R puts a bug in app.js; S is evidence-only (identity
//                      \                     of R); F fixes app.js; E is evidence-only (identity of F); U changes
//                       Y                    other.js (a new identity). Y (branch side, off S) makes F's change
//                                            again: the identity of F, but not a descendant of F.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeIdentityOf, makeIsAncestor } from '../coverage.mjs'
import { makeResolveCommit } from '../../ci/review-gate.mjs'
import { CODERABBIT_LOGIN, CODEX_LOGIN } from '../severity.mjs'
import { GEMINI_LOGIN } from '../github.mjs'
import { inputIdentity } from '../identity.mjs'

export { CODERABBIT_LOGIN, CODEX_LOGIN, GEMINI_LOGIN }

const GIT_ENV = {
  ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
export const g = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, shell: false, env: GIT_ENV, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
export const put = (cwd, file, text) => {
  const p = join(cwd, file)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
const commit = (cwd, msg) => { g(cwd, ['add', '-A']); g(cwd, ['commit', '-q', '-m', msg]); return g(cwd, ['rev-parse', 'HEAD']) }

export const AGENTS = '# AGENTS\n\n## Control files\n\n`.github/**`, `scripts/ci/**`, `package.json`.\n\n## Next\n'
const SUBSTITUTE_MD = readFileSync(new URL('../../../.claude/review/slots/substitute.md', import.meta.url), 'utf8')
const app = (line) => ['function f(x) {', '  const a = 1', `  return a + x // ${line}`, '}', ''].join('\n')

export async function buildGateRepo(dir) {
  g(join(dir, '..'), ['init', '-q', '-b', 'main', dir])
  put(dir, 'AGENTS.md', AGENTS)
  put(dir, 'app.js', app('base'))
  put(dir, 'other.js', 'o1\n')
  put(dir, '.claude/review/slots/substitute.md', SUBSTITUTE_MD)
  const M0 = commit(dir, 'base')
  g(dir, ['checkout', '-q', '-b', 'pr'])
  put(dir, 'extra.js', 'e\n'); const Q0 = commit(dir, 'q0: unrelated file')
  put(dir, 'app.js', app('bug')); const R = commit(dir, 'r: the bug arrives')
  put(dir, '.review/s.txt', 's\n'); const S = commit(dir, 's: evidence only')
  put(dir, 'app.js', app('fixed')); const F = commit(dir, 'f: the fix')
  put(dir, '.review/e.txt', 'e\n'); const E = commit(dir, 'e: evidence only')
  put(dir, 'other.js', 'o2\n'); const U = commit(dir, 'u: unrelated change')
  g(dir, ['checkout', '-q', '-b', 'side', S])
  put(dir, 'app.js', app('fixed')); const Y = commit(dir, 'y: the fix again, off the fix commit')
  g(dir, ['checkout', '-q', 'pr'])
  const sha = { M0, Q0, R, S, F, E, U, Y }
  const id = {}
  for (const [k, v] of Object.entries(sha)) id[k] = await inputIdentity({ cwd: dir, base: M0, head: v })
  return { dir, sha, id, identityOf: makeIdentityOf({ cwd: dir, base: M0 }), isAncestor: makeIsAncestor({ cwd: dir }), resolveCommit: makeResolveCommit({ cwd: dir }) }
}

// ---------------------------------------------------------------- state builders

const T0 = Date.parse('2026-11-05T10:00:00Z')
export const T = (min) => new Date(T0 + min * 60_000).toISOString()

export const CODEX_P1 = '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Off by one in f**\n\nThe return is wrong.'
export const CODEX_P3 = '**<sub><sub>![P3 Badge](https://img.shields.io/badge/P3-yellow?style=flat)</sub></sub>  Naming**\n\nRename.'
export const CR_MAJOR = '_⚠️ Potential issue_\n\n**🟠 Major** · **Bug**\n\nThe return is wrong.'
export const CR_MAJOR_HEADER = '**🟠 Major**\n\nThe return is wrong.'
export const CR_MINOR = '**🟡 Minor**\n\nA nit.'

// A review thread as listThreads returns it. `replies`: later comments [{ login, editor, lastEditedAt, body }];
// `firstEditor`: the last editor of the first comment (null: never edited, or an editor GitHub cannot name);
// `firstLastEditedAt`: that edit's time (default: set when there is an editor); `firstSuffix`: text appended to the
// first comment, as CodeRabbit's own edit appends its status (crStatus, addressedIn below).
export const thread = (id, login, sha, { body, resolved = false, resolvedBy = null, path = 'app.js', replies = [], firstEditor = null, firstLastEditedAt, firstSuffix = '' } = {}) => {
  const first = (body ?? (login === CODEX_LOGIN ? CODEX_P1 : CR_MAJOR_HEADER)) + firstSuffix
  return {
    id, isResolved: resolved, resolvedBy: resolved ? resolvedBy : null, path,
    firstComment: { login, body: first, url: `https://example.test/${id}`, originalCommit: sha },
    comments: [{ login, editor: firstEditor, lastEditedAt: firstLastEditedAt !== undefined ? firstLastEditedAt : (firstEditor ? T(30) : null), body: first }, ...replies],
  }
}
// The end of a CodeRabbit finding, then the status CodeRabbit appends by editing it, as measured on PRs #44, #46, #52,
// #54 (2026-11-10): the finding's cr-comment marker, the auto-generated-reply comment, one status line.
export const CR_FINDING_END = '\n\n<!-- cr-indicator-types:potential_issue -->\n\n<!-- cr-comment:v1:19978e81b5fe8320759a6f28 -->'
export const crStatus = (line) => `${CR_FINDING_END}\n\n<!-- This is an auto-generated reply by CodeRabbit -->\n\n${line}`
export const addressedIn = (from, to) => crStatus(`✅ Addressed in ${to ? `commits ${from} to ${to}` : `commit ${from}`}`)
export const review = (id, login, sha, at, body = 'Review body') => ({ id, login, commitId: sha, submittedAt: at, body, empty: body.trim() === '' })
export const codexCovers = (sha, at = T(20), commentId = 900) => ({
  codexState: { commitSha: sha, status: 'completed', at, commentId },
  codexHistory: { reviews: [{ sha, at, status: 'completed' }], complete: true, currentTrusted: true, current: { commitSha: sha, status: 'completed', at } },
})
export const verdict = (commentId, head, identity, verdictName, indices = [], at = T(15)) => ({
  head, identity, verdict: verdictName, findings: indices.map((index) => ({ index, severity: 'P1' })), commentId, at,
})
// A CodeRabbit body whose "Outside diff range comments (1)" section holds one Major finding with marker `marker`.
export const outsideDiffBody = (marker, path = 'app.js') => [
  'Actionable comments posted: 0',
  '',
  '> [!CAUTION]',
  '> Some comments are outside the diff and can’t be posted inline.',
  '> ',
  // The heading line as live CodeRabbit bodies carry it (fixtures/bot-formats.json); the parser accepts no other form.
  '> **⚠️ Outside diff range comments (1)**',
  '> ',
  '> <details>',
  '> <summary>Major · The return is wrong.</summary><blockquote>',
  '> ',
  `> \`${path}:3\``,
  '> **🟠 Major** The return is wrong.',
  `> <!-- cr-comment:v1:${marker} -->`,
  '> </blockquote></details>',
  '',
  'Nothing else.',
].join('\n')

// The CodeRabbit check of each commit a CodeRabbit review is on (state.coderabbitChecks): a successful check on every
// `sha`, so a CodeRabbit review there is usable. A fixture with a CodeRabbit review and no entry for its commit has an
// unknown check, and the review is not usable (coverage.mjs coderabbitFailedOn).
export const CR_OK = { conclusion: 'success', title: 'Review completed' }
export const crOk = (...shas) => ({ coderabbitChecks: Object.fromEntries(shas.map((s) => [s, CR_OK])) })

// The gate's state aggregate for `head` in repo `repo`, with a pull_request run on the head two hours before `now`
// (so a bot with nothing usable is past its 30-minute wait). `extra` overrides any field.
export const gateState = (repo, head, extra = {}) => ({
  pr: { number: 1, head, headRef: 'pr', headRepo: 'o/r', base: repo.sha.M0, draft: false, fork: false, dependabot: false, createdAt: T(-60) },
  reviews: [], comments: [], threads: [], requests: [], codexState: null, codexHistory: null, geminiVerdicts: [], coderabbitCheck: null,
  coderabbitChecks: {},
  runs: [{ id: 1, name: 'ci', event: 'pull_request', status: 'completed', conclusion: 'success', headSha: head, headRepo: 'o/r', createdAt: T(0), prNumbers: [1] }],
  geminiDispatchRuns: [], records: [],
  currentIdentity: repo.id[Object.keys(repo.sha).find((k) => repo.sha[k] === head)],
  identityOf: repo.identityOf, isAncestor: repo.isAncestor, resolveCommit: repo.resolveCommit, now: T(120), tooLarge: false,
  ...extra,
})

// A substitute record (schema 1) that substituteOk accepts on `identity`, by `vendor`, holding `fixedIds` as fixed by itself.
export const subRecord = ({ bot, vendor, identity, stem, fixedIds = [], openIds = [], supersedes = null }) => ({
  schema: 1, type: 'substitute', slot: `substitute:${bot}`, input: { kind: 'pr', identity, mergeBase: 'm', head: 'h' },
  reviewer: { vendor, model: 'm' }, authorVendor: 'anthropic', outcome: 'completed', verdict: openIds.length ? 'fail' : 'pass',
  findings: [
    ...fixedIds.map((id) => ({ id, severity: 'P1', summary: 'inherited', disposition: { kind: 'fixed', by: stem } })),
    ...openIds.map((id) => ({ id, severity: 'P1', summary: 'inherited' })),
  ],
  supersedes, createdAt: '2026-11-05T12:00:00Z', stem,
})

export const prRecord = (findings = [], { slots = [], reclassified = [] } = {}) => ({
  schema: 1, pr: 1, slots, findings, reclassified, writtenAt: '2026-11-05T12:00:00Z',
})
export const fixedAt = (id, commit, by) => ({ id, source: 'x', severity: 'P1', disposition: { kind: 'fixed', commit, ...(by ? { by } : {}) } })
