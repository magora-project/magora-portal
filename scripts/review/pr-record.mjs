// The PR review record's writer and checker, and the substitute run (spec §5.5, §5.6; plan Tasks 22, 23).
//
//   review.mjs pr-record --pr <n>   reads the live state, writes .review/pr/<n>.json listing every slot that is met
//                                   and every finding that blocks by default (dispositions left null for the author;
//                                   a re-draft keeps the author's dispositions for findings still blocking), then
//                                   prints review-gate's lines. Exit 0 only when the gate would pass.
//   review.mjs check --pr <n>       the same judgement, without writing.
//   review.mjs run --slot substitute:<bot> --pr <n> --author <vendor> --reviewer codex|claude|gemini [run flags]
//                                   a substitute review (runner.mjs runReview) that inherits, under their gate IDs, the
//                                   bot's live blocking findings the PR review record does not settle on its own:
//                                   undisposed ones, and `fixed` ones without the verifying evidence review-gate needs.
//
// The live state comes from the GitHub API (token: GITHUB_TOKEN, GH_TOKEN, or `gh auth token`; repository:
// GITHUB_REPOSITORY or the `origin` remote). Records are read from this checkout's work tree, uncommitted ones
// included. The judgement is review-gate's own code (scripts/ci/review-gate.mjs), so the two cannot drift.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { BOTS, REQUIRED_BOTS } from './coverage.mjs'
import { git } from './identity.mjs'
import { RUN_OPTIONS, UsageError, runReview } from './runner.mjs'
import {
  evaluateGate, gateFindings, judgeSlots, judgedDepth, prRecordPath, readGateState, readPrRecord, settledWithoutSubstitute,
} from '../ci/review-gate.mjs'

const fail = (msg) => { throw new UsageError(msg) }
const prNumber = (raw) => {
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n <= 0) fail('--pr <n> is required: the pull request number')
  return n
}
const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`)
  return r.stdout.toString().trim()
}
const repoRoot = async (cwd) => must(await git(['rev-parse', '--show-toplevel'], { cwd }), 'git rev-parse --show-toplevel')

// ---------------------------------------------------------------- live readers

// The token is never printed: only its presence is checked.
function tokenFrom(env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN
  if (env.GH_TOKEN) return env.GH_TOKEN
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: false })
  const t = r.status === 0 ? r.stdout.trim() : ''
  if (!t) throw new Error('no GitHub token: set GITHUB_TOKEN or log in with gh')
  return t
}

async function repoFrom({ env, cwd }) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY
  const url = must(await git(['remote', 'get-url', 'origin'], { cwd }), 'git remote get-url origin')
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url)
  if (!m) throw new Error(`origin (${url}) is not a GitHub repository: set GITHUB_REPOSITORY=owner/name`)
  return `${m[1]}/${m[2]}`
}

// readers({ pr, cwd, env, fetchImpl, io }) -> { state, depth }: the live state review-gate judges, from this checkout.
export async function liveReaders({ pr, cwd, env = process.env, fetchImpl = fetch, io }) {
  const token = tokenFrom(env)
  const repo = await repoFrom({ env, cwd })
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${pr}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  if (!res.ok) throw new Error(`GitHub API ${res.status} reading PR #${pr}`)
  const p = await res.json()
  for (const sha of [p.head?.sha, p.base?.sha]) {
    if ((await git(['cat-file', '-e', `${sha}^{commit}`], { cwd })).code !== 0) must(await git(['fetch', '--no-tags', '--quiet', 'origin', sha], { cwd }), `git fetch origin ${sha}`)
  }
  const local = must(await git(['rev-parse', 'HEAD'], { cwd }), 'git rev-parse HEAD')
  if (local !== p.head.sha) io?.err(`note: HEAD is ${local.slice(0, 12)}, the PR head is ${p.head.sha.slice(0, 12)}: the gate judges the PR head; records come from this work tree\n`)
  const state = await readGateState({ repo, token, fetchImpl, pr: p, cwd, recordsHead: 'HEAD', untracked: true })
  const { depth, notes } = await judgedDepth({ labels: (p.labels ?? []).map((l) => l?.name), cwd, base: p.base.sha, head: p.head.sha })
  for (const n of notes) io?.err(`${n}\n`)
  return { state, depth }
}

// ---------------------------------------------------------------- the draft

// A draft PR review record for `state` at `depth`: every required slot that is met, and every finding that blocks by
// default with the disposition `existing` gives it (null for a new one), except a thread whose bot resolution the gate
// accepts (CodeRabbit's own "Addressed in <sha>"). `existing` reclassifications are kept for
// findings still blocking; entries for findings no longer blocking are dropped.
export async function draftRecord({ state, depth, existing = null, now = () => new Date() }) {
  if (!Object.hasOwn(REQUIRED_BOTS, depth)) fail(`unknown depth ${depth}`)
  const { slots } = await judgeSlots(state)
  const required = new Set(REQUIRED_BOTS[depth].flatMap((s) => s.split('|')))
  const { blocking } = await gateFindings(state)
  const prev = new Map((existing?.findings ?? []).map((f) => [f.id, f]))
  const ids = new Set(blocking.map((f) => f.id))
  return {
    schema: 1,
    pr: state.pr.number,
    slots: BOTS.filter((b) => required.has(b) && (slots[b].status === 'covered' || slots[b].status === 'substituted')).map((b) => ({ bot: b, status: slots[b].status, by: slots[b].by })),
    findings: blocking.map((f) => ({ id: f.id, source: f.source, severity: f.severity, disposition: prev.get(f.id)?.disposition ?? null })),
    reclassified: (existing?.reclassified ?? []).filter((r) => ids.has(r.id)),
    writtenAt: now().toISOString(),
  }
}

// ---------------------------------------------------------------- pr-record / check --pr

export async function prRecordCli(argv, { cwd = process.cwd(), io, env = process.env, fetchImpl = fetch, readersImpl = liveReaders, now } = {}) {
  const [cmd, ...rest] = argv
  try {
    const { values } = parseArgs({ args: rest, options: { pr: { type: 'string' } }, strict: true, allowPositionals: false })
    const n = prNumber(values.pr)
    const root = await repoRoot(cwd)
    const { state, depth } = await readersImpl({ pr: n, cwd: root, env, fetchImpl, io })
    let record
    if (cmd === 'pr-record') {
      const prev = readPrRecord({ cwd: root, pr: n })
      if (prev.problems.length) fail(`${prev.problems.join('; ')}: fix or delete it, then run pr-record again`)
      record = await draftRecord({ state, depth, existing: prev.record, now })
      const file = join(root, prRecordPath(n))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
      io.out(`wrote ${prRecordPath(n)} (${record.findings.length} blocking finding(s), ${record.findings.filter((f) => f.disposition === null).length} without a disposition)\n`)
      for (const f of (await gateFindings(state)).blocking) io.out(`  ${f.id} (${f.source} ${f.severity})${f.path ? ` ${f.path}` : ''}: ${f.summary}\n`)
    } else {
      const r = readPrRecord({ cwd: root, pr: n })
      if (r.problems.length) { for (const p of r.problems) io.out(`FAIL record ${p}\n`); io.out('review-gate (live): FAIL\n'); return 1 }
      record = r.record
    }
    const result = await evaluateGate({ state, record, depth })
    io.out(`${result.lines.join('\n')}\n${result.ok ? 'review-gate (live): ok' : 'review-gate (live): FAIL'}\n`)
    return result.ok ? 0 : 1
  } catch (e) {
    io.err(`${cmd}: ${e && e.message}\nusage: review.mjs pr-record --pr <n> | review.mjs check --pr <n>\n`)
    return 1
  }
}

// ---------------------------------------------------------------- the substitute run

// The findings a substitute for `bot` carries (Task 22): the bot's blocking findings that the PR review record does
// not settle without a substitute (undisposed, or fixed without verifying evidence), as inherited findings.
export async function substituteCarries({ state, record, bot }) {
  const out = []
  for (const f of (await gateFindings(state)).blocking) {
    if (f.source !== bot || await settledWithoutSubstitute(f, record, state)) continue
    out.push({ id: f.id, severity: f.severity, summary: f.summary || `${bot} finding ${f.id}`, ...(f.detail ? { detail: f.detail } : {}), ...(f.path ? { file: f.path } : {}) })
  }
  return out
}

// One substitute review for `bot`. -> { code, stem, record, sentInherited } (stem and record null when no record was
// written). A failed live read writes nothing: a substitute that never saw the bot's findings could not assess them.
export async function runSubstitute({
  bot, pr, author, reviewer, supersedes, base, model, timeoutMin, cwd = process.cwd(), io, env = process.env, fetchImpl = fetch,
  readersImpl = liveReaders, adapters, now, spawnImpl,
}) {
  const none = (code) => ({ code, stem: null, record: null, sentInherited: [] })
  try {
    if (!BOTS.includes(bot)) fail(`unknown bot ${bot}: one of ${BOTS.join(', ')}`)
    const n = prNumber(pr)
    const root = await repoRoot(cwd)
    let state
    try { ({ state } = await readersImpl({ pr: n, cwd: root, env, fetchImpl, io })) } catch (e) {
      io.err(`could not read ${bot}'s live findings on PR #${n}: ${e && e.message}\n`)
      return none(1)
    }
    const prev = readPrRecord({ cwd: root, pr: n })
    if (prev.problems.length) fail(`${prev.problems.join('; ')}: fix the PR review record first`)
    const carry = await substituteCarries({ state, record: prev.record, bot })
    io.out(`${bot}: ${carry.length} live finding(s) to assess${carry.length ? ` (${carry.map((f) => f.id).join(', ')})` : ''}\n`)
    let written = null
    const o = { slot: `substitute:${bot}`, author, reviewer, supersedes, base, model, 'timeout-min': timeoutMin }
    const code = await runReview(o, { cwd: root, io, env, fetchImpl, now, spawnImpl, adapters, inheritExtra: carry, onWritten: (w) => { written = w } })
    return written ? { code, stem: written.stem, record: written.record, sentInherited: written.inheritedIds } : none(code)
  } catch (e) {
    io.err(`${e && e.message}\n`)
    return none(1)
  }
}

export const SUBSTITUTE_OPTIONS = { ...RUN_OPTIONS, pr: { type: 'string' } }

// `review.mjs run --slot substitute:<bot> --pr <n> ...`
export async function substituteCli(argv, { cwd = process.cwd(), io, env = process.env, fetchImpl = fetch, readersImpl, spawnImpl } = {}) {
  let o
  try { ({ values: o } = parseArgs({ args: argv, options: SUBSTITUTE_OPTIONS, strict: true, allowPositionals: false })) } catch (e) {
    io.err(`${e.message}\n`)
    return 1
  }
  if (o.path !== undefined || o.tasks !== undefined || o.rev !== undefined) { io.err('--path, --tasks and --rev are not for substitute slots\n'); return 1 }
  if (o.pr === undefined) { io.err('a substitute run needs --pr <n>: it inherits the bot\'s live findings on that pull request\n'); return 1 }
  const r = await runSubstitute({
    bot: String(o.slot).slice('substitute:'.length), pr: o.pr, author: o.author, reviewer: o.reviewer, supersedes: o.supersedes, base: o.base,
    model: o.model, timeoutMin: o['timeout-min'], cwd, io, env, fetchImpl, spawnImpl, ...(readersImpl ? { readersImpl } : {}),
  })
  return r.code
}
