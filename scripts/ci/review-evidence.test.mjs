// Self-test for scripts/ci/review-evidence.mjs and the review.mjs check --local / init-local subcommands.
// Scratch git repos live in mkdtemp and are deleted afterwards; no real network (fetchImpl is stubbed).
// Run: node scripts/ci/review-evidence.test.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'review-evidence-test-'))
const emptyConfig = join(root, 'empty.gitconfig')
writeFileSync(emptyConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const { evaluate, isGrandfathered, localCheck, main, requiredDepth, requiredSlots } = await import('./review-evidence.mjs')
const { reviewCli } = await import('../review/review.mjs')
const { inputIdentity } = await import('../review/identity.mjs')
const { expandTasks, parseBody } = await import('../review/pr-body.mjs')

let pass = 0, fail = 0
// A thenable condition is a failure: a Promise is truthy even when it resolves to false.
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const failsWith = (r, re) => r.ok === false && (typeof re === 'string' ? r.lines.join('\n').includes(re) : re.test(r.lines.join('\n'))) // a negative check names the guard that fired

// ---------- scratch git ----------
let seq = 0
const raw = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
const commit = (cwd, msg) => {
  raw(cwd, ['add', '-A'])
  raw(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg])
  return raw(cwd, ['rev-parse', 'HEAD'])
}
const put = (cwd, file, text) => {
  const p = join(cwd, file)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
const mkrepo = () => {
  const dir = join(root, `r${++seq}`)
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { shell: false })
  // review-evidence reads the control-file list from AGENTS.md (the depth floor); every scratch repo has one.
  put(dir, 'AGENTS.md', AGENTS)
  return dir
}
const AGENTS = '# AGENTS\n\n## Control files\n\n`.github/**`, `scripts/ci/**`, `package.json`.\n\n## Next\n'
const filler = (p) => Array.from({ length: 8 }, (_, i) => `${p}${i}`)
const app = (b, ret) => [...filler('top'), 'def f(x):', '    a = 1', `    b = ${b}`, '    c = 3', `    ${ret}`, ...filler('bot')].join('\n') + '\n'
// A repo with `main` (one commit) and branch `pr` (one change) checked out.
const prRepo = () => {
  const dir = mkrepo()
  put(dir, 'app.py', app(2, 'return a + b + c'))
  const base = commit(dir, 'base')
  raw(dir, ['checkout', '-q', '-b', 'pr'])
  put(dir, 'app.py', app(20, 'return a + b + c'))
  const head = commit(dir, 'pr change')
  return { dir, base, head }
}

// ---------- record fixtures ----------
const ID = 'b'.repeat(40)
const SPEC = { path: 'docs/superpowers/specs/s.md', identity: 'c'.repeat(40) }
const PLAN = { path: 'docs/superpowers/plans/p.md', identity: 'd'.repeat(40) }
const TYPE = { spec: 'spec', plan: 'plan', conformance: 'conformance', correctness: 'prepush', completeness: 'prepush' }
const PREPUSH = ['correctness', 'completeness']
const rec = ({ slot, stem, input, vendor = 'openai', authorVendor = 'anthropic', ...rest }) => ({
  schema: 1, type: TYPE[slot], slot, input, reviewer: { vendor, model: 'm' }, authorVendor,
  outcome: 'completed', verdict: 'pass', findings: [], supersedes: null, createdAt: '2026-11-05T00:00:00Z', stem, ...rest,
})
const finding = (f) => ({ summary: 'a finding', ...f })
const failedOld = rec({ slot: 'correctness', stem: 'correctness--old--1', input: { kind: 'pr', identity: ID }, outcome: 'failed', verdict: null })
const passingNew = rec({ slot: 'correctness', stem: 'correctness--new--1', input: { kind: 'pr', identity: ID }, supersedes: 'correctness--old--1' })
const passingOld = rec({ slot: 'correctness', stem: 'correctness--old--2', input: { kind: 'pr', identity: ID } })
const failingNew = rec({ slot: 'correctness', stem: 'correctness--new--2', input: { kind: 'pr', identity: ID }, supersedes: 'correctness--old--2', findings: [finding({ id: 'F9', severity: 'P1' })] })

// Builds evaluate()'s arguments. Defaults: specced, standard, every required record passing.
// Overrides of outcome/verdict/findings apply to the correctness record.
function fx(o = {}) {
  const lane = o.lane ?? 'specced'
  const depth = o.depth ?? 'standard'
  const identity = o.identity ?? ID
  const recId = o.recordIdentity ?? identity
  const authorVendor = o.authorVendor ?? 'anthropic'
  const vendorFor = (slot) => o.reviewerVendor ?? (slot === 'completeness' ? (o.completenessVendor ?? 'google') : slot === 'correctness' ? (o.correctnessVendor ?? 'openai') : 'openai')
  const bodyTasks = o.bodyTasks ?? 'T1-T3'
  const bodyDevs = o.bodyDeviations ?? []
  const text = [`Lane: ${lane}`,
    ...(lane === 'specced' ? [`Spec: ${SPEC.path}`, `Plan: ${PLAN.path} ${bodyTasks}`] : []),
    bodyDevs.length ? 'Deviations:' : 'Deviations: none',
    ...bodyDevs.map((d) => `- ${d}: the plan's version is not needed; the built one is simpler`)].join('\n')
  const body = parseBody(text)
  const changedDocs = ['specced', 'docs-only'].includes(lane) ? [{ slot: 'spec', ...SPEC }, { slot: 'plan', ...PLAN }] : []
  const required = requiredSlots({ lane, depth, changedDocs })
  let records = o.records
  if (records === undefined) {
    records = required.map(({ slot, input }) => {
      const r = rec({
        slot, stem: `${slot}--x--1`, vendor: vendorFor(slot), authorVendor,
        input: input.kind === 'blob' ? { ...input } : { kind: 'pr', identity: recId },
      })
      if (slot === 'correctness') {
        if (o.outcome !== undefined) r.outcome = o.outcome
        if (o.verdict !== undefined) r.verdict = o.verdict
        if (o.findings !== undefined) r.findings = o.findings.map(finding)
      }
      if (slot === 'conformance') {
        const devs = o.deviations ?? []
        r.conformance = { tasks: o.conformanceTasks ?? expandTasks(bodyTasks), deviations: devs, commands: o.commands ?? [], plan: o.conformancePlan ?? { path: PLAN.path, blob: PLAN.identity } }
        if (devs.includes('D1')) r.findings = [finding({ id: 'D1', severity: 'P1', ...(o.d1Disposition ? { disposition: { kind: o.d1Disposition, reason: 'see Deviations' } } : {}) })]
      }
      return r
    })
    if (o.only) records = records.filter((r) => !PREPUSH.includes(r.slot) || o.only.includes(r.slot))
    if (o.chain) records = [...records.filter((r) => r.slot !== 'correctness'), ...o.chain]
  }
  if (o.invalid) records = [...records, { stem: o.invalid, invalid: ['schema: must be 1'] }]
  return { records, required, identity, body }
}

// ---------- API stubs ----------
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const goodEnv = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '7' }
const prCreatedAt = (createdAt, scen) => ({ ...scen, createdAt })
// A fetch stub serving the PR and its labels from `scen`, and the activation file from `activation(url)`.
const prFetch = (scen, activation, calls = []) => {
  let prReads = 0
  const f = async (url) => {
    calls.push(url)
    const u = new URL(url)
    if (u.pathname === '/repos/o/r/pulls/7') {
      return res(200, {
        number: 7, body: scen.body ?? 'Lane: direct\nDeviations: none', user: { login: 'dev' }, created_at: scen.createdAt,
        base: { sha: scen.base, ref: 'main' }, head: { sha: scen.head }, labels: (scen.labelsSeq ? scen.labelsSeq[Math.min(prReads++, scen.labelsSeq.length - 1)] : (scen.labels ?? ['standard'])).map((name) => ({ name })),
      })
    }
    if (u.pathname === '/repos/o/r/contents/.github/review-activation.json') return activation(url)
    return res(404, { message: 'Not Found' })
  }
  f.calls = calls
  f.cwd = scen.dir
  return f
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const activationFile = (obj, calls = []) => (scen) => prFetch(scen, () => res(200, { encoding: 'base64', content: b64(JSON.stringify(obj)) }), calls)
const activationFile404 = (scen) => prFetch(scen, () => res(404, { message: 'Not Found' }))
const activationFails500 = (scen) => prFetch(scen, () => res(500, { message: 'boom' }))
const stub403 = Object.assign(async () => res(403, { message: 'Forbidden' }), { calls: [] })
// Runs fn with console output captured. Returns { code, out } with out always a string.
const quiet = async (fn) => {
  const { log, error } = console
  const out = []
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try { return { code: await fn(), out: out.join('\n') } } finally { console.log = log; console.error = error }
}
// main() against the scratch repo the stub was built for (the checkout CI would have).
const runMain = async (fetchImpl, extra = {}) => ({ ...(await quiet(() => main({ env: goodEnv, fetchImpl, cwd: fetchImpl.cwd, ...extra }))), calls: fetchImpl.calls })

try {
  // ---------- real-repo identities (evidence-only commit, merge from main) ----------
  const r1 = prRepo()
  const idBefore = await inputIdentity({ cwd: r1.dir, base: 'main', head: 'pr' })
  put(r1.dir, '.review/records/x.json', '{}\n')
  commit(r1.dir, 'evidence only')
  const idAfter = await inputIdentity({ cwd: r1.dir, base: 'main', head: 'pr' })
  raw(r1.dir, ['checkout', '-q', 'main'])
  put(r1.dir, 'app.py', 'new1\nnew2\n' + app(2, 'return a + b'))
  commit(r1.dir, 'main edits next to the PR line')
  raw(r1.dir, ['checkout', '-q', 'pr'])
  raw(r1.dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-edit', '-q', 'main'])
  const idAfterMainMerge = await inputIdentity({ cwd: r1.dir, base: 'main', head: 'pr' })

  // ---------- plan Task 15 Step 1 (spec §5.3 negative tests and the Review Focus items) ----------
  ok('failed run with zero findings -> FAIL', failsWith(evaluate(fx({ outcome: 'failed', verdict: 'pass', findings: [] })), /failed/))
  ok('PASS verdict with an open blocking finding -> FAIL', failsWith(evaluate(fx({ verdict: 'pass', findings: [{ id: 'F1', severity: 'P1' }] })), /F1/))
  ok('subtle-correctness missing completeness -> FAIL naming the slot', /completeness/.test(evaluate(fx({ depth: 'subtle-correctness', only: ['correctness'] })).lines.join()))
  ok('stale identity -> FAIL', failsWith(evaluate(fx({ recordIdentity: 'aaa', identity: 'bbb' })), /identity/))
  ok('evidence-only commit voids nothing (identity from a real repo before and after)', idBefore === idAfter && evaluate(fx({ identity: idAfter, recordIdentity: idBefore })).ok)
  ok('merge from main next to the PR lines voids nothing', idBefore === idAfterMainMerge)
  ok('conformance task-scope edit (Plan T1-T3 -> T1-T4) -> FAIL', failsWith(evaluate(fx({ conformanceTasks: ['T1', 'T2', 'T3'], bodyTasks: 'T1-T4' })), /T4/))
  ok('unfixed deviation IDs must exactly match the Deviations field', failsWith(evaluate(fx({ deviations: ['D1', 'D2'], bodyDeviations: ['D1'] })), /D2/))
  ok('a justified, unfixed deviation (including a failed postcondition) passes', evaluate(fx({ deviations: ['D1'], bodyDeviations: ['D1'], d1Disposition: 'justified-deviation', commands: [{ cmd: 'npm test', exit: 1 }] })).ok)
  const emptyRepo = mkrepo()
  put(emptyRepo, 'a.txt', 'a\n')
  commit(emptyRepo, 'init')
  ok('no local.json -> not ok, names init-local', /init-local/.test((await localCheck({ cwd: emptyRepo })).lines.join()))
  ok('reviewer vendor equals author vendor -> FAIL', failsWith(evaluate(fx({ reviewerVendor: 'anthropic', authorVendor: 'anthropic' })), /vendor/))
  ok('completeness from the same vendor as correctness -> FAIL', failsWith(evaluate(fx({ depth: 'subtle-correctness', correctnessVendor: 'openai', completenessVendor: 'openai' })), /vendor/))
  ok('a superseded record is not judged; its chain head is', evaluate(fx({ chain: [failedOld, passingNew] })).ok)
  ok('an invalid record file fails by name', /records\/bad\.json/.test(evaluate(fx({ invalid: 'bad' })).lines.join()))
  ok('identity "empty" on a direct PR -> FAIL with "no changes outside .review/"', /no changes outside/.test(evaluate(fx({ identity: 'empty', lane: 'direct' })).lines.join()))
  ok('mechanical direct PR needs no record', evaluate(fx({ lane: 'direct', depth: 'mechanical', records: [] })).ok)
  ok('dependency lane needs one correctness record', failsWith(evaluate(fx({ lane: 'dependency', records: [] })), /correctness/))
  ok('a PR created one second before requiredSince is exempt', isGrandfathered({ prCreatedAt: '2026-11-04T23:59:59Z', requiredSince: '2026-11-05T00:00:00Z' }))
  ok('a PR created one second after requiredSince is judged', isGrandfathered({ prCreatedAt: '2026-11-05T00:00:01Z', requiredSince: '2026-11-05T00:00:00Z' }) === false)
  ok('unset or empty requiredSince exempts nothing', isGrandfathered({ prCreatedAt: '2020-01-01T00:00:00Z', requiredSince: undefined }) === false && isGrandfathered({ prCreatedAt: '2020-01-01T00:00:00Z', requiredSince: '' }) === false)

  // main() scenarios: a scratch checkout of the PR head, with no records or with a passing correctness record.
  const noRecords = prRepo()
  const passingRecords = prRepo()
  {
    const identity = await inputIdentity({ cwd: passingRecords.dir, base: passingRecords.base, head: 'HEAD' })
    put(passingRecords.dir, '.review/records/correctness--a--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity } })) + '\n')
    passingRecords.head = commit(passingRecords.dir, 'evidence')
  }
  ok('activation file: an old PR is exempt, a new one judged, read at the base ref', (await (async () => { const calls = []; const f = activationFile({ 'review-evidence': '2026-11-05T00:00:00Z' }, calls); const oldCode = (await runMain(f(prCreatedAt('2026-11-04T23:59:59Z', noRecords)))).code; const newCode = (await runMain(f(prCreatedAt('2026-11-05T00:00:01Z', noRecords)))).code; const act = calls.filter((u) => u.includes('review-activation.json')); return oldCode === 0 && newCode === 1 && act.length > 0 && act.every((u) => u.includes('ref=main')) })()))
  ok('activation file 404 -> judged, not exempt: the failure names the missing slot, not "could not judge"', await (async () => { const r = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', noRecords))); return r.code === 1 && r.out !== '' && /correctness/.test(r.out) && /could not judge/.test(r.out) === false })())
  ok('an unparseable activation value -> exit 1 and "could not judge"', await (async () => { const r = await runMain(activationFile({ 'review-evidence': 'soon' })(prCreatedAt('2020-01-01T00:00:00Z', passingRecords))); return r.code === 1 && /could not judge/.test(r.out) })())
  ok('activation read fails (500) after every PR-state read succeeded -> exit 1 and "could not judge", even with passing records', await (async () => { const r = await runMain(activationFails500(prCreatedAt('2020-01-01T00:00:00Z', passingRecords))); return r.code === 1 && /could not judge/.test(r.out) && r.calls.some((u) => u.includes('review-activation.json')) })())
  ok('API error -> exit 1 "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: stub403, cwd: noRecords.dir })); return r.code === 1 && /could not judge/.test(r.out) })())

  // ---------- further cases: predicate details and decisions ----------
  ok('positive control: the default specced/standard fixture passes', evaluate(fx()).ok)
  ok('positive control: subtle-correctness with three distinct vendors passes', evaluate(fx({ depth: 'subtle-correctness' })).ok)
  ok('a passing record superseded by a failing one -> FAIL (the head is judged, not the old record)', failsWith(evaluate(fx({ chain: [passingOld, failingNew] })), /F9/))
  ok('a P3 finding needs no disposition', evaluate(fx({ findings: [{ id: 'F1', severity: 'P3' }] })).ok)
  ok('an unparseable severity blocks', failsWith(evaluate(fx({ findings: [{ id: 'F1', severity: 'high' }] })), /F1/))
  ok('completed with a null verdict is not a recognized result', failsWith(evaluate(fx({ verdict: null })), /recognized/))
  ok('refused / truncated / timeout outcomes fail by name', ['refused', 'truncated', 'timeout'].every((outcome) => failsWith(evaluate(fx({ outcome, verdict: null })), outcome)))
  ok('a fail verdict whose every finding is acceptably disposed passes ("whatever the verdict")', evaluate(fx({ verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', disposition: { kind: 'reclassified-nit', reason: 'style only' } }] })).ok)
  {
    const withFixed = (by) => { const f = fx(); const c = f.records.find((r) => r.slot === 'correctness'); c.findings = [finding({ id: 'F1', severity: 'P1', disposition: { kind: 'fixed', by } })]; return f }
    ok('a fixed finding whose by names this chain passes', evaluate(withFixed('correctness--x--1')).ok)
    ok('a fixed finding whose by names no record in the chain -> FAIL', failsWith(evaluate(withFixed('correctness--nope--1')), /F1.*nope|nope.*F1/))
    const f = fx({ chain: [failedOld, { ...passingNew, findings: [finding({ id: 'F2', severity: 'P0', disposition: { kind: 'fixed', by: 'correctness--old--1' } })] }] })
    ok('a fixed finding whose by names an earlier record of the same chain passes', evaluate(f).ok)
  }
  ok('justified-deviation on a non-conformance record -> FAIL', failsWith(evaluate(fx({ findings: [{ id: 'D1', severity: 'P1', disposition: { kind: 'justified-deviation', reason: 'x' } }], bodyDeviations: ['D1'], deviations: ['D1'], d1Disposition: 'justified-deviation' })), /D1/))
  ok('an unfixed deviation with no disposition -> FAIL', failsWith(evaluate(fx({ deviations: ['D1'], bodyDeviations: ['D1'] })), /D1/))
  ok('a Deviations entry with no conformance deviation -> FAIL naming it', failsWith(evaluate(fx({ deviations: [], bodyDeviations: ['D3'] })), /D3/))
  // a conformance record is bound to the plan it checked (path and blob)
  ok('conformance on the Plan field\'s path and its blob at the head -> ok', evaluate(fx()).ok === true)
  ok('conformance that checked another plan path -> FAIL naming both paths', failsWith(evaluate(fx({ conformancePlan: { path: 'docs/superpowers/plans/other.md', blob: PLAN.identity } })), /conformance.*other\.md.*p\.md/))
  ok('conformance that checked an older blob of the plan -> FAIL naming the blobs', failsWith(evaluate(fx({ conformancePlan: { path: PLAN.path, blob: 'f'.repeat(40) } })), /conformance.*ffffffffffff.*dddddddddddd/))
  ok('conformance whose Plan field path is not in the head -> FAIL', (() => { const f = fx(); f.required = f.required.map((r) => (r.slot === 'plan' ? { ...r, input: { ...r.input, identity: null, error: 'x is not in the PR head' } } : r)); return failsWith(evaluate(f), /conformance.*not in the PR head/) })())
  ok('an explicit planDoc overrides the required plan entry', failsWith(evaluate({ ...fx(), planDoc: { path: PLAN.path, identity: 'a'.repeat(40) } }), /conformance.*aaaaaaaaaaaa/))
  ok('conformance tasks are order-insensitive', evaluate(fx({ conformanceTasks: ['T3', 'T1', 'T2'] })).ok)
  ok('a conformance record covering extra tasks -> FAIL naming them', failsWith(evaluate(fx({ conformanceTasks: ['T1', 'T2', 'T3', 'T5'] })), /T5/))
  ok('body problems fail the check, one line each', (() => { const f = fx(); f.body = parseBody('Lane: specced\nSpec: s.md\nDeviations: none'); return failsWith(evaluate(f), /Plan: required/) })())
  ok('a stale spec blob -> FAIL', (() => { const f = fx(); f.records.find((r) => r.slot === 'spec').input.identity = 'e'.repeat(40); return failsWith(evaluate(f), /spec.*identity/) })())
  ok('a missing conformance record names the conformance command, not run --slot conformance, which refuses', (() => { const f = fx(); f.records = f.records.filter((r) => r.slot !== 'conformance'); const t = evaluate(f).lines.join('\n'); return /conformance.*no record/.test(t) && /npm run review -- conformance --plan/.test(t) && /arrives with/.test(t) === false && /run --slot conformance/.test(t) === false })())
  ok('a spec record for another path does not count',(() => { const f = fx(); f.records.find((r) => r.slot === 'spec').input.path = 'docs/superpowers/specs/other.md'; return failsWith(evaluate(f), /spec .*no record/) })())
  ok('records on one input that disagree on authorVendor -> FAIL naming them', (() => { const f = fx(); f.records.push(rec({ slot: 'correctness', stem: 'correctness--y--1', vendor: 'google', authorVendor: 'openai', input: { kind: 'pr', identity: ID } })); return failsWith(evaluate(f), /authorVendor.*correctness--y--1/) })())
  ok('two independent chains: one passing head is enough (decision)', (() => { const f = fx(); f.records.push(rec({ slot: 'correctness', stem: 'correctness--z--1', outcome: 'timeout', verdict: null, input: { kind: 'pr', identity: ID } })); return evaluate(f).ok })())
  ok('docs-only with no spec or plan changed -> FAIL', failsWith(evaluate({ ...fx({ lane: 'direct' }), required: requiredSlots({ lane: 'docs-only', depth: 'mechanical', changedDocs: [] }), body: parseBody('Lane: docs-only\nDeviations: none') }), /docs-only/))
  ok('requiredSlots: specced subtle-correctness', JSON.stringify(requiredSlots({ lane: 'specced', depth: 'subtle-correctness', changedDocs: [{ slot: 'spec', ...SPEC }] }).map((r) => r.slot)) === '["spec","conformance","correctness","completeness"]')
  ok('requiredSlots: docs-only ignores depth', JSON.stringify(requiredSlots({ lane: 'docs-only', depth: 'subtle-correctness', changedDocs: [{ slot: 'plan', ...PLAN }] }).map((r) => r.slot)) === '["plan"]')
  ok('requiredSlots: dependency is one correctness at any depth', JSON.stringify(requiredSlots({ lane: 'dependency', depth: 'subtle-correctness' }).map((r) => r.slot)) === '["correctness"]')
  ok('requiredSlots: unknown depth throws', (() => { try { requiredSlots({ lane: 'direct', depth: 'deep' }); return false } catch { return true } })())
  ok('isGrandfathered: an unparseable requiredSince exempts nothing', isGrandfathered({ prCreatedAt: '2020-01-01T00:00:00Z', requiredSince: 'soon' }) === false)
  ok('isGrandfathered: an unparseable prCreatedAt is judged', isGrandfathered({ prCreatedAt: 'yesterday', requiredSince: '2026-11-05T00:00:00Z' }) === false)
  // ---------- O-P2-1: a passing head does not excuse an open blocking finding left by a completed head this PR added ----------
  {
    const openHead = (over = {}) => rec({ slot: 'correctness', stem: 'correctness--open--1', input: { kind: 'pr', identity: ID }, verdict: 'fail', findings: [finding({ id: 'F1', severity: 'P1' })], ...over })
    const freshRoot = rec({ slot: 'correctness', stem: 'correctness--fresh--1', input: { kind: 'pr', identity: ID } })
    const withAdded = (chain, added) => ({ ...fx({ chain }), addedStems: added })
    const all = (f) => new Set(f.records.map((r) => r.stem))
    const a = fx({ chain: [openHead(), freshRoot] })
    ok('scenario A (same identity: open completed head + a passing fresh root, both added) -> FAIL naming the record and the finding', failsWith(evaluate({ ...a, addedStems: all(a) }), /correctness--open--1.*F1/))
    const b = fx({ chain: [openHead({ input: { kind: 'pr', identity: 'a'.repeat(40) } }), freshRoot] })
    ok('scenario B (forgotten --supersedes: the open head is stale) -> FAIL naming it', failsWith(evaluate({ ...b, addedStems: all(b) }), /correctness--open--1.*F1/))
    ok('with no addedStems given every record counts as added (fail closed)', failsWith(evaluate(fx({ chain: [openHead(), freshRoot] })), /correctness--open--1/))
    const baseOnly = withAdded([openHead(), freshRoot], new Set(['spec--x--1', 'plan--x--1', 'conformance--x--1', 'correctness--fresh--1']))
    ok('an open completed head that is only on the base (another PR\'s) does not fail the slot', evaluate(baseOnly).ok)
    const base2 = withAdded([openHead({ verdict: 'pass', findings: [] })], new Set(['spec--x--1', 'plan--x--1', 'conformance--x--1']))
    ok('a passing record that is only on the base still counts as passing evidence', evaluate(base2).ok)
    const nc = fx({ chain: [openHead({ outcome: 'timeout', verdict: null }), freshRoot] })
    ok('a non-completed added head still carrying an undisposed blocking finding (a failed re-review), plus a passing fallback chain -> FAIL naming it', failsWith(evaluate({ ...nc, addedStems: all(nc) }), /correctness--open--1.*F1/))
    const ncEmpty = fx({ chain: [openHead({ outcome: 'timeout', verdict: null, findings: [] }), freshRoot] })
    ok('a non-completed added head with no findings, plus a passing fallback chain -> passes (reviewer fallback)', evaluate({ ...ncEmpty, addedStems: all(ncEmpty) }).ok)
    const p3 = fx({ chain: [openHead({ findings: [finding({ id: 'F1', severity: 'P3' })] }), freshRoot] })
    ok('an added completed head whose only finding is a P3 does not fail', evaluate({ ...p3, addedStems: all(p3) }).ok)
    const disposed = fx({ chain: [openHead({ findings: [finding({ id: 'F1', severity: 'P1', disposition: { kind: 'reclassified-nit', reason: 'r' } })] }), freshRoot] })
    ok('an added completed head whose finding is disposed does not fail', evaluate({ ...disposed, addedStems: all(disposed) }).ok)
    // mark-reviewed Codex P1 (2026-11-06): lowering the depth must not drop an open finding a review this PR added
    const openCompleteness = rec({ slot: 'completeness', stem: 'completeness--open--1', vendor: 'google', input: { kind: 'pr', identity: ID }, verdict: 'fail', findings: [finding({ id: 'F4', severity: 'P1' })] })
    const lowered = fx({ depth: 'standard' })
    lowered.records = [...lowered.records, openCompleteness]
    ok('an added head with an open finding in a slot this depth does not require -> FAIL naming it', failsWith(evaluate({ ...lowered, addedStems: all(lowered) }), /completeness--open--1.*F4/))
    const mechLowered = fx({ lane: 'direct', depth: 'mechanical', records: [openHead()] })
    ok('mechanical depth with an added correctness head left open -> FAIL naming it', failsWith(evaluate({ ...mechLowered, addedStems: all(mechLowered) }), /correctness--open--1.*F1/))
    const loweredBase = fx({ depth: 'standard' })
    loweredBase.records = [...loweredBase.records, openCompleteness]
    ok('the same open head only on the base (another PR\'s) does not fail', evaluate({ ...loweredBase, addedStems: new Set(loweredBase.records.filter((r) => r !== openCompleteness).map((r) => r.stem)) }).ok)
    const sup = fx({ chain: [openHead(), { ...freshRoot, supersedes: 'correctness--open--1' }] })
    ok('a superseded open record is not a head: the chain head is judged', evaluate({ ...sup, addedStems: all(sup) }).ok)
  }

  ok('isGrandfathered: created exactly at requiredSince is judged',isGrandfathered({ prCreatedAt: '2026-11-05T00:00:00Z', requiredSince: '2026-11-05T00:00:00Z' }) === false)

  {
    const r = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', passingRecords)))
    ok('main: passing records and no activation file -> exit 0, one ok line per slot', r.code === 0 && /^ok correctness /m.test(r.out))
    const order = r.calls.map((u) => new URL(u).pathname)
    ok('main: the activation file is read after the PR state', order.indexOf('/repos/o/r/contents/.github/review-activation.json') > order.indexOf('/repos/o/r/pulls/7') && order.indexOf('/repos/o/r/pulls/7') >= 0)
  }
  {
    const r = await runMain(activationFile({ other: 'x' })(prCreatedAt('2020-01-01T00:00:00Z', passingRecords)))
    ok('main: an activation file without the review-evidence key exempts nothing (judged, passes on records)', r.code === 0 && /grandfathered/.test(r.out) === false && r.out !== '')
  }
  {
    const r = await runMain(activationFile({ 'review-evidence': '2026-11-05T00:00:00Z' })(prCreatedAt('2026-11-04T00:00:00Z', noRecords)))
    ok('main: an exempt PR prints "grandfathered"', r.code === 0 && /grandfathered/.test(r.out))
  }
  {
    const r = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...passingRecords, head: noRecords.head })))
    ok('main: API head differs from the checkout -> "could not judge"', r.code === 1 && /could not judge/.test(r.out) && /head/.test(r.out))
  }
  // mark-reviewed Codex P2 (2026-11-06): label-gate's auto-label, written with the workflow token, starts no run, so a
  // run that read the labels before it landed must not stay red. Label count is label-gate's check, not this one.
  {
    const none = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...passingRecords, labels: [] })), { sleep: async () => {} })
    ok('main: no depth label -> judged at standard (the lowest the bot applies), naming label-gate; passes on a correctness record', none.code === 0 && /no depth label.*standard/.test(none.out) && /label-gate/.test(none.out))
    const two = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...passingRecords, labels: ['standard', 'subtle-correctness'] })), { sleep: async () => {} })
    ok('main: two depth labels -> judged at the higher one (fails here: no completeness record)', two.code === 1 && /subtle-correctness/.test(two.out) && /FAIL completeness/.test(two.out) && !/could not judge/.test(two.out))
    const mixed = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...passingRecords, labels: ['mechanical', 'standard'] })), { sleep: async () => {} })
    ok('main: mechanical beside standard -> judged at standard (passes on a correctness record)', mixed.code === 0)
    const seq = (labelsSeq) => ({ ...noRecords, labelsSeq })
    const settled = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', seq([['standard', 'mechanical'], ['mechanical']]))), { sleep: async () => {} })
    ok('main: a person\'s mechanical beside the bot\'s standard, then the bot removes its own -> re-read, judged at mechanical, passes', settled.code === 0 && settled.calls.filter((u) => u.endsWith('/pulls/7')).length === 2)
    const landed = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', seq([[], [], ['standard']]))), { sleep: async () => {} })
    ok('main: no label, then the bot\'s standard lands -> re-read until one, judged at standard (fails: no records)', landed.code === 1 && /FAIL correctness/.test(landed.out) && !/no depth label/.test(landed.out))
    let slept = 0
    const never = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', seq([['standard', 'mechanical']]))), { sleep: async () => { slept++ } })
    ok('main: labels that never settle -> bounded re-reads, then the highest', never.code === 1 && slept > 0 && slept < 10 && /several depth labels/.test(never.out))
    const noneBare = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...noRecords, labels: [] })), { sleep: async () => {} })
    ok('main: no depth label and no records -> FAIL naming correctness (judged at standard, not mechanical)', noneBare.code === 1 && /FAIL correctness/.test(noneBare.out) && !/could not judge/.test(noneBare.out))
    const mech = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...noRecords, labels: ['mechanical'] })))
    ok('main: one mechanical label on an ordinary path -> needs no record', mech.code === 0)
  }
  {
    const r = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', { ...passingRecords, body: 'no fields here' })))
    ok('main: a body with no Lane fails, naming the field', r.code === 1 && /Lane: missing/.test(r.out))
  }
  {
    const r = await quiet(() => main({ env: { GITHUB_REPOSITORY: 'o/r' }, fetchImpl: stub403, cwd: noRecords.dir }))
    ok('main: missing env -> "could not judge"', r.code === 1 && /could not judge/.test(r.out))
  }
  {
    const bad = activationFile404(prCreatedAt('2020-01-01T00:00:00Z', passingRecords))
    put(passingRecords.dir, '.review/records/zz.json', '{not json\n')
    const r = await runMain(bad)
    rmSync(join(passingRecords.dir, '.review/records/zz.json'))
    ok('main: an invalid record file fails the run by name', r.code === 1 && /records\/zz\.json/.test(r.out))
  }
  {
    // docs-only: the changed spec is found by the diff and judged by its blob at head. The PR changes only the spec.
    const dd = mkrepo()
    put(dd, 'app.py', app(2, 'return a + b + c'))
    const d = { dir: dd, base: commit(dd, 'base') }
    raw(dd, ['checkout', '-q', '-b', 'pr'])
    put(d.dir, 'docs/superpowers/specs/new.md', '# spec\n')
    commit(d.dir, 'add spec')
    const blob = raw(d.dir, ['rev-parse', 'HEAD:docs/superpowers/specs/new.md'])
    const scen = { ...d, head: raw(d.dir, ['rev-parse', 'HEAD']), body: 'Lane: docs-only\nDeviations: none', labels: ['mechanical'] }
    const r1 = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', scen)))
    ok('main docs-only: a changed spec with no record fails naming it', r1.code === 1 && /FAIL spec docs\/superpowers\/specs\/new\.md/.test(r1.out))
    put(d.dir, '.review/records/spec--b--1.json', JSON.stringify(rec({ slot: 'spec', stem: undefined, input: { kind: 'blob', path: 'docs/superpowers/specs/new.md', identity: blob } })) + '\n')
    scen.head = commit(d.dir, 'evidence')
    const r2 = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', scen)))
    ok('main docs-only: a record for the current blob passes', r2.code === 0 && /^ok spec /m.test(r2.out))
  }

  // ---------- O-P2-1 through main() and localCheck: "added by this PR" comes from git ----------
  {
    // main has a record with an open finding (another PR's); the PR adds a passing one.
    const dir = mkrepo()
    put(dir, 'app.py', app(2, 'return a + b + c'))
    put(dir, '.review/records/correctness--base--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity: 'a'.repeat(40) }, verdict: 'fail', findings: [finding({ id: 'F1', severity: 'P1' })] })) + '\n')
    const base = commit(dir, 'base with an old record')
    raw(dir, ['checkout', '-q', '-b', 'pr'])
    put(dir, 'app.py', app(20, 'return a + b + c'))
    commit(dir, 'pr change')
    const identity = await inputIdentity({ cwd: dir, base, head: 'HEAD' })
    put(dir, '.review/records/correctness--pr--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity } })) + '\n')
    const head = commit(dir, 'evidence')
    const scen = { dir, base, head }
    const r1 = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', scen)))
    ok('main: an open completed head that is only on the base does not fail the PR', r1.code === 0 && /^ok correctness /m.test(r1.out))
    // the PR now also adds a completed record with an open finding on a stale identity (a forgotten --supersedes)
    put(dir, '.review/records/correctness--stale--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity: 'c'.repeat(40) }, verdict: 'fail', findings: [finding({ id: 'F7', severity: 'P1' })] })) + '\n')
    scen.head = commit(dir, 'evidence 2')
    const r2 = await runMain(activationFile404(prCreatedAt('2020-01-01T00:00:00Z', scen)))
    ok('main: a completed head this PR added with an open finding fails the slot, naming it, despite a passing head', r2.code === 1 && /correctness--stale--1.*F7/.test(r2.out))
    // localCheck: the same open head as an untracked file
    raw(dir, ['reset', '-q', '--hard', head])
    put(dir, '.review/records/correctness--untracked--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity }, verdict: 'fail', findings: [finding({ id: 'F8', severity: 'P1' })] })) + '\n')
    writeFileSync(join(dir, '.review/local.json'), JSON.stringify({ lane: 'direct', depth: 'standard' }) + '\n')
    raw(dir, ['branch', '-f', 'main', base])
    const lc = await localCheck({ cwd: dir })
    ok('localCheck: an untracked completed head with an open finding fails the slot, naming it', failsWith(lc, /correctness--untracked--1.*F8/))
    rmSync(join(dir, '.review/records/correctness--untracked--1.json'))
    ok('localCheck: without it the same checkout passes (the base-only open head is ignored)', (await localCheck({ cwd: dir })).ok)
  }

  // ---------- P1 (2026-11-06): the depth judged is max(label, label-gate inferLabel(changed paths)) ----------
  {
    const cf = ['.github/**', 'scripts/ci/**']
    ok('requiredDepth: standard label + a control file -> subtle-correctness', requiredDepth({ label: 'standard', paths: ['scripts/ci/x.mjs'], controlFiles: cf }) === 'subtle-correctness')
    ok('requiredDepth: standard label + AGENTS.md (whatever the list) -> subtle-correctness', requiredDepth({ label: 'standard', paths: ['AGENTS.md'], controlFiles: [] }) === 'subtle-correctness')
    ok('requiredDepth: mechanical label + a migration -> subtle-correctness', requiredDepth({ label: 'mechanical', paths: ['supabase/migrations/1.sql'], controlFiles: cf }) === 'subtle-correctness')
    ok('requiredDepth: a label is never lowered', requiredDepth({ label: 'subtle-correctness', paths: ['app.py'], controlFiles: cf }) === 'subtle-correctness')
    ok('requiredDepth: mechanical stays mechanical on ordinary paths (inferLabel never infers mechanical; its standard is no floor)', requiredDepth({ label: 'mechanical', paths: ['README.md'], controlFiles: cf }) === 'mechanical')
    ok('requiredDepth: standard stays standard on ordinary paths', requiredDepth({ label: 'standard', paths: ['app.py'], controlFiles: cf }) === 'standard')

    // through localCheck: a PR labelled standard that edits a control file needs completeness too
    const d = prRepo()
    put(d.dir, 'scripts/ci/gate.mjs', 'export {}\n')
    commit(d.dir, 'edit a control file')
    const identity = await inputIdentity({ cwd: d.dir, base: d.base, head: 'HEAD' })
    put(d.dir, '.review/records/correctness--f--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity } })) + '\n')
    commit(d.dir, 'evidence')
    put(d.dir, '.review/local.json', JSON.stringify({ lane: 'direct', depth: 'standard' }) + '\n')
    const lc = await localCheck({ cwd: d.dir })
    ok('localCheck: standard label on a control-file change -> FAIL naming completeness', failsWith(lc, /FAIL completeness/))
    ok('localCheck: the raised depth is reported with the path that raised it', /subtle-correctness.*scripts\/ci\/gate\.mjs/.test(lc.lines.join('\n')))
    put(d.dir, '.review/records/completeness--f--1.json', JSON.stringify(rec({ slot: 'completeness', stem: undefined, vendor: 'google', input: { kind: 'pr', identity } })) + '\n')
    ok('localCheck: with a completeness record from a third vendor it passes', (await localCheck({ cwd: d.dir })).ok)

    // a PR that removes a path from the base's control list is still judged by the base's list
    const n = prRepo()
    put(n.dir, 'AGENTS.md', AGENTS.replace('`scripts/ci/**`, ', ''))
    put(n.dir, 'scripts/ci/gate.mjs', 'export {}\n')
    commit(n.dir, 'narrow the list and edit a formerly listed file')
    put(n.dir, '.review/local.json', JSON.stringify({ lane: 'direct', depth: 'standard' }) + '\n')
    ok('localCheck: a head that drops a path from the control list is still subtle (AGENTS.md itself changed)', /subtle-correctness.*AGENTS\.md/.test((await localCheck({ cwd: n.dir })).lines.join('\n')))
    // a head whose AGENTS.md has no control-file list -> could not judge (fail closed)
    const e = prRepo()
    put(e.dir, 'AGENTS.md', '# AGENTS\n')
    commit(e.dir, 'empty the list')
    put(e.dir, '.review/local.json', JSON.stringify({ lane: 'direct', depth: 'standard' }) + '\n')
    ok('localCheck: a head AGENTS.md with no control-file list -> could not judge', failsWith(await localCheck({ cwd: e.dir }), /could not judge.*Control files/))

    // the head has no AGENTS.md -> could not judge (fail closed)
    const z = prRepo()
    raw(z.dir, ['rm', '-q', 'AGENTS.md'])
    commit(z.dir, 'drop AGENTS.md')
    put(z.dir, '.review/local.json', JSON.stringify({ lane: 'direct', depth: 'mechanical' }) + '\n')
    ok('localCheck: no AGENTS.md at the head -> could not judge', failsWith(await localCheck({ cwd: z.dir }), /could not judge.*AGENTS\.md/))
  }

  // ---------- correctness--4b14a1806037--1 F1: docs-only means only a spec or plan changes (spec §5.2) ----------
  {
    // prRepo's PR already changes app.py; add a spec with a passing record, so only the lane rule can fail it
    const d = prRepo()
    put(d.dir, 'docs/superpowers/specs/new.md', '# spec\n')
    commit(d.dir, 'add spec')
    const blob = raw(d.dir, ['rev-parse', 'HEAD:docs/superpowers/specs/new.md'])
    put(d.dir, '.review/records/spec--d--1.json', JSON.stringify(rec({ slot: 'spec', stem: undefined, input: { kind: 'blob', path: 'docs/superpowers/specs/new.md', identity: blob } })) + '\n')
    put(d.dir, '.review/local.json', JSON.stringify({ lane: 'docs-only', depth: 'mechanical' }) + '\n')
    const lc = await localCheck({ cwd: d.dir })
    ok('docs-only lane with a non-doc path changed -> FAIL naming the path', failsWith(lc, /docs-only.*app\.py/))
    // the same spec on a PR that changes nothing else passes
    const c = mkrepo()
    put(c, 'a.txt', 'a\n')
    const base = commit(c, 'base')
    raw(c, ['checkout', '-q', '-b', 'pr'])
    put(c, 'docs/superpowers/specs/new.md', '# spec\n')
    commit(c, 'add spec')
    const cb = raw(c, ['rev-parse', 'HEAD:docs/superpowers/specs/new.md'])
    put(c, '.review/records/spec--d--1.json', JSON.stringify(rec({ slot: 'spec', stem: undefined, input: { kind: 'blob', path: 'docs/superpowers/specs/new.md', identity: cb } })) + '\n')
    put(c, '.review/local.json', JSON.stringify({ lane: 'docs-only', depth: 'mechanical' }) + '\n')
    raw(c, ['branch', '-f', 'main', base])
    ok('docs-only lane changing only a spec (records aside) passes', (await localCheck({ cwd: c })).ok)
  }

  // ---------- P3-7: Spec:/Plan: paths are normalised as the runner normalises --path ----------
  {
    const d = prRepo()
    put(d.dir, 'docs/superpowers/specs/s.md', '# spec\n')
    put(d.dir, 'docs/superpowers/plans/p.md', '# plan\n')
    commit(d.dir, 'docs')
    const sBlob = raw(d.dir, ['rev-parse', 'HEAD:docs/superpowers/specs/s.md'])
    const pBlob = raw(d.dir, ['rev-parse', 'HEAD:docs/superpowers/plans/p.md'])
    put(d.dir, '.review/records/spec--n--1.json', JSON.stringify(rec({ slot: 'spec', stem: undefined, input: { kind: 'blob', path: 'docs/superpowers/specs/s.md', identity: sBlob } })) + '\n')
    put(d.dir, '.review/records/plan--n--1.json', JSON.stringify(rec({ slot: 'plan', stem: undefined, input: { kind: 'blob', path: 'docs/superpowers/plans/p.md', identity: pBlob } })) + '\n')
    writeFileSync(join(d.dir, '.review/local.json'), JSON.stringify({ lane: 'specced', depth: 'mechanical', spec: './docs/superpowers/specs/s.md', plan: { path: 'docs\\superpowers\\plans\\p.md', tasks: ['T1'] } }) + '\n')
    const lc = await localCheck({ cwd: d.dir })
    const text = lc.lines.join('\n')
    ok('a Spec: path with a leading ./ matches the record for the normalised path', /^ok spec docs\/superpowers\/specs\/s\.md@/m.test(text))
    ok('a Plan: path with backslashes matches the record for the normalised path', /^ok plan docs\/superpowers\/plans\/p\.md@/m.test(text))
  }

  // ---------- the CLI entry runs when reached through a symlink (else it would exit 0 silently) ----------
  {
    const target = fileURLToPath(new URL('./review-evidence.mjs', import.meta.url))
    const env = { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' }
    const viaNode = (script) => spawnSync(process.execPath, [script], { encoding: 'utf8', shell: false, env, cwd: root })
    const direct = viaNode(target)
    ok('CLI via the real path with no env: exit 1 "could not judge"', direct.status === 1 && /could not judge/.test(direct.stdout))
    const link = join(root, 'linked-review-evidence.mjs')
    let linked = true
    try { symlinkSync(target, link) } catch (e) {
      if (process.platform === 'win32' && e && e.code === 'EPERM') { linked = false; console.log('  SKIP CLI via a symlink: symlink creation needs privileges on this Windows host') } else throw e
    }
    if (linked) {
      const vl = viaNode(link)
      ok('CLI via a symlink: still runs (exit 1 "could not judge"), not a silent exit 0', vl.status === 1 && /could not judge/.test(vl.stdout))
    }
  }

  // ---------- localCheck and the review.mjs subcommands ----------
  const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (s) => { o.out += s }, err: (s) => { o.err += s } } } }
  const cli = async (cwd, argv) => { const { o, io: i } = io(); const code = await reviewCli(argv, { cwd, io: i }); return { code, ...o } }
  {
    const L = prRepo()
    let r = await cli(L.dir, ['check', '--local'])
    ok('check --local with no local.json exits 1 and names init-local', r.code === 1 && /init-local/.test(r.out + r.err))
    r = await cli(L.dir, ['init-local', '--lane', 'sideways', '--depth', 'standard'])
    ok('init-local rejects an unknown lane', r.code === 1 && /lane/.test(r.err) && existsSync(join(L.dir, '.review/local.json')) === false)
    r = await cli(L.dir, ['init-local', '--lane', 'direct', '--depth', 'deep'])
    ok('init-local rejects an unknown depth', r.code === 1 && /depth/.test(r.err) && existsSync(join(L.dir, '.review/local.json')) === false)
    r = await cli(L.dir, ['init-local', '--lane', 'specced', '--depth', 'standard', '--spec', 's.md', '--plan', 'p.md T3-T1'])
    ok('init-local rejects bad plan task syntax', r.code === 1 && /Plan/.test(r.err) && existsSync(join(L.dir, '.review/local.json')) === false)
    r = await cli(L.dir, ['init-local', '--lane', 'direct', '--depth', 'standard', '--bogus'])
    ok('init-local is strict about flags', r.code === 1)
    r = await cli(L.dir, ['init-local', '--lane', 'direct', '--depth', 'standard'])
    const text = existsSync(join(L.dir, '.review/local.json')) ? readFileSync(join(L.dir, '.review/local.json'), 'utf8') : ''
    ok('init-local writes .review/local.json with LF and a trailing newline', r.code === 0 && text.endsWith('}\n') && !text.includes('\r') && JSON.parse(text).lane === 'direct' && JSON.parse(text).depth === 'standard')
    r = await cli(L.dir, ['check', '--local'])
    ok('check --local with no record exits 1 naming correctness', r.code === 1 && /FAIL correctness/.test(r.out))
    const lc = await localCheck({ cwd: L.dir })
    ok('localCheck never treats local.json as a record', lc.ok === false && /local\.json/.test(lc.lines.join()) === false)
    const identity = await inputIdentity({ cwd: L.dir, base: 'main', head: 'HEAD' })
    put(L.dir, '.review/records/correctness--l--1.json', JSON.stringify(rec({ slot: 'correctness', stem: undefined, input: { kind: 'pr', identity } })) + '\n')
    r = await cli(L.dir, ['check', '--local'])
    ok('check --local with a passing record exits 0', r.code === 0 && /^ok correctness /m.test(r.out))
    r = await cli(L.dir, ['init-local', '--lane', 'specced', '--depth', 'standard', '--spec', 'docs/superpowers/specs/s.md', '--plan', 'docs/superpowers/plans/p.md T1-T2,T4', '--deviation', 'D1: simpler'])
    const j = JSON.parse(readFileSync(join(L.dir, '.review/local.json'), 'utf8'))
    ok('init-local stores the expanded plan tasks and deviations', r.code === 0 && j.plan.path === 'docs/superpowers/plans/p.md' && j.plan.tasks.join() === 'T1,T2,T4' && j.deviations[0].id === 'D1')
    r = await cli(L.dir, ['init-local', '--lane', 'specced', '--depth', 'standard', '--spec', 'docs/superpowers/specs/s.md', '--plan', 'docs/superpowers/plans/p.md T1', '--deviation', 'conformance--abcdef012345--2#D2: still better'])
    const jc = JSON.parse(readFileSync(join(L.dir, '.review/local.json'), 'utf8'))
    ok('init-local accepts a chained deviation ID verbatim', r.code === 0 && jc.deviations.length === 1 && jc.deviations[0].id === 'conformance--abcdef012345--2#D2' && jc.deviations[0].justification === 'still better')
    r = await cli(L.dir, ['init-local', '--lane', 'specced', '--depth', 'standard', '--spec', 'docs/superpowers/specs/s.md', '--plan', 'docs/superpowers/plans/p.md T1', '--deviation', 'foo: bar'])
    ok('init-local rejects a deviation whose ID is neither D<n> nor <stem>#D<n>', r.code === 1 && /foo/.test(r.err) && JSON.parse(readFileSync(join(L.dir, '.review/local.json'), 'utf8')).deviations[0].id === 'conformance--abcdef012345--2#D2')
    const lc2 = await localCheck({ cwd: L.dir })
    ok('localCheck specced: a linked spec missing at HEAD fails naming it', lc2.ok === false && /spec docs\/superpowers\/specs\/s\.md/.test(lc2.lines.join('\n')))
    writeFileSync(join(L.dir, '.review/local.json'), '{"lane":"direct"}\n')
    const lc3 = await localCheck({ cwd: L.dir })
    ok('localCheck: an invalid local.json fails, naming init-local', lc3.ok === false && /init-local/.test(lc3.lines.join()))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
