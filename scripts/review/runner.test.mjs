// Self-test for scripts/review/runner.mjs. Builds scratch git repos in mkdtemp and deletes them afterwards.
// Never spawns a real reviewer or makes a network call: every run injects spawnImpl / fetchImpl / promptFor.
// Run: node scripts/review/runner.test.mjs
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PassThrough } from 'node:stream'

const root = mkdtempSync(join(tmpdir(), 'runner-test-'))
const emptyConfig = join(root, 'empty.gitconfig')
writeFileSync(emptyConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const { DIFF_ARGS, geminiDiff, git, inputIdentity, mergeBase } = await import('./identity.mjs')
const { readRecords, writeRecord } = await import('./records.mjs')
const { classifyOutcome, defaultPromptFor, pickReviewer, runCli } = await import('./runner.mjs')

const mkOk = (counter, log = console.log) => (n, c) => {
  if (c && typeof c.then === 'function') { counter.fail++; log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { counter.pass++ } else { counter.fail++; log('  FAIL', n) }
}
const counter = { pass: 0, fail: 0 }
const ok = mkOk(counter)

// --- the helper itself: a Promise is a failure, never a pass ---
{
  const sub = { pass: 0, fail: 0 }
  const subOk = mkOk(sub, () => {})
  subOk('x', Promise.resolve(false))
  subOk('y', Promise.resolve(true))
  ok('ok() counts a Promise (even one resolving true) as a failure', sub.fail === 2 && sub.pass === 0)
}

// --- fake child processes ---
const fakeChild = ({ respond, hang = false }) => {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
  const chunks = []
  const close = (code, signal) => setImmediate(() => setImmediate(() => child.emit('close', code, signal)))
  child.kill = () => { child.stdout.end(); child.stderr.end(); close(null, 'SIGTERM'); return true }
  child.stdin.on('data', (d) => chunks.push(Buffer.from(d)))
  child.stdin.on('finish', () => {
    const r = respond(Buffer.concat(chunks).toString('utf8'))
    if (hang) return
    child.stdout.end(r.stdout ?? ''); child.stderr.end(r.stderr ?? '')
    close(r.code ?? 0, null)
  })
  return child
}
// Codex writes its answer to the -o file; Claude prints a JSON envelope. Given a Claude envelope, answer as either.
const answer = (cmd, args, envelope, code = 0) => {
  if (/codex/.test(cmd)) {
    const i = args.indexOf('-o')
    if (i >= 0) writeFileSync(args[i + 1], JSON.parse(envelope).result)
    return { stdout: '', code }
  }
  return { stdout: envelope, code }
}
const recordSpawn = (sp, envelope, code = 0) => (cmd, args, opts) => {
  sp.push({ cmd, args, opts })
  return fakeChild({ respond: () => answer(cmd, args, envelope, code) })
}
const capturePrompt = (sent, envelope, code = 0) => (cmd, args) => fakeChild({ respond: (input) => { sent.push(input); return answer(cmd, args, envelope, code) } })
const envelope = (inner) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: inner })
const innerJson = JSON.stringify({ verdict: 'pass', findings: [], inherited: [] })
const envelopeOk = envelope(innerJson)
const promptFor = (slot) => `SLOT PROMPT FOR ${slot}\n`

let repo
const io = () => {
  const o = { out: '', err: '' }
  o.io = { out: (s) => { o.out += s }, err: (s) => { o.err += s } }
  return o
}
const cli = async (argv, opts = {}) => {
  const o = io()
  const code = await runCli(argv, { cwd: repo, promptFor, env: {}, io: o.io, ...opts })
  return { code, ...o }
}
const errOfCli = async (argv, opts) => (await cli(argv, opts)).err

let seq = 0
const raw = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
const commit = (cwd, msg) => {
  raw(cwd, ['add', '-A'])
  raw(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg])
}
const mkrepo = () => {
  const dir = join(root, `r${++seq}`)
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { shell: false })
  return dir
}
const put = (cwd, file, text) => writeFileSync(join(cwd, file), text)
const recordsBy = (pred) => readRecords({ cwd: repo }).filter(pred)
const prRecord = (over) => ({
  schema: 1, type: 'prepush', slot: 'correctness', input: { kind: 'pr', identity: 'x', mergeBase: 'x', head: 'x' },
  reviewer: { vendor: 'openai', model: 'codex-cli' }, authorVendor: 'anthropic', outcome: 'completed', verdict: 'pass',
  findings: [], supersedes: null, createdAt: '2026-11-05T10:00:00.000Z', ...over,
})
const store = (record) => ({ ...record, stem: basename(writeRecord({ cwd: repo, record }), '.json') })

const passJson = innerJson
const failJson = JSON.stringify({ verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', file: 'a.js', line: 3, summary: 'bad' }, { id: 'F2', severity: 'P3', summary: 'nit' }], inherited: [] })
const passJsonNoInherited = '{"verdict":"pass","findings":[]}'

try {
  // --- classifyOutcome ---
  ok('timed out -> timeout, whatever stdout says', classifyOutcome({ exitCode: 0, stdout: passJson, truncated: false, timedOut: true }).outcome === 'timeout')
  ok('exit 0 with prose and no JSON -> refused', classifyOutcome({ exitCode: 0, stdout: 'I cannot review this', truncated: false, timedOut: false }).outcome === 'refused')
  ok('exit 1 with zero findings -> failed, not pass', classifyOutcome({ exitCode: 1, stdout: '{"verdict":"pass","findings":[]}', truncated: false, timedOut: false }).outcome === 'failed')
  ok('MAX_TOKENS -> truncated', classifyOutcome({ exitCode: 0, stdout: passJson, truncated: true, timedOut: false }).outcome === 'truncated')
  ok('valid JSON -> completed with findings', classifyOutcome({ exitCode: 0, stdout: failJson, truncated: false, timedOut: false }).findings.length === 2)
  ok('re-review that omits an inherited ID -> refused', classifyOutcome({ exitCode: 0, stdout: passJsonNoInherited, truncated: false, timedOut: false, inheritedIds: ['x#F1'] }).outcome === 'refused')
  const c = (stdout, inheritedIds) => classifyOutcome({ exitCode: 0, stdout, truncated: false, timedOut: false, inheritedIds })
  ok('a completed outcome carries the verdict', c(failJson).outcome === 'completed' && c(failJson).verdict === 'fail')
  ok('a non-completed outcome has verdict null and no findings', classifyOutcome({ exitCode: 1, stdout: failJson, truncated: false, timedOut: false }).verdict === null && classifyOutcome({ exitCode: 1, stdout: failJson, truncated: false, timedOut: false }).findings.length === 0)
  ok('timeout outranks truncated and a non-zero exit', classifyOutcome({ exitCode: 1, stdout: '', truncated: true, timedOut: true }).outcome === 'timeout')
  ok('truncated outranks a non-zero exit', classifyOutcome({ exitCode: 1, stdout: '', truncated: true, timedOut: false }).outcome === 'truncated')
  ok('a null exit code (killed by signal) -> failed', classifyOutcome({ exitCode: null, stdout: passJson, truncated: false, timedOut: false }).outcome === 'failed')
  ok('prose then a JSON verdict -> completed', c(`Here is my review.\n${failJson}\nThanks.`).outcome === 'completed')
  ok('a fenced json block -> completed', c('Review:\n```json\n' + failJson + '\n```\n').findings.length === 2)
  ok('a stray { in prose before the verdict -> still completed', c(`use {x in prose\n${passJson}`).outcome === 'completed')
  ok('the last valid verdict wins', c(`${failJson}\n${passJson}`).verdict === 'pass')
  ok('a JSON object without inherited -> refused', c(passJsonNoInherited).outcome === 'refused')
  ok('verdict outside pass|fail -> refused', c('{"verdict":"maybe","findings":[],"inherited":[]}').outcome === 'refused')
  ok('a finding without a summary -> refused', c('{"verdict":"fail","findings":[{"id":"F1","severity":"P1"}],"inherited":[]}').outcome === 'refused')
  ok('a finding with a non-integer line -> refused', c('{"verdict":"fail","findings":[{"id":"F1","severity":"P1","summary":"s","line":"3"}],"inherited":[]}').outcome === 'refused')
  ok('duplicate finding IDs -> refused', c('{"verdict":"fail","findings":[{"id":"F1","severity":"P1","summary":"s"},{"id":"F1","severity":"P2","summary":"t"}],"inherited":[]}').outcome === 'refused')
  ok('null file and line are dropped, not recorded', (() => { const f = c('{"verdict":"fail","findings":[{"id":"F1","severity":"P1","summary":"s","file":null,"line":null}],"inherited":[]}').findings[0]; return f && !('file' in f) && !('line' in f) })())
  const inh = (entries) => JSON.stringify({ verdict: 'pass', findings: [], inherited: entries })
  ok('inherited naming each ID once -> completed', c(inh([{ id: 'a#F1', status: 'resolved', note: '' }, { id: 'cr:1', status: 'open', note: 'n' }]), ['a#F1', 'cr:1']).outcome === 'completed')
  ok('inherited naming an ID twice -> refused', c(inh([{ id: 'a#F1', status: 'resolved', note: '' }, { id: 'a#F1', status: 'open', note: '' }]), ['a#F1']).outcome === 'refused')
  ok('inherited naming an extra ID -> refused', c(inh([{ id: 'a#F1', status: 'resolved', note: '' }, { id: 'zz', status: 'open', note: '' }]), ['a#F1']).outcome === 'refused')
  ok('inherited entries when none were sent -> refused', c(inh([{ id: 'a#F1', status: 'resolved', note: '' }])).outcome === 'refused')
  ok('inherited status outside resolved|open -> refused', c(inh([{ id: 'a#F1', status: 'fixed', note: '' }]), ['a#F1']).outcome === 'refused')
  ok('a new finding reusing an inherited ID -> refused', c(JSON.stringify({ verdict: 'fail', findings: [{ id: 'a#F1', severity: 'P1', summary: 's' }], inherited: [{ id: 'a#F1', status: 'open', note: '' }] }), ['a#F1']).outcome === 'refused')

  // --- pickReviewer ---
  ok('Claude-authored correctness -> codex', pickReviewer({ authorVendor: 'anthropic', slot: 'correctness' }) === 'codex')
  ok('Codex-authored correctness -> claude', pickReviewer({ authorVendor: 'openai', slot: 'correctness' }) === 'claude')
  ok('hand-written (none) correctness -> codex', pickReviewer({ authorVendor: 'none', slot: 'correctness' }) === 'codex')
  ok('completeness takes the third vendor', pickReviewer({ authorVendor: 'anthropic', slot: 'completeness', otherVendor: 'openai' }) === 'gemini')
  ok('completeness for a Codex author after a Claude correctness -> gemini', pickReviewer({ authorVendor: 'openai', slot: 'completeness', otherVendor: 'anthropic' }) === 'gemini')
  ok('completeness for none after codex -> not codex', pickReviewer({ authorVendor: 'none', slot: 'completeness', otherVendor: 'openai' }) === 'claude')
  ok('spec/plan/conformance use the primary', ['spec', 'plan', 'conformance'].every((slot) => pickReviewer({ authorVendor: 'anthropic', slot }) === 'codex' && pickReviewer({ authorVendor: 'openai', slot }) === 'claude'))
  ok('a substitute slot is never picked by author vendor', (() => { try { pickReviewer({ authorVendor: 'anthropic', slot: 'substitute:codex' }); return false } catch (e) { return /--reviewer/.test(e.message) } })())

  // --- CLI over a scratch repo ---
  repo = mkrepo()
  put(repo, 'base.txt', 'base\n')
  commit(repo, 'base')
  raw(repo, ['checkout', '-q', '-b', 'pr'])
  put(repo, 'orig.txt', 'ORIGINAL_CHANGE_LINE\n')
  commit(repo, 'pr change')
  const head1 = raw(repo, ['rev-parse', 'HEAD'])
  const mb = await mergeBase({ cwd: repo, base: 'main', head: 'HEAD' })
  const id1 = await inputIdentity({ cwd: repo, base: 'main', head: 'HEAD' })
  const fullDiffAtHead1 = (await geminiDiff({ cwd: repo, base: 'main', head: 'HEAD' })).toString()
  const pr1 = { kind: 'pr', identity: id1, mergeBase: mb, head: head1 }

  // independence
  const spawned = []
  const indep = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--reviewer', 'claude'], { spawnImpl: recordSpawn(spawned, envelopeOk) })
  const err = indep.err
  ok('--reviewer of the author vendor is refused before spawning', spawned.length === 0 && /independence/.test(err))
  ok('the refusal exits 1', indep.code === 1)
  ok('substitute slot: --reviewer of the author vendor spawns through the real runner (stubbed spawnImpl only)', await (async () => { const sp = []; await runCli(['run', '--slot', 'substitute:codex', '--author', 'anthropic', '--reviewer', 'claude'], { cwd: repo, promptFor, env: {}, io: io().io, spawnImpl: recordSpawn(sp, envelopeOk) }); return sp.length === 1 && /claude/.test(sp[0].cmd) })())
  ok('substitute slot without --reviewer is refused, naming the flag', /--reviewer/.test(await errOfCli(['run', '--slot', 'substitute:codex', '--author', 'anthropic'])))
  ok('an unknown reviewer is a usage error', (await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--reviewer', 'gpt'])).code === 1)
  ok('an unknown flag is a usage error on stderr', await (async () => { const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--bogus', 'x']); return r.code === 1 && r.err.length > 0 })())

  // completeness
  ok('completeness with no correctness record for the identity is refused', /correctness first/.test(await errOfCli(['run', '--slot', 'completeness', '--author', 'anthropic'], { spawnImpl: recordSpawn([], envelopeOk) })))

  // a default run: codex picked, record written, exit 0, spawned with the slot prompt on stdin
  {
    const sp = []
    const sent = []
    const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic'], { spawnImpl: (cmd, args, opts) => { sp.push({ cmd, args, opts }); return capturePrompt(sent, envelopeOk)(cmd, args) } })
    const rec = recordsBy((x) => x.slot === 'correctness' && x.supersedes === null && x.reviewer.vendor === 'openai')[0]
    ok('a completed run exits 0', r.code === 0)
    ok('Claude-authored correctness spawns codex', sp.length === 1 && /codex/.test(sp[0].cmd))
    ok('the prompt carries the slot prompt and the full diff', sent.length === 1 && sent[0].includes('SLOT PROMPT FOR correctness') && sent[0].includes(fullDiffAtHead1))
    ok('the record has type prepush, the PR identity and the reviewer', rec && rec.type === 'prepush' && rec.input.kind === 'pr' && rec.input.identity === id1 && rec.input.head === head1 && rec.reviewer.model === 'codex-cli' && rec.authorVendor === 'anthropic' && rec.outcome === 'completed' && rec.verdict === 'pass')
    ok('with no origin/main the base defaults to main', rec && rec.input.mergeBase === mb)
    ok('the CLI prints the outcome', /completed/.test(r.out))
  }

  // a failed run still writes a record and exits 1
  {
    const r = await cli(['run', '--slot', 'conformance', '--author', 'openai'], { spawnImpl: recordSpawn([], envelope('{}'), 3) })
    const rec = recordsBy((x) => x.slot === 'conformance')[0]
    ok('a failed run writes a record with verdict null and exits 1', r.code === 1 && rec && rec.outcome === 'failed' && rec.verdict === null && rec.type === 'conformance' && /failed/.test(r.out + r.err))
  }
  // a timeout: the child is killed
  {
    let killed = 0
    const hang = () => { const ch = fakeChild({ respond: () => ({}), hang: true }); const k = ch.kill; ch.kill = () => { killed++; return k() }; return ch }
    const r = await cli(['run', '--slot', 'plan', '--author', 'anthropic', '--path', 'base.txt', '--timeout-min', '0.001'], { spawnImpl: hang })
    const rec = recordsBy((x) => x.slot === 'plan')[0]
    ok('--timeout-min kills the child and records timeout', r.code === 1 && killed === 1 && rec && rec.outcome === 'timeout')
    ok('a plan record has a blob input for the path', rec && rec.type === 'plan' && rec.input.kind === 'blob' && rec.input.path === 'base.txt' && rec.input.identity === raw(repo, ['rev-parse', 'HEAD:base.txt']))
  }
  ok('a spec slot without --path is a usage error', /--path/.test(await errOfCli(['run', '--slot', 'spec', '--author', 'anthropic'])))

  // --supersedes: the timed-out root with no edits since
  const timedOutRoot = store(prRecord({ input: pr1, outcome: 'timeout', verdict: null }))
  ok('--supersedes of a timed-out root with no edits since sends the full current diff, not the empty delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', timedOutRoot.stem], { cwd: repo, promptFor, env: {}, io: io().io, spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(fullDiffAtHead1) })())
  ok('the re-review names what it supersedes', recordsBy((x) => x.supersedes === timedOutRoot.stem).length === 1)
  ok('a superseded record cannot be superseded again', await (async () => { const sp = []; const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', timedOutRoot.stem], { spawnImpl: recordSpawn(sp, envelopeOk) }); return r.code === 1 && sp.length === 0 && /already superseded/.test(r.err) })())
  ok('--supersedes of a missing stem is refused before spawning', await (async () => { const sp = []; const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', 'nope--1'], { spawnImpl: recordSpawn(sp, envelopeOk) }); return r.code === 1 && sp.length === 0 })())
  const otherSlot = store(prRecord({ slot: 'conformance', type: 'conformance', input: pr1 }))
  ok('--supersedes of a record of another slot is refused before spawning', await (async () => { const sp = []; const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', otherSlot.stem], { spawnImpl: recordSpawn(sp, envelopeOk) }); return r.code === 1 && sp.length === 0 && /slot/.test(r.err) })())

  // the completeness slot now has a correctness head for the identity (codex, completed)
  {
    const sp = []
    const fetchCalls = []
    const r = await cli(['run', '--slot', 'completeness', '--author', 'anthropic'], {
      spawnImpl: recordSpawn(sp, envelopeOk),
      env: { GEMINI_API_KEY: 'KEY123' },
      fetchImpl: async (url, init) => { fetchCalls.push({ url, init }); return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: innerJson }] }, finishReason: 'STOP' }] })}\n\n`) },
    })
    ok('completeness after a codex correctness goes to gemini', r.code === 0 && sp.length === 0 && fetchCalls.length === 1 && recordsBy((x) => x.slot === 'completeness')[0].reviewer.vendor === 'google')
    ok('the gemini record names DEFAULT_MODEL', recordsBy((x) => x.slot === 'completeness')[0].reviewer.model === 'gemini-3.1-pro-preview')
    ok('completeness --reviewer of the correctness vendor is refused', /independence/.test(await errOfCli(['run', '--slot', 'completeness', '--author', 'none', '--reviewer', 'codex'])))
  }

  // a record with an open finding, for the inherit tests, and one with gate findings
  const old = store(prRecord({ input: pr1, verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', summary: 'open bug' }, { id: 'F2', severity: 'P3', summary: 'nit' }] }))
  const oldB = store(prRecord({ input: pr1, verdict: 'fail', findings: [{ id: 'F1', severity: 'P0', summary: 'open bug B' }] }))
  const oldC = store(prRecord({ input: pr1, verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', summary: 'open bug C' }] }))
  const oldGate = store(prRecord({ input: pr1, verdict: 'fail', findings: [
    { id: 'thread:abc', severity: 'P1', summary: 'disposed gate', disposition: { kind: 'reclassified-nit', reason: 'cosmetic' } },
    { id: 'cr:1', severity: 'P1', summary: 'open gate' },
  ] }))

  // edit since: a second commit
  put(repo, 'fix.txt', 'FIX_LINE_DELTA\n')
  commit(repo, 'fix')
  const head2 = raw(repo, ['rev-parse', 'HEAD'])
  const fullCurrentDiff = (await geminiDiff({ cwd: repo, base: 'main', head: 'HEAD' })).toString()
  const deltaOnly = (await git([...DIFF_ARGS, head1, head2, '--', '.', ':(exclude).review'], { cwd: repo })).stdout.toString()
  ok('fixtures: the full diff and the delta differ', fullCurrentDiff.includes('ORIGINAL_CHANGE_LINE') && deltaOnly.includes('FIX_LINE_DELTA') && !deltaOnly.includes('ORIGINAL_CHANGE_LINE'))

  const completedRoot = store(prRecord({ input: pr1, findings: [{ id: 'N1', severity: 'P3', summary: 'nit only' }] }))
  const completedRootWithOpen = store(prRecord({ slot: 'substitute:gemini', type: 'substitute', reviewer: { vendor: 'google', model: 'g' }, input: pr1, verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', summary: 'still open' }] }))
  ok('--supersedes of a completed record with an undisposed blocking finding sends the full current diff and the delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'substitute:gemini', '--author', 'anthropic', '--reviewer', 'claude', '--supersedes', completedRootWithOpen.stem], { cwd: repo, promptFor, env: {}, io: io().io, spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(fullCurrentDiff) && sent[0].includes(deltaOnly) && /Delta since/.test(sent[0]) })())
  ok('--supersedes of a completed record with no undisposed finding sends only the delta', await (async () => { const sent = []; await runCli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', completedRoot.stem], { cwd: repo, promptFor, env: {}, io: io().io, spawnImpl: capturePrompt(sent, envelopeOk) }); return sent.length === 1 && sent[0].includes(deltaOnly) && sent[0].includes(fullCurrentDiff) === false && sent[0].includes('ORIGINAL_CHANGE_LINE') === false })())

  // inherit: the reviewer leaves it open
  const inheritedReply = (id, status) => envelope(JSON.stringify({ verdict: status === 'open' ? 'fail' : 'pass', findings: [], inherited: [{ id, status, note: 'checked' }] }))
  {
    const sent = []
    const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', old.stem], { spawnImpl: capturePrompt(sent, inheritedReply(`${old.stem}#F1`, 'open')) })
    const newRec = recordsBy((x) => x.supersedes === old.stem)[0]
    ok('run with --supersedes inherits an undisposed finding into the new record', r.code === 0 && newRec.findings.some((f) => f.id === `${old.stem}#F1`))
    ok('an open inherited finding stays undisposed', newRec.findings.find((f) => f.id === `${old.stem}#F1`).disposition === undefined)
    ok('a P3 from the old record is not carried', newRec.findings.length === 1)
    ok('the prompt lists the inherited ID and the full diff', sent[0].includes(`${old.stem}#F1`) && sent[0].includes(fullCurrentDiff))
    ok('the new record covers the new head', newRec.input.head === head2 && newRec.supersedes === old.stem)
  }
  // inherit: the reviewer marks it resolved
  {
    await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', oldB.stem], { spawnImpl: capturePrompt([], inheritedReply(`${oldB.stem}#F1`, 'resolved')) })
    const newRecResolved = recordsBy((x) => x.supersedes === oldB.stem)[0]
    ok('re-review marking the inherited finding resolved -> disposition fixed by the new record', newRecResolved.findings.find((f) => f.id === `${oldB.stem}#F1`).disposition.by === newRecResolved.stem)
    ok('the resolved disposition kind is fixed', newRecResolved.findings.find((f) => f.id === `${oldB.stem}#F1`).disposition.kind === 'fixed')
  }
  // a failed re-review carries the inherited finding forward undisposed
  {
    const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', oldC.stem], { spawnImpl: recordSpawn([], envelopeOk, 1) })
    const rec = recordsBy((x) => x.supersedes === oldC.stem)[0]
    ok('a failed re-review is recorded with the inherited findings undisposed and exits 1', r.code === 1 && rec.outcome === 'failed' && rec.verdict === null && rec.findings.length === 1 && rec.findings[0].id === `${oldC.stem}#F1` && rec.findings[0].disposition === undefined)
  }
  // gate IDs
  {
    const sent = []
    const r = await cli(['run', '--slot', 'correctness', '--author', 'anthropic', '--supersedes', oldGate.stem], { spawnImpl: capturePrompt(sent, inheritedReply('cr:1', 'open')) })
    const rec = recordsBy((x) => x.supersedes === oldGate.stem)[0]
    ok('a disposed gate finding is not sent to the reviewer; an undisposed one is', sent[0].includes('thread:abc') === false && sent[0].includes('cr:1'))
    ok('only the undisposed gate finding counts toward inherited, so naming it alone completes', r.code === 0 && rec.outcome === 'completed')
    ok('the disposed gate finding is copied with its disposition', rec.findings.find((f) => f.id === 'thread:abc').disposition.kind === 'reclassified-nit')
    ok('the open gate finding keeps its ID, undisposed', rec.findings.find((f) => f.id === 'cr:1').disposition === undefined)
  }

  // gemini through the CLI: the key never reaches stdout, stderr or the record
  {
    const r = await cli(['run', '--slot', 'substitute:gemini', '--author', 'anthropic', '--reviewer', 'gemini'], {
      env: { GEMINI_API_KEY: 'KEY123' },
      fetchImpl: async () => new Response('upstream echoed key=KEY123', { status: 403 }),
    })
    const rec = recordsBy((x) => x.slot === 'substitute:gemini' && x.reviewer.vendor === 'google' && x.supersedes === null && x.outcome === 'failed')
    const all = r.out + r.err + rec.map((x) => readFileSync(join(repo, '.review', 'records', `${x.stem}.json`), 'utf8')).join('')
    ok('gemini CLI run: the output under test is non-empty', typeof all === 'string' && all.length > 0 && rec.length === 1 && /403/.test(r.err))
    ok('gemini: the API key never appears in stdout, stderr or the record', !all.includes('KEY123'))
  }

  // gemini through the CLI: a diff over the cap makes no request
  {
    const big = mkrepo()
    put(big, 'a.txt', 'a\n'); commit(big, 'base')
    raw(big, ['checkout', '-q', '-b', 'pr'])
    put(big, 'big.txt', 'x'.repeat(400_001) + '\n'); commit(big, 'big')
    const fetchCalls = []
    const o = io()
    const code = await runCli(['run', '--slot', 'substitute:gemini', '--author', 'anthropic', '--reviewer', 'gemini'], { cwd: big, promptFor, env: { GEMINI_API_KEY: 'KEY123' }, io: o.io, fetchImpl: async (u) => { fetchCalls.push(u); return new Response('') } })
    ok('gemini CLI: a diff over 400,000 bytes makes no request and fails', fetchCalls.length === 0 && code === 1 && /400000/.test(o.err))
  }

  // the default base is origin/main when it exists
  {
    const origin = mkrepo()
    put(origin, 'a.txt', 'a\n'); commit(origin, 'A')
    const originTip = raw(origin, ['rev-parse', 'HEAD'])
    const clone = join(root, 'clone')
    raw(root, ['clone', '-q', origin, clone])
    put(clone, 'b.txt', 'b\n'); commit(clone, 'B on local main only')
    raw(clone, ['checkout', '-q', '-b', 'pr'])
    put(clone, 'c.txt', 'c\n'); commit(clone, 'C')
    const o = io()
    await runCli(['run', '--slot', 'correctness', '--author', 'anthropic'], { cwd: clone, promptFor, env: {}, io: o.io, spawnImpl: recordSpawn([], envelopeOk) })
    const rec = readRecords({ cwd: clone })[0]
    ok('with origin/main present the base defaults to origin/main', rec && rec.input.mergeBase === originTip)
    const o2 = io()
    await runCli(['run', '--slot', 'correctness', '--author', 'anthropic', '--base', 'main'], { cwd: clone, promptFor, env: {}, io: o2.io, spawnImpl: recordSpawn([], envelopeOk) })
    const rec2 = readRecords({ cwd: clone }).find((x) => x.input.mergeBase !== originTip)
    ok('--base main overrides it', rec2 && rec2.input.mergeBase === raw(clone, ['rev-parse', 'main']))
  }

  // --- dispose ---
  const disposeErr = await errOfCli(['dispose', '--record', completedRootWithOpen.stem, '--finding', 'F1', '--kind', 'fixed', '--reason', 'done'])
  ok('dispose cannot set fixed', /only a re-review/.test(disposeErr))
  {
    const target = store(prRecord({ input: pr1, verdict: 'fail', findings: [{ id: 'F9', severity: 'P1', summary: 'to dispose' }] }))
    const path = join(repo, '.review', 'records', `${target.stem}.json`)
    const before = readFileSync(path, 'utf8')
    ok('dispose pre-existing without --issue is refused', /--issue/.test(await errOfCli(['dispose', '--record', target.stem, '--finding', 'F9', '--kind', 'pre-existing', '--reason', 'old'])))
    ok('dispose without --reason is refused', /--reason/.test(await errOfCli(['dispose', '--record', target.stem, '--finding', 'F9', '--kind', 'reclassified-nit'])))
    ok('dispose justified-deviation on a non-conformance record is refused', /conformance/.test(await errOfCli(['dispose', '--record', target.stem, '--finding', 'F9', '--kind', 'justified-deviation', '--reason', 'r'])))
    ok('dispose of an unknown finding is refused', /F404/.test(await errOfCli(['dispose', '--record', target.stem, '--finding', 'F404', '--kind', 'reclassified-nit', '--reason', 'r'])))
    const r = await cli(['dispose', '--record', target.stem, '--finding', 'F9', '--kind', 'pre-existing', '--reason', 'on main already', '--issue', 'https://example.test/issues/1'])
    const next = recordsBy((x) => x.supersedes === target.stem)[0]
    ok('dispose writes a new record superseding the old one', r.code === 0 && next && next.outcome === target.outcome && next.reviewer.vendor === target.reviewer.vendor && next.input.identity === target.input.identity)
    ok('the new record carries the disposition', next.findings[0].disposition.kind === 'pre-existing' && next.findings[0].disposition.issue === 'https://example.test/issues/1' && next.findings[0].disposition.reason === 'on main already')
    ok('the old record is left byte-for-byte unchanged', readFileSync(path, 'utf8') === before)
    ok('dispose of a superseded record is refused', /already superseded/.test(await errOfCli(['dispose', '--record', target.stem, '--finding', 'F9', '--kind', 'reclassified-nit', '--reason', 'r'])))
  }
  ok('an unknown subcommand is a usage error', (await cli(['frobnicate'])).code === 1)

  // default slot prompt: substitute:<bot> shares substitute.md with {{bot}} filled in
  {
    const slots = join(root, 'promptroot', '.claude', 'review', 'slots')
    mkdirSync(slots, { recursive: true })
    writeFileSync(join(slots, 'substitute.md'), 'Standing in for {{bot}}; again {{bot}}.\n')
    writeFileSync(join(slots, 'correctness.md'), 'CORRECTNESS {{bot}}\n')
    const pr = join(root, 'promptroot')
    ok('substitute:codex reads substitute.md with {{bot}} -> codex', defaultPromptFor('substitute:codex', { root: pr }) === 'Standing in for codex; again codex.\n')
    ok('substitute:coderabbit and substitute:gemini fill their own bot', /for coderabbit; again coderabbit/.test(defaultPromptFor('substitute:coderabbit', { root: pr })) && /for gemini; again gemini/.test(defaultPromptFor('substitute:gemini', { root: pr })))
    ok('a non-substitute slot reads its own file and is not substituted', defaultPromptFor('correctness', { root: pr }) === 'CORRECTNESS {{bot}}\n')
    ok('a missing slot file is an error naming the path', (() => { try { defaultPromptFor('spec', { root: pr }); return false } catch (e) { return /spec\.md/.test(e.message) } })())
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`${counter.pass} passed, ${counter.fail} failed`)
process.exit(counter.fail ? 1 : 0)
