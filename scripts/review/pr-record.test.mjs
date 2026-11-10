// Self-test for scripts/review/pr-record.mjs: the PR review record's draft writer, the `pr-record` / `check --pr`
// CLI, and the substitute run (`review.mjs run --slot substitute:<bot> --pr <n>`), end to end through the real runner
// with a stubbed reviewer and stubbed live readers. Real git repos in a temporary directory, deleted at the end.
// Run: node scripts/review/pr-record.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODERABBIT_LOGIN, CODEX_LOGIN, T, addressedIn, buildGateRepo, codexCovers, crOk, fixedAt, g, gateState, prRecord, put, review, thread, verdict,
} from './fixtures/gate-repo.mjs'
import { blockingFindings, evaluateGate } from '../ci/review-gate.mjs'
import { draftRecord, prRecordCli, runSubstitute as runSubstituteImpl } from './pr-record.mjs'
import { readRecords } from './records.mjs'

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const silent = () => { const o = { out: '', err: '' }; return { o, io: { out: (s) => { o.out += s }, err: (s) => { o.err += s } } } }

const tmp = mkdtempSync(join(tmpdir(), 'pr-record-test-'))
try {
  const repo = await buildGateRepo(join(tmp, 'repo'))
  const { sha, id } = repo

  // ---------------------------------------------------------------- draft
  const stateWithTwo = gateState(repo, sha.E, {
    ...codexCovers(sha.E),
    threads: [thread('PRRT_1', CODEX_LOGIN, sha.R), thread('PRRT_2', CODERABBIT_LOGIN, sha.R), thread('PRRT_3', 'dev', sha.R)],
  })
  const draft = await draftRecord({ state: stateWithTwo, depth: 'standard', existing: null, now: () => new Date('2026-11-05T12:00:00Z') })
  ok('pr-record writes every blocking finding with an empty disposition for the author', draft.findings.length === blockingFindings(stateWithTwo).length && draft.findings.length === 2 && draft.findings.every((f) => f.disposition === null))
  ok('the draft lists the covered slot and its evidence', draft.schema === 1 && draft.pr === 1 && draft.slots.length === 1 && draft.slots[0].bot === 'codex' && draft.slots[0].status === 'covered' && typeof draft.slots[0].by === 'string')
  // D31: the slots the draft writes satisfy the gate's "each required slot is listed" check, once dispositions are filled.
  const disposed = (d) => ({ ...d, findings: d.findings.map((f) => ({ ...f, disposition: { kind: 'pre-existing', reason: 'r', issue: 'https://example.test/i/1' } })) })
  ok('D31: a drafted record, dispositions filled, passes the gate; the same with its slots removed fails naming the slot', await (async () => {
    const good = await evaluateGate({ state: stateWithTwo, record: disposed(draft), depth: 'standard' })
    const bare = await evaluateGate({ state: stateWithTwo, record: { ...disposed(draft), slots: [] }, depth: 'standard' })
    return good.ok && bare.ok === false && bare.lines.some((l) => /^FAIL record slot coderabbit\|codex:/.test(l))
  })())
  ok('D31: a subtle-correctness draft lists all three met slots and passes the gate once disposed', await (async () => {
    const live = gateState(repo, sha.U, {
      reviews: [review(2, CODERABBIT_LOGIN, sha.U, T(40))], ...crOk(sha.U), ...codexCovers(sha.U), geminiVerdicts: [verdict(80, sha.U, id.U, 'no-findings')],
      threads: [thread('PRRT_1', CODEX_LOGIN, sha.R)],
    })
    const d = await draftRecord({ state: live, depth: 'subtle-correctness' })
    return d.slots.map((x) => x.bot).join() === 'coderabbit,codex,gemini' && (await evaluateGate({ state: live, record: disposed(d), depth: 'subtle-correctness' })).ok
  })())
  ok('the draft leaves out a thread whose bot resolution the gate accepts, and keeps one it refuses', await (async () => {
    const s = gateState(repo, sha.E, { ...codexCovers(sha.E), threads: [
      thread('PRRT_OK', CODERABBIT_LOGIN, sha.R, { resolved: true, resolvedBy: CODERABBIT_LOGIN, firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7)) }),
      thread('PRRT_NO', CODERABBIT_LOGIN, sha.R, { resolved: true, resolvedBy: CODERABBIT_LOGIN }),
    ] })
    const d = await draftRecord({ state: s, depth: 'standard' })
    return d.findings.map((f) => f.id).join() === 'thread:PRRT_NO'
  })())
  ok('a re-drafted record keeps the author\'s dispositions and reclassifications for findings still blocking', await (async () => {
    const existing = prRecord([{ id: 'thread:PRRT_1', source: 'codex', severity: 'P1', disposition: { kind: 'pre-existing', reason: 'r', issue: 'i' } }, { id: 'thread:GONE', disposition: { kind: 'pre-existing', reason: 'r', issue: 'i' } }], { reclassified: [{ id: 'thread:PRRT_2', reason: 'style' }] })
    const d = await draftRecord({ state: stateWithTwo, depth: 'standard', existing })
    return d.findings.find((f) => f.id === 'thread:PRRT_1').disposition.kind === 'pre-existing' && !d.findings.some((f) => f.id === 'thread:GONE') && d.reclassified.length === 1
  })())

  // ---------------------------------------------------------------- substitute runs
  let seq = 0, active = null
  // A fresh clone of the fixture repo at U, the PR head, with `record` (if any) as .review/pr/1.json.
  const fresh = (record) => {
    active = join(tmp, `c${++seq}`)
    g(tmp, ['clone', '-q', repo.dir, active])
    g(active, ['checkout', '-q', '--detach', sha.U])
    if (record) put(active, '.review/pr/1.json', JSON.stringify(record, null, 2) + '\n')
    return active
  }
  const inheritedIn = (prompt) => {
    const at = prompt.indexOf('### Inherited findings')
    if (at === -1) return []
    const m = /(`{3,})json\n([\s\S]*?)\n\1/.exec(prompt.slice(at))
    return JSON.parse(m[2]).map((f) => f.id)
  }
  // A stub reviewer adapter: answers every inherited finding with statusFor(id); records what it was sent.
  const reviewer = (statusFor, { refuse = [], sent = [] } = {}) => {
    const fn = async ({ prompt }) => {
      fn.prompts.push(prompt)
      const ids = inheritedIn(prompt)
      sent.push(...ids)
      if (ids.some((i) => refuse.includes(i))) return { exitCode: 1, stdout: '', stderr: 'refused id was sent', truncated: false, timedOut: false }
      const inherited = ids.map((i) => ({ id: i, status: statusFor(i), note: 'checked' }))
      return { exitCode: 0, stdout: JSON.stringify({ verdict: inherited.some((e) => e.status === 'open') ? 'fail' : 'pass', findings: [], inherited }), stderr: '', truncated: false, timedOut: false }
    }
    fn.prompts = []
    return fn
  }
  const resolvesAll = reviewer(() => 'resolved')
  const leavesOpen = reviewer(() => 'open')
  const captures = reviewer(() => 'resolved')
  const rejectsIds = (ids, sent) => reviewer(() => 'resolved', { refuse: ids, sent })

  // The test-side runSubstitute: PR 1, authored by Anthropic, reviewed by the stubbed `claude` adapter, in the active clone.
  const runSubstitute = async ({ bot, supersedes, readersImpl, reviewerImpl }) => {
    const { io } = silent()
    const r = await runSubstituteImpl({
      bot, pr: 1, author: 'anthropic', reviewer: 'claude', supersedes, cwd: active, readersImpl, io,
      adapters: { claude: { run: reviewerImpl } }, now: () => new Date('2026-11-05T12:00:00Z'),
    })
    return { ...r.record, stem: r.stem, code: r.code, sentInherited: r.sentInherited, prompt: reviewerImpl.prompts.at(-1) ?? '' }
  }

  // Live state at U: Codex raised PRRT_1 on R; the fix F was reviewed by Codex only on F (another identity); Codex has
  // not reviewed U and is past its wait; CodeRabbit and Gemini cover U.
  const liveAtU = (extra = {}) => gateState(repo, sha.U, {
    reviews: [review(2, CODERABBIT_LOGIN, sha.U, T(40))], ...crOk(sha.U),
    codexState: { commitSha: sha.F, status: 'completed', at: T(10), commentId: 900 }, codexHistory: { reviews: [{ sha: sha.F, at: T(10), status: 'completed' }], complete: true, currentTrusted: true, current: { commitSha: sha.F, status: 'completed', at: T(10) } },
    geminiVerdicts: [verdict(80, sha.U, id.U, 'no-findings')],
    threads: [thread('PRRT_1', CODEX_LOGIN, sha.R, { resolved: true, resolvedBy: 'dev' })],
    ...extra,
  })
  const readers = (state) => async () => ({ state, depth: 'subtle-correctness' })
  const liveFixedUnverified = readers(liveAtU())
  const liveAfterR1 = liveFixedUnverified // GitHub is unchanged by a local review: same live state
  const oneVerifiedOneNot = readers(liveAtU({
    ...codexCovers(sha.U),
    threads: [thread('PRRT_1', CODEX_LOGIN, sha.R, { resolved: true, resolvedBy: 'dev' }), thread('PRRT_2', CODEX_LOGIN, sha.R)],
  }))
  const none = readers(gateState(repo, sha.U))
  const fixedG = prRecord([fixedAt('thread:PRRT_1', sha.F)])
  const fixUnrelatedThenFail = { ...liveAtU(), get records() { return readRecords({ cwd: active }) } }
  // D31: the gate fails a record that does not list each required slot (subtle-correctness: all three).
  const SUBTLE_SLOTS = ['coderabbit', 'codex', 'gemini'].map((bot) => ({ bot, status: 'covered', by: `listed:${bot}` }))
  const prRecWithSub = (...recs) => prRecord([fixedAt('thread:PRRT_1', sha.F, recs.at(-1).stem)], { slots: SUBTLE_SLOTS })

  fresh(fixedG)
  ok('substitute run, end to end: stubbed live readers -> record -> gate ok', await (async () => { const rec = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); return rec.findings.some((f) => f.id === 'thread:PRRT_1' && f.disposition?.kind === 'fixed') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(rec), depth: 'subtle-correctness' })).ok })())
  fresh(prRecord([fixedAt('thread:PRRT_1', sha.F), fixedAt('thread:PRRT_2', sha.F)]))
  // Correctness review 24003aa3e6f2 F1: the substitute's prompt holds each carried finding's full text.
  ok('substitute prompt carries the finding\'s full text, not only its summary line', await (async () => {
    const withDetail = readers(liveAtU({ threads: [thread('PRRT_1', CODEX_LOGIN, sha.R, { resolved: true, resolvedBy: 'dev', body: 'P1 Badge headline\n\nXYZZY the actual defect.' })] }))
    const r = await runSubstitute({ bot: 'codex', readersImpl: withDetail, reviewerImpl: captures })
    return r.prompt.includes('XYZZY the actual defect.')
  })())
  ok('a chained substitute refreshes an inherited open finding with the live text', await (async () => {
    const thin = readers(liveAtU({ threads: [thread('PRRT_1', CODEX_LOGIN, sha.R, { resolved: true, resolvedBy: 'dev', body: 'P1 Badge headline' })] }))
    const rich = readers(liveAtU({ threads: [thread('PRRT_1', CODEX_LOGIN, sha.R, { resolved: true, resolvedBy: 'dev', body: 'P1 Badge headline\n\nPLUGH the defect text.' })] }))
    const r1 = await runSubstitute({ bot: 'codex', readersImpl: thin, reviewerImpl: leavesOpen })
    const r2 = await runSubstitute({ bot: 'codex', supersedes: r1.stem, readersImpl: rich, reviewerImpl: captures })
    return !r1.prompt.includes('PLUGH') && r2.prompt.includes('PLUGH the defect text.') && r2.sentInherited.join() === 'thread:PRRT_1'
  })())
  ok('substitute run carries a fixed-but-unverified finding, not a verified one', (await runSubstitute({ bot: 'codex', readersImpl: oneVerifiedOneNot, reviewerImpl: captures })).sentInherited.join() === 'thread:PRRT_2')
  fresh(fixedG)
  ok('R1 resolves G, R2 chains from R1: R2 persists G as fixed with R1 as by, never sends G to the reviewer, and the gate passes on R2', await (async () => { const r1 = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); const sent = []; const r2 = await runSubstitute({ bot: 'codex', supersedes: r1.stem, readersImpl: liveAfterR1, reviewerImpl: rejectsIds(['thread:PRRT_1'], sent) }); const g = (r2.findings ?? []).find((f) => f.id === 'thread:PRRT_1'); return g && g.disposition?.kind === 'fixed' && g.disposition?.by === r1.stem && !sent.includes('thread:PRRT_1') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(r1, r2), depth: 'subtle-correctness' })).ok })())
  fresh(fixedG)
  ok('second substitute review: an open finding chains under the same gate ID and resolves -> gate ok', await (async () => { const r1 = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: leavesOpen }); const r2 = await runSubstitute({ bot: 'codex', supersedes: r1.stem, readersImpl: liveFixedUnverified, reviewerImpl: resolvesAll }); return r2.findings.some((f) => f.id === 'thread:PRRT_1' && f.disposition?.kind === 'fixed') && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(r1, r2), depth: 'subtle-correctness' })).ok })())
  fresh(fixedG)
  ok('a substitute that leaves the finding open does not pass the gate', await (async () => { const r1 = await runSubstitute({ bot: 'codex', readersImpl: liveFixedUnverified, reviewerImpl: leavesOpen }); return r1.code === 0 && (await evaluateGate({ state: fixUnrelatedThenFail, record: prRecWithSub(r1), depth: 'subtle-correctness' })).ok === false })())
  fresh(null)
  ok('substitute run fills {{bot}} in substitute.md', (await runSubstitute({ bot: 'gemini', readersImpl: none, reviewerImpl: captures })).prompt.includes('gemini') && !(await runSubstitute({ bot: 'gemini', readersImpl: none, reviewerImpl: captures })).prompt.includes('{{bot}}'))
  fresh(null)
  ok('with no PR review record, every blocking finding of the bot is carried (open), and only that bot\'s', await (async () => {
    const both = readers(liveAtU({ threads: [thread('PRRT_1', CODEX_LOGIN, sha.R), thread('PRRT_C', CODERABBIT_LOGIN, sha.R)], geminiVerdicts: [verdict(80, sha.U, id.U, 'findings', [1])] }))
    const r = await runSubstitute({ bot: 'codex', readersImpl: both, reviewerImpl: captures })
    return r.sentInherited.join() === 'thread:PRRT_1'
  })())
  fresh(null)
  ok('a substitute run whose live read fails writes no record and exits 1', await (async () => {
    const boom = async () => { throw new Error('GitHub API 403') }
    const r = await runSubstitute({ bot: 'codex', readersImpl: boom, reviewerImpl: captures })
    return r.code === 1 && readRecords({ cwd: active }).length === 0
  })())

  // ---------------------------------------------------------------- the CLI: pr-record and check --pr
  fresh(null)
  ok('pr-record --pr writes .review/pr/<n>.json with every blocking finding undisposed, prints the gate, exits 1 while undisposed', await (async () => {
    const { o, io } = silent()
    const code = await prRecordCli(['pr-record', '--pr', '1'], { cwd: active, io, readersImpl: liveFixedUnverified })
    const file = join(active, '.review/pr/1.json')
    if (!existsSync(file)) return false
    const rec = JSON.parse(readFileSync(file, 'utf8'))
    return code === 1 && rec.findings.length === 1 && rec.findings[0].id === 'thread:PRRT_1' && rec.findings[0].disposition === null && /FAIL thread:PRRT_1/.test(o.out)
  })())
  ok('check --pr judges without writing', await (async () => {
    const file = join(active, '.review/pr/1.json')
    const written = JSON.stringify(prRecord([{ id: 'thread:PRRT_1', disposition: { kind: 'pre-existing', reason: 'r', issue: 'https://example.test/i/1' } }], { slots: SUBTLE_SLOTS }), null, 2)
    writeFileSync(file, written)
    const { o, io } = silent()
    const code = await prRecordCli(['check', '--pr', '1'], { cwd: active, io, readersImpl: readers(liveAtU({ ...codexCovers(sha.U) })) })
    return code === 0 && /review-gate.*ok/.test(o.out) && readFileSync(file, 'utf8') === written
  })())
  ok('pr-record without --pr is a usage error', (await prRecordCli(['pr-record'], { cwd: active, io: silent().io, readersImpl: none })) === 1)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
