// Self-test for scripts/ci/review-gate.mjs: blockingFindings, evaluateGate and main() (spec §5.5, §5.6; plan Task 23).
// Ancestry and identities come from a real git repo built in a temporary directory (scripts/review/fixtures/
// gate-repo.mjs) and deleted at the end; the GitHub API is a stubbed fetchImpl, so nothing touches the network.
// Run: node scripts/ci/review-gate.test.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENTS, CODERABBIT_LOGIN, CODEX_LOGIN, CODEX_P1, CR_FINDING_END, CR_MAJOR_HEADER, CR_MINOR, T, addressedIn, buildGateRepo, crStatus, codexCovers, fixedAt, g, gateState,
  outsideDiffBody, prRecord, review, subRecord, thread, verdict,
} from '../review/fixtures/gate-repo.mjs'
import { blockingFindings, evaluateGate, judgedDepth, main, makeResolveCommit, readGateState } from './review-gate.mjs'

let pass = 0, fail = 0
// A thenable condition is a failure: a Promise is truthy even when it resolves to false.
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const quiet = async (fn) => {
  const { log, error } = console
  const out = []
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try { return { code: await fn(), out: out.join('\n') } } finally { console.log = log; console.error = error }
}

const tmp = mkdtempSync(join(tmpdir(), 'review-gate-test-'))
const startCwd = process.cwd()
try {
  const repo = await buildGateRepo(join(tmp, 'repo'))
  const { sha, id } = repo
  const st = (head, extra) => gateState(repo, head, extra)
  const codexThreadOnR = (tid, opts) => thread(tid, CODEX_LOGIN, sha.R, opts)
  const crThreadOnR = (tid, opts) => thread(tid, CODERABBIT_LOGIN, sha.R, { body: CR_MAJOR_HEADER, ...opts })
  const slotsOnly = prRecord([], { slots: [{ bot: 'codex', status: 'covered', by: 'codex-marker:900' }] })
  // D31: the gate fails a record that does not list each required slot, so the fixtures for the finding rules list them
  // (the gate never matches `by` against live evidence, so any non-empty `by` stands in).
  const STD_SLOTS = slotsOnly.slots
  const SUBTLE_SLOTS = ['coderabbit', 'codex', 'gemini'].map((bot) => ({ bot, status: 'covered', by: `listed:${bot}` }))

  // ---------------------------------------------------------------- record need, nits, bot-resolved, evidence dir
  const mech = st(sha.E)
  const mechWithP1 = st(sha.E, { threads: [codexThreadOnR('PRRT_9')] })
  const withNitOnly = st(sha.E, { ...codexCovers(sha.E), threads: [crThreadOnR('PRRT_N', { body: CR_MINOR })] })
  // Bot-resolved (spec §5.5 "CodeRabbit's 'addressed in <sha>'"): accepted only with CodeRabbit's own "✅ Addressed in
  // commit <sha>" edit naming a commit strictly after the reported one and in the head's history.
  const crResolvedByBot = st(sha.E, { ...codexCovers(sha.E), threads: [crThreadOnR('PRRT_B', { resolved: true, resolvedBy: CODERABBIT_LOGIN, firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7)) })] })
  const botResolvedWith = (opts) => st(sha.E, { ...codexCovers(sha.E), threads: [crThreadOnR('PRRT_B', { resolved: true, resolvedBy: CODERABBIT_LOGIN, ...opts })] })
  const botFails = async (state, re) => { const r = await evaluateGate({ state, record: slotsOnly, depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL thread:PRRT_B\b/.test(l) && re.test(l)) }
  const authorResolvedP1 = st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_A', { resolved: true, resolvedBy: 'dev' })] })
  const p1 = st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_1')] })
  const reclassNoReason = prRecord([], { slots: slotsOnly.slots, reclassified: [{ id: 'thread:PRRT_1', reason: '' }] })
  const p1Later = st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_1'), codexThreadOnR('PRRT_2')] })
  const older = prRecord([{ id: 'thread:PRRT_1', source: 'codex', severity: 'P1', disposition: { kind: 'pre-existing', reason: 'on main too', issue: 'https://example.test/issues/1' } }], { slots: slotsOnly.slots })
  const findingInEvidence = st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_E', { path: '.review/pr/1.json' })] })

  ok('mechanical PR with no blocking finding needs no record', (await evaluateGate({ state: mech, record: null, depth: 'mechanical' })).ok)
  ok('mechanical PR with a blocking thread needs a record', (await evaluateGate({ state: mechWithP1, record: null, depth: 'mechanical' })).ok === false)
  ok('a nit thread needs no entry', (await evaluateGate({ state: withNitOnly, record: slotsOnly, depth: 'standard' })).ok)
  ok('a bot-resolved CodeRabbit thread passes without an entry', (await evaluateGate({ state: crResolvedByBot, record: slotsOnly, depth: 'standard' })).ok)
  ok('`@coderabbitai resolve`-style resolution (resolved by the bot, no addressed line) -> needs a disposition, naming the thread and why', await botFails(botResolvedWith({}), /no "✅ Addressed in commit/))
  ok('a "Confirmed as addressed by @user" edit is not accepted', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: crStatus('✅ Confirmed as addressed by @dev') }), /not accepted/))
  ok('addressed in commits A to B, both after the reported commit and on the head -> passes', (await evaluateGate({ state: botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7), sha.E.slice(0, 7)) }), record: slotsOnly, depth: 'standard' })).ok)
  ok('addressed in the reported commit itself -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.R.slice(0, 7)) }), /strict descendant/))
  ok('addressed in an ancestor of the reported commit -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.Q0.slice(0, 7)) }), /strict descendant/))
  ok('addressed in an off-head commit -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.Y.slice(0, 7)) }), /head's history/))
  ok('a range whose end is off the head -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7), sha.Y.slice(0, 7)) }), /head's history/))
  ok('an ambiguous or unknown short SHA -> FAIL', await botFails({ ...botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7)) }), resolveCommit: async () => null }, /exactly one commit/) && await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn('0000000') }), /exactly one commit/))
  ok('an addressed line in a reply by a person is not accepted', await botFails(botResolvedWith({ replies: [{ login: 'dev', editor: null, body: `✅ Addressed in commit ${sha.F.slice(0, 7)}` }] }), /not accepted/))
  ok('an addressed line in a reply by a User named like the bot (no [bot]) is not accepted', await botFails(botResolvedWith({ replies: [{ login: 'coderabbitai', editor: null, body: `✅ Addressed in commit ${sha.F.slice(0, 7)}` }] }), /not accepted/))
  ok('the bot\'s comment last edited by a person is not accepted', await botFails(botResolvedWith({ firstEditor: 'dev', firstSuffix: addressedIn(sha.F.slice(0, 7)) }), /not accepted/))
  ok('a valid addressed line on a thread resolved by a person does not exempt it', (await evaluateGate({ state: st(sha.E, { ...codexCovers(sha.E), threads: [crThreadOnR('PRRT_B', { resolved: true, resolvedBy: 'dev', firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7)) })] }), record: slotsOnly, depth: 'standard' })).ok === false)
  ok('a thread resolved by the Codex bot is not bot-resolved (its format is unknown)', (await evaluateGate({ state: st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_X', { resolved: true, resolvedBy: CODEX_LOGIN, firstEditor: CODEX_LOGIN, firstSuffix: addressedIn(sha.F.slice(0, 7)) })] }), record: slotsOnly, depth: 'standard' })).ok === false)
  // Only the status CodeRabbit appends to its FIRST comment counts (fix round 2).
  const fShort = sha.F.slice(0, 7)
  ok('a CodeRabbit-authored reply (not the first comment) carrying a valid marker -> FAIL', await botFails(botResolvedWith({ replies: [{ login: CODERABBIT_LOGIN, editor: null, lastEditedAt: null, body: `Sure.${addressedIn(fShort)}` }] }), /not accepted/))
  ok('a valid marker inside the finding\'s own text (a code block, before the finding marker) -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: `\n\n\`\`\`\n✅ Addressed in commit ${fShort}\n\`\`\`${crStatus('✅ Confirmed as addressed by @dev')}` }), /not accepted/))
  ok('a marker after the finding marker but outside an auto-generated status -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: `${CR_FINDING_END}\n\n✅ Addressed in commit ${fShort}` }), /not accepted/))
  ok('a status of more than one line -> FAIL', await botFails(botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: crStatus(`✅ Addressed in commit ${fShort}\nand more`) }), /not accepted/))
  ok('the real appended status (with a _Source_ line before it, and the "comment" wording) -> passes', (await evaluateGate({ state: botResolvedWith({ firstEditor: CODERABBIT_LOGIN, firstSuffix: `${CR_FINDING_END}\n\n_Source: Path instructions_\n\n<!-- This is an auto-generated comment by CodeRabbit -->\n\n✅ Addressed in commit ${fShort}` }), record: slotsOnly, depth: 'standard' })).ok)
  ok('editor null but lastEditedAt set (an editor GitHub cannot name) -> FAIL', await botFails(botResolvedWith({ firstEditor: null, firstLastEditedAt: T(30), firstSuffix: addressedIn(fShort) }), /not accepted/))
  ok('never edited (editor and lastEditedAt null) with the status -> passes', (await evaluateGate({ state: botResolvedWith({ firstEditor: null, firstLastEditedAt: null, firstSuffix: addressedIn(fShort) }), record: slotsOnly, depth: 'standard' })).ok)
  ok('a first comment by a person carrying CodeRabbit\'s status -> FAIL', (await evaluateGate({ state: st(sha.E, { ...codexCovers(sha.E), threads: [{ ...crThreadOnR('PRRT_B', { resolved: true, resolvedBy: CODERABBIT_LOGIN, firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(fShort) }), comments: [{ login: 'dev', editor: CODERABBIT_LOGIN, lastEditedAt: T(30), body: CR_MAJOR_HEADER + addressedIn(fShort) }] }] }), record: slotsOnly, depth: 'standard' })).ok === false)
  // An accepted bot resolution is no blocking finding (the brief: blockingFindings "minus bot-resolved threads").
  ok('mechanical PR whose only bot thread has an accepted bot resolution needs no record', (await evaluateGate({ state: st(sha.E, { threads: [crThreadOnR('PRRT_B', { resolved: true, resolvedBy: CODERABBIT_LOGIN, firstEditor: CODERABBIT_LOGIN, firstSuffix: addressedIn(fShort) })] }), record: null, depth: 'mechanical' })).ok)
  ok('... and with a refused bot resolution it needs a record, naming the thread', await (async () => { const r = await evaluateGate({ state: st(sha.E, { threads: [crThreadOnR('PRRT_B', { resolved: true, resolvedBy: CODERABBIT_LOGIN })] }), record: null, depth: 'mechanical' }); return r.ok === false && r.lines.some((l) => /^FAIL record:/.test(l)) && r.lines.some((l) => /^FAIL thread:PRRT_B\b.*not accepted/.test(l)) })())
  ok('a refused bot resolution with an acceptable disposition passes', (await evaluateGate({ state: botResolvedWith({}), record: prRecord([{ id: 'thread:PRRT_B', disposition: { kind: 'pre-existing', reason: 'on main', issue: 'https://example.test/i/2' } }], { slots: slotsOnly.slots }), depth: 'standard' })).ok)
  ok('an author-resolved blocking thread still needs an entry', (await evaluateGate({ state: authorResolvedP1, record: slotsOnly, depth: 'standard' })).ok === false)
  ok('reclassified without a reason -> FAIL naming the missing reason', await (async () => { const r = await evaluateGate({ state: p1, record: reclassNoReason, depth: 'standard' }); return r.ok === false && /reason/.test(r.lines.join()) })())
  ok('a new blocking finding after the record -> FAIL naming it', /thread:/.test((await evaluateGate({ state: p1Later, record: older, depth: 'standard' })).lines.join()))
  ok('a finding located only in .review/ is outside the gate', (await evaluateGate({ state: findingInEvidence, record: slotsOnly, depth: 'standard' })).ok)
  // Sharper versions of the lines above: the right guard fired, and the passing twins pass.
  ok('the late finding is the one named, and only it fails', await (async () => { const r = await evaluateGate({ state: p1Later, record: older, depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL thread:PRRT_2\b/.test(l)) && !r.lines.some((l) => /^FAIL thread:PRRT_1\b/.test(l)) })())
  ok('the same reclassification with a reason passes', (await evaluateGate({ state: p1, record: prRecord([], { slots: slotsOnly.slots, reclassified: [{ id: 'thread:PRRT_1', reason: 'a style point' }] }), depth: 'standard' })).ok)
  ok('the missing reason is named on the finding\'s line', await (async () => { const r = await evaluateGate({ state: p1, record: reclassNoReason, depth: 'standard' }); return r.lines.some((l) => /^FAIL thread:PRRT_1\b.*reason/.test(l)) })())
  ok('the same finding outside .review/ blocks', (await evaluateGate({ state: st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_E')] }), record: slotsOnly, depth: 'standard' })).ok === false)
  ok('pre-existing without an issue is not acceptable', (await evaluateGate({ state: p1, record: prRecord([{ id: 'thread:PRRT_1', disposition: { kind: 'pre-existing', reason: 'on main' } }], { slots: slotsOnly.slots }), depth: 'standard' })).ok === false)

  // ---------------------------------------------------------------- slots and substitutes
  const allFailedRecords = [
    subRecord({ bot: 'coderabbit', vendor: 'openai', identity: id.E, stem: 'substitute-coderabbit--a--1' }),
    subRecord({ bot: 'codex', vendor: 'anthropic', identity: id.E, stem: 'substitute-codex--a--1' }),
    subRecord({ bot: 'gemini', vendor: 'google', identity: id.E, stem: 'substitute-gemini--a--1' }),
  ]
  const failedBots = {
    coderabbitCheck: { conclusion: 'skipped', title: 'No files to review' },
    geminiVerdicts: [verdict(70, sha.E, '', 'could-not-run')],
  }
  const allFailed = st(sha.E, { ...failedBots, records: allFailedRecords })
  const threeSubs = prRecord([], { slots: ['coderabbit', 'codex', 'gemini'].map((bot) => ({ bot, status: 'substituted', by: `substitute-${bot}--a--1` })) })
  ok('subtle-correctness with all three bots failed and three substitutes from three vendors -> ok', (await evaluateGate({ state: allFailed, record: threeSubs, depth: 'subtle-correctness' })).ok)
  ok('two substitutes from one vendor -> FAIL', (await evaluateGate({ state: st(sha.E, { ...failedBots, records: [allFailedRecords[0], allFailedRecords[1], { ...allFailedRecords[2], reviewer: { vendor: 'anthropic', model: 'm' } }] }), record: threeSubs, depth: 'subtle-correctness' })).ok === false)
  ok('a substitute for a bot whose review is still pending does not fill its slot (Gemini hold)', await (async () => {
    const inFlight = st(sha.E, { coderabbitCheck: failedBots.coderabbitCheck, records: allFailedRecords, runs: [...st(sha.E).runs, { id: 5, name: 'Gemini review', event: 'pull_request', status: 'in_progress', conclusion: null, headSha: sha.E, headRepo: 'o/r', createdAt: T(1), prNumbers: [1] }] })
    const r = await evaluateGate({ state: inFlight, record: threeSubs, depth: 'subtle-correctness' })
    return r.ok === false && /gemini/.test(r.lines.join('\n'))
  })())
  ok('standard with neither bot covered nor substituted -> FAIL naming the slot', await (async () => { const r = await evaluateGate({ state: st(sha.E), record: prRecord(), depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL slot/.test(l)) })())
  // D31 (§5.5 "What it lists: each required slot"): the record must list every required slot with a non-empty `by`.
  const codexLive = st(sha.E, codexCovers(sha.E))
  const recordSlotFails = (r) => r.lines.filter((l) => /^FAIL record slot /.test(l))
  ok('D31: standard, live coverage, a record listing no slot -> FAIL naming coderabbit|codex', await (async () => { const r = await evaluateGate({ state: codexLive, record: prRecord(), depth: 'standard' }); const f = recordSlotFails(r); return r.ok === false && f.length === 1 && /^FAIL record slot coderabbit\|codex:/.test(f[0]) })())
  ok('D31: subtle-correctness, three substitutes, a record that omits gemini -> FAIL naming gemini only', await (async () => { const r = await evaluateGate({ state: allFailed, record: prRecord([], { slots: threeSubs.slots.filter((x) => x.bot !== 'gemini') }), depth: 'subtle-correctness' }); const f = recordSlotFails(r); return r.ok === false && f.length === 1 && /^FAIL record slot gemini:/.test(f[0]) })())
  ok('D31: a slot entry with an empty `by` -> FAIL', (await evaluateGate({ state: codexLive, record: prRecord([], { slots: [{ bot: 'codex', status: 'covered', by: '' }] }), depth: 'standard' })).ok === false)
  ok('D31: standard listing only codex -> ok', (await evaluateGate({ state: codexLive, record: slotsOnly, depth: 'standard' })).ok)
  ok('D31: standard listing only coderabbit -> ok (one of the two; `by` is not matched against live evidence)', (await evaluateGate({ state: codexLive, record: prRecord([], { slots: [{ bot: 'coderabbit', status: 'covered', by: 'review:1' }] }), depth: 'standard' })).ok)
  ok('an oversized diff fails first with "split this PR", whatever substitutes exist', await (async () => { const r = await evaluateGate({ state: { ...allFailed, tooLarge: true }, record: threeSubs, depth: 'subtle-correctness' }); return r.ok === false && /split this PR/.test(r.lines.join()) })())
  ok('an unknown diff size fails closed', (await evaluateGate({ state: { ...mech, tooLarge: undefined }, record: null, depth: 'mechanical' })).ok === false)
  ok('an unknown depth fails closed', (await evaluateGate({ state: mech, record: null, depth: 'trivial' })).ok === false)
  ok('a record for another PR -> FAIL', (await evaluateGate({ state: p1, record: { ...older, pr: 2 }, depth: 'standard' })).ok === false)

  // ---------------------------------------------------------------- Gemini findings
  const geminiTwoIdentities = st(sha.E, { geminiVerdicts: [verdict(50, sha.R, id.R, 'findings', [1, 2]), verdict(51, sha.E, id.E, 'findings', [1])] })
  ok('Gemini findings from an earlier identity still need dispositions', blockingFindings(geminiTwoIdentities).filter((f) => f.source === 'gemini').length === 3)
  ok('Gemini gate IDs are gemini:<comment>:<index>', blockingFindings(geminiTwoIdentities).map((f) => f.id).sort().join() === 'gemini:50:1,gemini:50:2,gemini:51:1')

  // ---------------------------------------------------------------- fixed: rule (a)
  const fixedRec = prRecord([fixedAt('thread:PRRT_1', sha.F)], { slots: STD_SLOTS })
  const crThreadResolved = crThreadOnR('PRRT_1', { resolved: true, resolvedBy: 'dev' })
  const fixedNoReReview = st(sha.E, { ...codexCovers(sha.E), threads: [crThreadResolved], reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5))] })
  const fixedReReviewed = st(sha.E, { threads: [crThreadResolved], reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5)), review(2, CODERABBIT_LOGIN, sha.E, T(40))] })
  ok('fixed + SHA with no bot evidence after the fix -> FAIL', (await evaluateGate({ state: fixedNoReReview, record: fixedRec, depth: 'standard' })).ok === false)
  ok('fixed + SHA with a covering review after the fix and the thread resolved -> ok (fixture: the fix commit strictly descends from the reported commit and changes the identity)', (await evaluateGate({ state: fixedReReviewed, record: fixedRec, depth: 'standard' })).ok)
  // F1 (the D30 rule on the fix-evidence path, coverage.mjs coderabbitFailedOn): a CodeRabbit review on the head whose
  // CodeRabbit check concluded a terminal failure is no fix evidence, even when Codex covers the slot.
  const fixedOnFailedHead = (conclusion) => ({ ...fixedReReviewed, ...codexCovers(sha.E), coderabbitCheck: { conclusion, title: 'x' } })
  ok('F1: fixed thread, the only later CodeRabbit review is on the head and the head check failed, Codex covers the slot -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: fixedOnFailedHead('failure'), record: fixedRec, depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^ok slot codex\b/.test(l)) && r.lines.some((l) => /^FAIL thread:PRRT_1\b.*no usable coderabbit review/.test(l)) })())
  ok('F1: the same with a successful head check -> ok', (await evaluateGate({ state: fixedOnFailedHead('success'), record: fixedRec, depth: 'standard' })).ok)
  ok('the same, with the thread still open -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: { ...fixedReReviewed, threads: [crThreadOnR('PRRT_1')] }, record: fixedRec, depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL thread:PRRT_1\b.*resolved/.test(l)) })())
  ok('the same, with a fix commit that is not in the head\'s history -> FAIL', (await evaluateGate({ state: fixedReReviewed, record: prRecord([fixedAt('thread:PRRT_1', sha.Y)], { slots: STD_SLOTS }), depth: 'standard' })).ok === false)
  ok('a fix commit off the head\'s history fails even with a review on it at the current identity', await (async () => {
    const s = { ...fixedReReviewed, reviews: [...fixedReReviewed.reviews, review(4, CODERABBIT_LOGIN, sha.Y, T(60))] }
    const r = await evaluateGate({ state: s, record: prRecord([fixedAt('thread:PRRT_1', sha.Y)], { slots: STD_SLOTS }), depth: 'standard' })
    return r.ok === false && r.lines.some((l) => /^FAIL thread:PRRT_1\b.*head's history/.test(l))
  })())
  ok('the same, with an abbreviated fix SHA -> FAIL', (await evaluateGate({ state: fixedReReviewed, record: prRecord([fixedAt('thread:PRRT_1', sha.F.slice(0, 12))], { slots: STD_SLOTS }), depth: 'standard' })).ok === false)
  ok('a Codex thread is verified by the Codex marker on the fix (V2), not by a CodeRabbit review', await (async () => {
    const s = st(sha.E, { ...codexCovers(sha.E), threads: [codexThreadOnR('PRRT_1', { resolved: true, resolvedBy: 'dev' })] })
    const crOnly = st(sha.E, { threads: s.threads, reviews: [review(2, CODERABBIT_LOGIN, sha.E, T(40))] })
    return (await evaluateGate({ state: s, record: fixedRec, depth: 'standard' })).ok && (await evaluateGate({ state: crOnly, record: fixedRec, depth: 'standard' })).ok === false
  })())

  const geminiFixedAtReported = st(sha.E, { ...codexCovers(sha.E), geminiVerdicts: [verdict(60, sha.F, id.F, 'findings', [1])] })
  const fixedAtReportedRec = prRecord([fixedAt('gemini:60:1', sha.F)], { slots: STD_SLOTS })
  ok('fixed naming the commit the Gemini finding was reported on -> FAIL naming it, though that verdict has the current identity', /gemini:/.test((await evaluateGate({ state: geminiFixedAtReported, record: fixedAtReportedRec, depth: 'standard' })).lines.join()) && (await evaluateGate({ state: geminiFixedAtReported, record: fixedAtReportedRec, depth: 'standard' })).ok === false)

  ok('... and the guard that fires is the strict-descendant rule (naming the reported commit itself), not only the identity rule', await (async () => { const r = await evaluateGate({ state: geminiFixedAtReported, record: fixedAtReportedRec, depth: 'standard' }); return r.lines.some((l) => /^FAIL gemini:60:1\b.*not a strict descendant/.test(l)) })())

  const threadFixedBeforeReported = fixedReReviewed
  const fixedBeforeReportedRec = prRecord([fixedAt('thread:PRRT_1', sha.Q0)], { slots: STD_SLOTS })
  ok('fixed naming an ancestor of the reported commit -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: threadFixedBeforeReported, record: fixedBeforeReportedRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
  const threadFixedSameIdentity = fixedReReviewed
  const fixedSameIdentityRec = prRecord([fixedAt('thread:PRRT_1', sha.S)], { slots: STD_SLOTS })
  ok('fixed naming a later commit that leaves the identity unchanged -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: threadFixedSameIdentity, record: fixedSameIdentityRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
  const reviewOffFixLaterDate = st(sha.E, { ...codexCovers(sha.E), threads: [crThreadResolved], reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5)), review(3, CODERABBIT_LOGIN, sha.Y, T(90))] })
  ok('fixed thread whose only later review is on a commit off the fix commit, dated after it -> FAIL naming the thread', await (async () => { const r = await evaluateGate({ state: reviewOffFixLaterDate, record: fixedRec, depth: 'standard' }); return r.ok === false && /thread:/.test(r.lines.join()) })())
  ok('a reported commit that cannot be fetched fails (a) closed, naming the finding', await (async () => { const s = { ...fixedReReviewed, threads: [thread('PRRT_1', CODERABBIT_LOGIN, 'f'.repeat(40), { resolved: true, resolvedBy: 'dev' })] }; const r = await evaluateGate({ state: s, record: fixedRec, depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL thread:PRRT_1\b/.test(l)) })())

  // ---------------------------------------------------------------- cr: findings (gate point 4)
  const crCommentWithFinding = { id: 300, login: CODERABBIT_LOGIN, body: outsideDiffBody('abc123'), createdAt: T(6), updatedAt: T(6) }
  const crSub = subRecord({ bot: 'coderabbit', vendor: 'anthropic', identity: id.E, stem: 'substitute-coderabbit--c--1', fixedIds: ['cr:abc123'] })
  const crIssueCommentFixed = st(sha.E, { ...codexCovers(sha.E), comments: [crCommentWithFinding], records: [crSub] })
  const crFixedRec = prRecord([fixedAt('cr:abc123', sha.F)], { slots: STD_SLOTS })
  const crFixedWithSub = prRecord([fixedAt('cr:abc123', sha.F, 'substitute-coderabbit--c--1')], { slots: STD_SLOTS })
  ok('fixed cr: finding read from an issue comment (no reported commit) -> FAIL naming it; with an accepted substitute resolving it -> ok', await (async () => { const r = await evaluateGate({ state: crIssueCommentFixed, record: crFixedRec, depth: 'standard' }); return r.ok === false && /cr:/.test(r.lines.join()) && (await evaluateGate({ state: crIssueCommentFixed, record: crFixedWithSub, depth: 'standard' })).ok })())
  ok('a substitute that left the finding open does not verify it', (await evaluateGate({ state: { ...crIssueCommentFixed, records: [subRecord({ bot: 'coderabbit', vendor: 'anthropic', identity: id.E, stem: 'substitute-coderabbit--c--1', openIds: ['cr:abc123'] })] }, record: crFixedWithSub, depth: 'standard' })).ok === false)
  ok('an accepted substitute whose chain head does not hold the finding does not verify it', await (async () => {
    const r = await evaluateGate({ state: { ...crIssueCommentFixed, records: [subRecord({ bot: 'coderabbit', vendor: 'anthropic', identity: id.E, stem: 'substitute-coderabbit--c--1' })] }, record: crFixedWithSub, depth: 'standard' })
    return r.ok === false && r.lines.some((l) => /^FAIL cr:abc123\b.*does not hold/.test(l))
  })())
  ok('a substitute for another bot does not verify a cr: finding', (await evaluateGate({ state: { ...crIssueCommentFixed, records: [{ ...crSub, slot: 'substitute:gemini' }] }, record: crFixedWithSub, depth: 'standard' })).ok === false)
  const crReviewFixedReReviewed = st(sha.E, { reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5), outsideDiffBody('abc123')), review(2, CODERABBIT_LOGIN, sha.E, T(40))] })
  ok('fixed cr: finding from a review body, fix commit strictly descends from its reported commit and changes the identity, later usable CodeRabbit review on the fix -> ok (gate point 4)', (await evaluateGate({ state: crReviewFixedReReviewed, record: crFixedRec, depth: 'standard' })).ok)
  ok('the same cr: finding repeated in the review on the fix is reported there too -> FAIL', (await evaluateGate({ state: st(sha.E, { reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5), outsideDiffBody('abc123')), review(2, CODERABBIT_LOGIN, sha.E, T(40), outsideDiffBody('abc123'))] }), record: crFixedRec, depth: 'standard' })).ok === false)
  ok('an outside-diff section whose count does not match -> could not judge', await (async () => { const bad = outsideDiffBody('abc123').replace('comments (1)', 'comments (2)'); const r = await evaluateGate({ state: st(sha.E, { reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5), bad)] }), record: crFixedRec, depth: 'standard' }); return r.ok === false && /could not judge/.test(r.lines.join()) })())
  ok('an outside-diff finding located in .review/ is outside the gate', blockingFindings(st(sha.E, { comments: [{ ...crCommentWithFinding, body: outsideDiffBody('abc123', '.review/pr/1.json') }] })).length === 0)

  // ---------------------------------------------------------------- who opened the thread
  const humanThread = st(sha.E, { threads: [thread('PRRT_H', 'dev', sha.R, { body: CODEX_P1 })] })
  ok('a human-opened thread is not a blocking finding', blockingFindings(humanThread).length === 0)
  ok('the same thread opened by the Codex bot is one', blockingFindings(st(sha.E, { threads: [thread('PRRT_H', CODEX_LOGIN, sha.R, { body: CODEX_P1 })] })).length === 1)
  ok('a thread resolved by a person is not bot-resolved', blockingFindings(authorResolvedP1).length === 1)

  // ---------------------------------------------------------------- fixed: rule (b) and D-7
  const subCodex = subRecord({ bot: 'codex', vendor: 'anthropic', identity: id.U, stem: 'substitute-codex--u--1', fixedIds: ['thread:PRRT_1'] })
  const fixUnrelatedThenFail = st(sha.U, {
    reviews: [review(2, CODERABBIT_LOGIN, sha.U, T(40))],
    codexState: { commitSha: sha.F, status: 'completed', at: T(10), commentId: 900 }, codexHistory: { reviews: [{ sha: sha.F, at: T(10), status: 'completed' }], complete: true },
    geminiVerdicts: [verdict(80, sha.U, id.U, 'no-findings')],
    threads: [codexThreadOnR('PRRT_1', { resolved: true, resolvedBy: 'dev' })], records: [subCodex],
  })
  const withSubResolving = prRecord([fixedAt('thread:PRRT_1', sha.F, 'substitute-codex--u--1'), fixedAt('gemini:61:1', sha.F, 'substitute-gemini--u--1')], { slots: SUBTLE_SLOTS })
  ok('bot finding -> fix -> unrelated commit -> bot fails -> substitute inherits the fixed-but-unverified finding and resolves it -> ok', (await evaluateGate({ state: fixUnrelatedThenFail, record: withSubResolving, depth: 'subtle-correctness' })).ok)
  ok('the same without the substitute record -> FAIL', (await evaluateGate({ state: { ...fixUnrelatedThenFail, records: [] }, record: withSubResolving, depth: 'subtle-correctness' })).ok === false)
  ok('the same with a substitute by a counted vendor (google, Gemini covered) -> FAIL', (await evaluateGate({ state: { ...fixUnrelatedThenFail, records: [{ ...subCodex, reviewer: { vendor: 'google', model: 'm' } }] }, record: withSubResolving, depth: 'subtle-correctness' })).ok === false)
  const geminiFixedThenFailed = st(sha.U, {
    reviews: [review(2, CODERABBIT_LOGIN, sha.U, T(40))], ...codexCovers(sha.U),
    geminiVerdicts: [verdict(61, sha.R, id.R, 'findings', [1], T(5)), verdict(81, sha.U, '', 'could-not-run', [], T(30))],
    records: [subRecord({ bot: 'gemini', vendor: 'anthropic', identity: id.U, stem: 'substitute-gemini--u--1', fixedIds: ['gemini:61:1'] })],
  })
  ok('Gemini finding -> fix -> Gemini could-not-run -> substitute resolves it -> ok', (await evaluateGate({ state: geminiFixedThenFailed, record: withSubResolving, depth: 'subtle-correctness' })).ok)
  const geminiRepeats = st(sha.U, {
    reviews: [review(2, CODERABBIT_LOGIN, sha.U, T(40))], ...codexCovers(sha.U),
    geminiVerdicts: [verdict(62, sha.R, id.R, 'findings', [1], T(5)), verdict(63, sha.U, id.U, 'findings', [1, 2], T(50))],
  })
  const fixedFirstOnly = prRecord([fixedAt('gemini:62:1', sha.F)], { slots: SUBTLE_SLOTS, reclassified: [{ id: 'gemini:63:1', reason: 'a different, cosmetic point' }] })
  ok('re-review repeats the defect as a new Gemini index -> FAIL on the new ID', /gemini:.*:2/.test((await evaluateGate({ state: geminiRepeats, record: fixedFirstOnly, depth: 'subtle-correctness' })).lines.join()))
  ok('... and only the new ID fails: the first fix is verified by the later verdict', await (async () => { const r = await evaluateGate({ state: geminiRepeats, record: fixedFirstOnly, depth: 'subtle-correctness' }); const failing = r.lines.filter((l) => l.startsWith('FAIL')); return r.ok === false && failing.length === 1 && /^FAIL gemini:63:2\b/.test(failing[0]) })())

  // ---------------------------------------------------------------- final review I-2: fail-open guards, each with a test that fails without it
  const failsOn = (r, re) => r.ok === false && r.lines.some((l) => re.test(l))
  // review-gate.mjs ruleA "with the current identity": the head is U (a new identity); the only CodeRabbit review after
  // the fix is on E, a descendant of the fix whose identity (E's) is no longer the current one.
  const fixedThenStaleReview = st(sha.U, { ...codexCovers(sha.U), threads: [crThreadResolved], reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5)), review(2, CODERABBIT_LOGIN, sha.E, T(40))] })
  ok('I-2 rule (a): a review on a descendant of the fix whose identity is not the current one does not verify it', failsOn(await evaluateGate({ state: fixedThenStaleReview, record: fixedRec, depth: 'standard' }), /^FAIL thread:PRRT_1\b.*no usable coderabbit review/))
  ok('I-2 rule (a): ... a review on the current head does (control)', (await evaluateGate({ state: { ...fixedThenStaleReview, reviews: [...fixedThenStaleReview.reviews, review(3, CODERABBIT_LOGIN, sha.U, T(50))] }, record: fixedRec, depth: 'standard' })).ok)
  // botEvidence: an empty CodeRabbit review is never fix evidence (V4).
  const fixedEmptyReReview = st(sha.E, { ...codexCovers(sha.E), threads: [crThreadResolved], reviews: [review(1, CODERABBIT_LOGIN, sha.R, T(5)), review(2, CODERABBIT_LOGIN, sha.E, T(40), '')] })
  ok('I-2: an empty CodeRabbit review on the fix is not fix evidence', failsOn(await evaluateGate({ state: fixedEmptyReReview, record: fixedRec, depth: 'standard' }), /^FAIL thread:PRRT_1\b.*no usable coderabbit review/))
  // botEvidence: a `running` Codex marker is never fix evidence (gate point 3).
  const codexRunningOnFix = st(sha.E, {
    reviews: [review(2, CODERABBIT_LOGIN, sha.E, T(40))], threads: [codexThreadOnR('PRRT_1', { resolved: true, resolvedBy: 'dev' })],
    codexState: { commitSha: sha.E, status: 'running', at: T(20), commentId: 900 }, codexHistory: { reviews: [{ sha: sha.E, at: T(20), status: 'running' }], complete: true },
  })
  ok('I-2: a running Codex marker on the fix is not fix evidence', failsOn(await evaluateGate({ state: codexRunningOnFix, record: fixedRec, depth: 'standard' }), /^FAIL thread:PRRT_1\b.*no usable codex review/))
  ok('I-2: ... the same marker completed is (control)', (await evaluateGate({ state: { ...codexRunningOnFix, ...codexCovers(sha.E) }, record: fixedRec, depth: 'standard' })).ok)
  // botEvidence: a could-not-run Gemini verdict, and one with identity "", are never fix evidence.
  const geminiFixed = (later, extra = {}) => st(sha.E, { ...codexCovers(sha.E), geminiVerdicts: [verdict(61, sha.R, id.R, 'findings', [1], T(5)), later], ...extra })
  const geminiFixedRec = prRecord([fixedAt('gemini:61:1', sha.F)], { slots: STD_SLOTS })
  ok('I-2: a could-not-run Gemini verdict on the current identity is not fix evidence', failsOn(await evaluateGate({ state: geminiFixed(verdict(82, sha.E, id.E, 'could-not-run', [], T(40))), record: geminiFixedRec, depth: 'standard' }), /^FAIL gemini:61:1\b.*no usable gemini review/))
  ok('I-2: ... a no-findings verdict there is (control)', (await evaluateGate({ state: geminiFixed(verdict(82, sha.E, id.E, 'no-findings', [], T(40))), record: geminiFixedRec, depth: 'standard' })).ok)
  // The "" guard matters only when the current identity is itself "" (unknown): "" must never equal it.
  ok('I-2: a Gemini verdict with identity "" is not fix evidence, even when the current identity is ""', failsOn(await evaluateGate({ state: geminiFixed(verdict(82, sha.E, '', 'no-findings', [], T(40)), { currentIdentity: '' }), record: geminiFixedRec, depth: 'mechanical' }), /^FAIL gemini:61:1\b.*no usable gemini review/))
  // ruleB: the chain head must hold the finding as `fixed`; any other acceptable disposition there does not verify a fix.
  const crSubPreExisting = { ...subRecord({ bot: 'coderabbit', vendor: 'anthropic', identity: id.E, stem: 'substitute-coderabbit--c--1' }), findings: [{ id: 'cr:abc123', severity: 'P1', summary: 'inherited', disposition: { kind: 'pre-existing', reason: 'on main', issue: 'https://example.test/i/9' } }] }
  ok('I-2 rule (b): a chain head holding the finding as pre-existing (not fixed) does not verify the fix', failsOn(await evaluateGate({ state: { ...crIssueCommentFixed, records: [crSubPreExisting] }, record: crFixedWithSub, depth: 'standard' }), /^FAIL cr:abc123\b.*does not hold cr:abc123 as fixed/))
  // judgedDepth: the label is a floor raised by inferLabel; no depth label judges at standard, never mechanical.
  const gitStub = (paths) => ({ mergeBase: async () => sha.M0, changedPaths: async () => paths, agentsAt: async () => AGENTS })
  const depthOf = (labels, paths) => judgedDepth({ labels, cwd: repo.dir, base: sha.M0, head: sha.E, gitImpl: gitStub(paths) })
  ok('I-2 judgedDepth: a mechanical label on a control-file change is judged subtle-correctness (inferLabel floor), with a note', await (async () => { const r = await depthOf(['mechanical'], ['package.json']); return r.depth === 'subtle-correctness' && r.notes.some((l) => /judged as subtle-correctness, not the mechanical label/.test(l)) })())
  ok('I-2 judgedDepth: a standard label on a migration is judged subtle-correctness', (await depthOf(['standard'], ['supabase/migrations/1.sql'])).depth === 'subtle-correctness')
  ok('I-2 judgedDepth: a mechanical label on ordinary paths stays mechanical (control)', (await depthOf(['mechanical'], ['src/a.js'])).depth === 'mechanical')
  ok('I-2 judgedDepth: no depth label on ordinary paths is judged standard (needs a slot; label-gate fails the PR anyway), never mechanical', await (async () => { const r = await depthOf(['bug'], ['src/a.js']); return r.depth === 'standard' && r.notes.some((l) => /no depth label; judging at standard/.test(l)) })())
  ok('I-2 judgedDepth: several depth labels judge at the highest', (await depthOf(['subtle-correctness', 'mechanical'], ['src/a.js'])).depth === 'subtle-correctness')
  ok('I-2 judgedDepth: a head with no AGENTS.md throws (could not judge)', /no AGENTS\.md/.test(await (async () => { try { await judgedDepth({ labels: ['standard'], cwd: repo.dir, base: sha.M0, head: sha.E, gitImpl: { ...gitStub([]), agentsAt: async () => null } }); return '' } catch (e) { return e.message } })()))
  // makeResolveCommit: anything but 7-64 lowercase hex never reaches git.
  ok('I-2 makeResolveCommit: non-hex, option-like, short, uppercase or non-string input never reaches git', await (async () => {
    const calls = []
    const spy = async (args) => { calls.push(args); return { code: 0, stdout: Buffer.from(`${sha.F}\n`) } }
    const rc = makeResolveCommit({ cwd: repo.dir, gitRun: spy })
    // Upper-cased hex must contain a letter, or upper-casing changes nothing (an all-digit prefix stays valid hex).
    const upperWithLetter = `${sha.F.slice(0, 6)}a`.toUpperCase()
    const bad = ['--output=/tmp/x', '-h', 'HEAD', 'main', sha.F.slice(0, 6), upperWithLetter, `${sha.F.slice(0, 7)} `, `${sha.F.slice(0, 7)}^{tree}`, 'f'.repeat(65), '', null, 1234567]
    const out = await Promise.all(bad.map((x) => rc(x)))
    const good = await rc(sha.F.slice(0, 7))
    return out.every((x) => x === null) && calls.length === 1 && calls[0].at(-1) === `${sha.F.slice(0, 7)}^{commit}` && good === sha.F
  })())
  // Final review I-1, through the gate: the commit adding the records is evidence-only (E keeps F's identity) and
  // arrives 100 minutes after F; the clock runs from F's arrival, so at T(120) the CodeRabbit slot needs a substitute.
  const evidenceOnlyLate = st(sha.E, { runs: [{ ...st(sha.E).runs[0], headSha: sha.F, createdAt: T(0) }, { ...st(sha.E).runs[0], id: 2, createdAt: T(100) }] })
  ok('I-1 gate: an evidence-only head 100 minutes after the fix commit keeps the fix commit\'s clock (needs-substitute, not pending)', await (async () => { const r = await evaluateGate({ state: evidenceOnlyLate, record: prRecord(), depth: 'standard' }); return r.ok === false && r.lines.some((l) => /^FAIL slot coderabbit\|codex\b.*coderabbit needs-substitute/.test(l)) })())
  ok('I-1 gate: a head that changes the identity restarts it (U after E: pending, naming when substitution is allowed)', await (async () => {
    const s = st(sha.U, { runs: [{ ...st(sha.U).runs[0], headSha: sha.E, createdAt: T(0) }, { ...st(sha.U).runs[0], id: 2, createdAt: T(100) }] })
    const r = await evaluateGate({ state: s, record: prRecord(), depth: 'standard' })
    return r.ok === false && r.lines.some((l) => /^FAIL slot coderabbit\|codex\b.*coderabbit pending: .*substitution allowed after 2026-11-05T12:10:00\.000Z; re-run review-gate then/.test(l))
  })())

  // ---------------------------------------------------------------- the workflow
  const wf =readFileSync(new URL('../../.github/workflows/review-gate.yml', import.meta.url), 'utf8')
  const block = (name) => (new RegExp(`^${name}:\\n((?:  .*\\n)+)`, 'm').exec(wf)?.[1] ?? '').trim().split('\n').map((l) => l.trim()).sort().join('|')
  ok('workflow: read-only permissions, exactly contents, pull-requests, checks, actions', block('permissions') === 'actions: read|checks: read|contents: read|pull-requests: read')
  ok('workflow: pull_request (seven types) and pull_request_review (submitted, dismissed); never pull_request_target', /pull_request:\n {4}types: \[opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review\]\n {2}pull_request_review:\n {4}types: \[submitted, dismissed\]/.test(wf) && !/pull_request_target/.test(wf))
  ok('workflow: PR-head checkout, full history, no persisted credentials; job and check named review-gate', /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/.test(wf) && /fetch-depth: 0/.test(wf) && /persist-credentials: false/.test(wf) && /^ {2}review-gate:\n {4}name: review-gate$/m.test(wf) && /run: node scripts\/ci\/review-gate\.mjs/.test(wf))
  ok('workflow: concurrency on PR and head, not cancelled', /group: review-gate-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}\n {2}cancel-in-progress: false/.test(wf))

  // ---------------------------------------------------------------- main(): the CI entry
  // A stubbed GitHub API for PR #1 in o/r. scen: { pr, threads, reviews, comments, activation } ; status 403 everywhere with stub403.
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  const prObj = (createdAt, extra = {}) => ({
    number: 1, state: 'open', draft: false, created_at: createdAt, body: '', user: { login: 'dev' }, labels: [{ name: 'standard' }],
    head: { sha: sha.E, ref: 'pr', repo: { full_name: 'o/r' } }, base: { sha: sha.M0, ref: 'main', repo: { full_name: 'o/r' } }, ...extra,
  })
  const gqlThread = (t) => ({ id: t.id, isResolved: t.isResolved, path: t.path, resolvedBy: t.resolvedBy ? { login: t.resolvedBy } : null, comments: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ author: { login: 'chatgpt-codex-connector', __typename: 'Bot' }, editor: null, body: t.firstComment.body, url: 'u', originalCommit: { oid: t.firstComment.originalCommit } }] } })
  const failingState = { threads: [codexThreadOnR('PRRT_1')] }
  const prCreatedAt = (at, scen) => ({ ...scen, pr: prObj(at) })
  const apiStub = (scen, activation) => async (url, init = {}) => {
    const u = new URL(url)
    const p = u.pathname
    if (p === '/repos/o/r/pulls/1') return res(200, scen.pr)
    if (p === '/repos/o/r/contents/.github/review-activation.json') return activation()
    if (p === '/repos/o/r/pulls/1/reviews') return res(200, u.searchParams.get('page') === '1' ? (scen.reviews ?? []) : [])
    if (p === '/repos/o/r/issues/1/comments') return res(200, u.searchParams.get('page') === '1' ? (scen.comments ?? []) : [])
    if (p === '/graphql') {
      const q = JSON.parse(init.body).query
      if (/reviewThreads/.test(q)) return res(200, { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: (scen.threads ?? []).map(gqlThread) } } } } })
      return res(200, { errors: [{ message: 'unexpected query' }] })
    }
    if (/\/check-runs$/.test(p)) return res(200, { total_count: 0, check_runs: [] })
    if (p === '/repos/o/r/actions/runs') return res(200, { total_count: 1, workflow_runs: [{ id: 1, name: 'ci', event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: sha.E, head_repository: { full_name: 'o/r' }, created_at: T(0), pull_requests: [{ number: 1 }] }] })
    if (p === '/repos/o/r/actions/workflows/gemini-review.yml/runs') return res(200, { total_count: 0, workflow_runs: [] })
    return res(404, { message: `no stub for ${p}` })
  }
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
  const activationFile = (obj) => (scen) => apiStub(scen, () => res(200, { encoding: 'base64', content: b64(JSON.stringify(obj)) }))
  const stub403 = async () => res(403, { message: 'Forbidden' })
  const goodEnv = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '1' }

  // main() judges the checkout it runs in (as CI's PR-head checkout): the fixture repo at E.
  g(repo.dir, ['checkout', '-q', '--detach', sha.E])
  process.chdir(repo.dir)
  ok('API error -> exit 1 "could not judge"', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: stub403 })); return r.code === 1 && /could not judge/.test(r.out) })())
  ok('a PR created before the review-gate activation time is exempt; one created after is judged', (await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-gate': '2026-11-05T00:00:00Z' })(prCreatedAt('2026-11-04T23:59:59Z', failingState)) }))).code === 0 && await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-gate': '2026-11-05T00:00:00Z' })(prCreatedAt('2026-11-05T00:00:01Z', failingState)) })); return r.code === 1 && /thread:/.test(r.out) })())
  ok('a review-evidence key alone does not exempt from review-gate (failingState holds one undisposed blocking thread, which the judged output names)', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-evidence': '2026-11-05T00:00:00Z' })(prCreatedAt('2020-01-01T00:00:00Z', failingState)) })); return r.code === 1 && /thread:/.test(r.out) })())
  ok('main: a GraphQL thread from the Codex Bot actor (login without [bot]) is read as the bot\'s', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({})(prCreatedAt('2026-11-05T00:00:01Z', failingState)) })); return r.code === 1 && /FAIL thread:PRRT_1/.test(r.out) })())
  ok('main: a checkout that is not the PR head -> could not judge', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({})({ ...failingState, pr: prObj('2026-11-05T00:00:01Z', { head: { sha: sha.U, ref: 'pr', repo: { full_name: 'o/r' } } }) }) })); return r.code === 1 && /could not judge/.test(r.out) })())
  ok('main: missing env -> could not judge', (await quiet(() => main({ env: {} }))).code === 1)
  ok('main: an unparseable activation value -> could not judge', await (async () => { const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({ 'review-gate': 'soon' })(prCreatedAt('2026-11-05T00:00:01Z', failingState)) })); return r.code === 1 && /could not judge/.test(r.out) })())
  ok('main: a clean PR with a covering record passes', await (async () => {
    const scen = { pr: prObj('2026-11-05T00:00:01Z', { labels: [{ name: 'mechanical' }] }), threads: [] }
    const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({})(scen) }))
    return r.code === 0 && /review-gate: ok/.test(r.out)
  })())
  // Minor 6: main moved after the checkout, so the PR's base (read from the API afterwards) is not in the clone. The
  // gate fetches it from origin; an unfetchable base fails "could not judge", naming it.
  ok('main: a base commit missing from the checkout is fetched from origin', await (async () => {
    const clone = join(tmp, 'clone-base')
    g(tmp, ['clone', '-q', repo.dir, clone])
    g(clone, ['checkout', '-q', '--detach', sha.E])
    const M1 = g(repo.dir, ['commit-tree', `${sha.M0}^{tree}`, '-p', sha.M0, '-m', 'main moved'])
    g(repo.dir, ['update-ref', 'refs/heads/main', M1])
    const missingBefore = (() => { try { g(clone, ['cat-file', '-e', `${M1}^{commit}`]); return false } catch { return true } })()
    const scen = { pr: prObj('2026-11-05T00:00:01Z', { labels: [{ name: 'mechanical' }], base: { sha: M1, ref: 'main', repo: { full_name: 'o/r' } } }), threads: [] }
    const r = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({})(scen), cwd: clone }))
    const unfetchable = await quiet(() => main({ env: goodEnv, fetchImpl: activationFile({})({ ...scen, pr: prObj('2026-11-05T00:00:01Z', { labels: [{ name: 'mechanical' }], base: { sha: 'e'.repeat(40), ref: 'main', repo: { full_name: 'o/r' } } }) }), cwd: clone }))
    return missingBefore && r.code === 0 && /review-gate: ok/.test(r.out)
      && unfetchable.code === 1 && /could not judge\): the PR's base commit eeeeeeeeeeee is not in the checkout and could not be fetched/.test(unfetchable.out)
  })())
  ok('readGateState (the pr-record path, no main()) also fetches a missing base', await (async () => {
    const clone = join(tmp, 'clone-base-2')
    g(tmp, ['clone', '-q', repo.dir, clone])
    g(clone, ['checkout', '-q', '--detach', sha.E])
    const M2 = g(repo.dir, ['commit-tree', `${sha.M0}^{tree}`, '-p', sha.M0, '-m', 'main moved again'])
    g(repo.dir, ['update-ref', 'refs/heads/main', M2])
    const pr = prObj('2026-11-05T00:00:01Z', { base: { sha: M2, ref: 'main', repo: { full_name: 'o/r' } } })
    const s = await readGateState({ repo: 'o/r', token: 't', fetchImpl: activationFile({})({ pr, threads: [] }), pr, cwd: clone, now: Date.parse(T(120)) })
    return s.currentIdentity === id.E && s.pr.base === M2
  })())
} finally {
  process.chdir(startCwd)
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
