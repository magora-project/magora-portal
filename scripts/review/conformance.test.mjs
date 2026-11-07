// Self-test for scripts/review/conformance.mjs (plan Task 18) and `review.mjs conformance`. Builds scratch git repos
// in mkdtemp and deletes them afterwards. Never spawns a real reviewer or a real command: the reviewer spawn
// (spawnImpl) and the postcondition command spawn (commandSpawnImpl) are both stubbed.
// Run: node scripts/review/conformance.test.mjs
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'

const root = mkdtempSync(join(tmpdir(), 'conformance-test-'))
const emptyConfig = join(root, 'empty.gitconfig')
writeFileSync(emptyConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const { inputIdentity, mergeBase } = await import('./identity.mjs')
const { dispositionOk, readRecords, writeRecord } = await import('./records.mjs')
const { parseBody } = await import('./pr-body.mjs')
const { evaluate } = await import('../ci/review-evidence.mjs')
const { reviewCli } = await import('./review.mjs')
const { commandArgv, declaredTasks, deviationIds, postconditions, splitCommand } = await import('./conformance.mjs')

let pass = 0, fail = 0
// A thenable condition is a failure: a Promise is truthy even when it resolves to false.
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

// --- fake children ---
// A reviewer child: reads the prompt on stdin, answers with a Claude envelope, or (codex) into its -o file.
const fakeReviewer = (respond) => {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
  const chunks = []
  child.kill = () => true
  child.stdin.on('data', (d) => chunks.push(Buffer.from(d)))
  child.stdin.on('finish', () => {
    const r = respond(Buffer.concat(chunks).toString('utf8'))
    child.stdout.end(r.stdout ?? ''); child.stderr.end('')
    setImmediate(() => setImmediate(() => child.emit('close', 0, null)))
  })
  return child
}
const envelope = (inner) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: inner })
// verdictFor(prompt, inheritedIds) -> the verdict object the reviewer returns.
const reviewerSpawn = (calls, verdictFor) => (cmd, args) => fakeReviewer((prompt) => {
  calls.push({ cmd, args, prompt })
  const inner = JSON.stringify(verdictFor(prompt, inheritedIn(prompt)))
  if (/codex/.test(cmd)) {
    const i = args.indexOf('-o')
    if (i >= 0) writeFileSync(args[i + 1], inner)
    return { stdout: '' }
  }
  return { stdout: envelope(inner) }
})
const inheritedIn = (prompt) => {
  const m = /### Inherited findings\n\n(`{3,})json\n([\s\S]*?)\n\1/.exec(prompt)
  return m ? JSON.parse(m[2]).map((f) => f.id) : []
}
// A postcondition command child: closes with `exit`.
const commandSpawn = (log, exit = 1) => (cmd, args, opts) => {
  log.push({ cmd, args, opts })
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  setImmediate(() => { child.stdout.end('command output\n'); child.stderr.end(''); setImmediate(() => child.emit('close', exit, null)) })
  return child
}

// --- scratch repos ---
let seq = 0
const raw = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (cwd, file, text) => { mkdirSync(dirname(join(cwd, file)), { recursive: true }); writeFileSync(join(cwd, file), text) }
const commit = (cwd, msg) => {
  raw(cwd, ['add', '-A'])
  raw(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg])
}

const PLAN = 'docs/plan.md'
const fixtureDiffMarker = 'FIXTURE_DIFF_MARKER_7f3a'
const planText = [
  '# Plan', '',
  '### Task 1: One', '',
  '**Files:**',
  '- create: `new.mjs`',
  '- create: `made.mjs`',
  '- modify: `untouched.mjs`',
  '- modify: `edited.mjs` (trailing text after the value is allowed)',
  '- command: `npm test`', '',
  'Task one body.', '',
  '### Task 2: Two', '',
  '**Files:**',
  '- existing: `base.txt`',
  '- delete: `old.mjs`',
  '- command: `npm test`', '',
  '### Task 3: Three', '',
  '**Files:**',
  '- create: `t3.mjs`', '',
  'Task three body.', '',
  '### Task 4 (operator): Clock', '',
  'Ask the operator to capture the current UTC time (ISO 8601) and paste it into the PR.', '',
].join('\n')

// main: base.txt, untouched.mjs, edited.mjs, old.mjs. Branch pr: the plan, made.mjs, an edit to edited.mjs.
const mkrepo = () => {
  const dir = join(root, `r${++seq}`)
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { shell: false })
  put(dir, 'base.txt', 'base\n')
  put(dir, 'untouched.mjs', 'export const u = 1\n')
  put(dir, 'edited.mjs', 'export const e = 1\n')
  put(dir, 'old.mjs', 'export const o = 1\n')
  commit(dir, 'base')
  raw(dir, ['checkout', '-q', '-b', 'pr'])
  put(dir, PLAN, planText)
  put(dir, 'made.mjs', 'export const m = 1\n')
  put(dir, 'edited.mjs', `export const e = 2 // ${fixtureDiffMarker}\n`)
  commit(dir, 'pr change')
  return dir
}

const io = () => {
  const o = { out: '', err: '' }
  o.io = { out: (s) => { o.out += s }, err: (s) => { o.err += s } }
  return o
}
const promptFor = (slot) => `SLOT PROMPT FOR ${slot}\n`
// One `review.mjs conformance` (or dispose) run. Returns exit code, output, every spawn, the reviewer calls.
const cli = async (cwd, argv, { verdictFor = () => ({ verdict: 'pass', findings: [], inherited: [] }), exit = 1 } = {}) => {
  const o = io(), reviewerCalls = [], commandSpawns = []
  const code = await reviewCli(argv, { cwd, promptFor, env: {}, io: o.io, spawnImpl: reviewerSpawn(reviewerCalls, verdictFor), commandSpawnImpl: commandSpawn(commandSpawns, exit) })
  return { code, out: o.out, err: o.err, reviewerCalls, commandSpawns, spawns: [...reviewerCalls, ...commandSpawns] }
}
const conformance = (tasks, extra = []) => ['conformance', '--plan', PLAN, '--tasks', tasks, '--author', 'anthropic', ...extra]
const heads = (cwd) => { const rs = readRecords({ cwd }); const sup = new Set(rs.map((r) => r.supersedes)); return rs.filter((r) => !sup.has(r.stem)) }
const reviewerFinding = { verdict: 'fail', findings: [{ id: 'F1', severity: 'P2', summary: 'reviewer deviation' }], inherited: [] }
const allInherited = (status, extra = {}) => (prompt, ids) => ({ verdict: status === 'open' ? 'fail' : 'pass', findings: [], inherited: ids.map((id) => ({ id, status, note: '' })), ...extra })

try {
  // --- the command splitter and the Windows npm/npx mapping (Step 3) ---
  {
    const win = { platform: 'win32', execPath: 'C:\\node\\node.exe' }
    const npm = commandArgv('npm run check:migrations', win)
    const npx = commandArgv('npx eslint "a b.js"', win)
    ok('Windows: npm runs as node <dir>/node_modules/npm/bin/npm-cli.js with argv unchanged', npm.file === win.execPath && /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/.test(npm.args[0]) && npm.args[0].startsWith('C:\\node') && JSON.stringify(npm.args.slice(1)) === '["run","check:migrations"]')
    ok('Windows: npx runs npx-cli.js and keeps a quoted argument whole', npx.file === win.execPath && /npx-cli\.js$/.test(npx.args[0]) && JSON.stringify(npx.args.slice(1)) === '["eslint","a b.js"]')
    const mac = commandArgv('npm run check:migrations', { platform: 'darwin', execPath: '/usr/bin/node' })
    ok('macOS: npm is spawned as npm with the same argv', mac.file === 'npm' && JSON.stringify(mac.args) === '["run","check:migrations"]')
    ok('single quotes and empty quotes split as a shell would', JSON.stringify(splitCommand(`node -e 'a b' "" x\\y`)) === '["node","-e","a b","","x\\\\y"]')
    ok('an escaped double quote inside double quotes', JSON.stringify(splitCommand('echo "say \\"hi\\""')) === '["echo","say \\"hi\\""]')
    ok('an unterminated quote is refused', (() => { try { splitCommand('echo "x'); return false } catch (e) { return /quote/.test(e.message) } })())
    ok('an unquoted shell operator is refused (no shell runs it)', ['npm test && npm run lint', 'a | b', 'a > f', 'a; b'].every((c) => { try { splitCommand(c); return false } catch (e) { return /shell/.test(e.message) } }))
    ok('a quoted operator is an ordinary argument', JSON.stringify(splitCommand('grep "a|b" f')) === '["grep","a|b","f"]')
  }

  // --- deviationIds: the IDs of the findings without a fixed disposition ---
  ok('deviation IDs in the record are the unfixed findings only', deviationIds([{ id: 'D1', severity: 'P1', summary: 's', disposition: { kind: 'fixed', by: 'x' } }, { id: 'D2', severity: 'P1', summary: 's', disposition: { kind: 'justified-deviation', reason: 'r' } }, { id: 'D3', severity: 'P3', summary: 's', disposition: { kind: 'fixed', by: 'y' } }]).join() === 'D2')

  // --- postconditions, called directly ---
  {
    const repo = mkrepo()
    const head = raw(repo, ['rev-parse', 'HEAD'])
    const mb = await mergeBase({ cwd: repo, base: 'main', head })
    const spawns = []
    const pc = await postconditions({ tasks: declaredTasks(planText, ['T1', 'T2']), cwd: repo, base: mb, head, spawnImpl: commandSpawn(spawns, 1) })
    const spawnOpts = spawns[0]?.opts ?? {}
    ok('a create target absent at head -> failed postcondition', pc.find((p) => p.target.value === 'new.mjs').ok === false)
    ok('a create target present and in the diff -> ok', pc.find((p) => p.target.value === 'made.mjs').ok === true)
    ok('a modify target unchanged in the PR diff -> failed', pc.find((p) => p.target.value === 'untouched.mjs').ok === false)
    ok('a modify target with trailing text, changed in the diff -> ok', pc.find((p) => p.target.value === 'edited.mjs').ok === true)
    ok('a delete target still present -> failed', pc.find((p) => p.target.type === 'delete').ok === false)
    ok('an existing target is not a postcondition', pc.some((p) => p.target.type === 'existing') === false)
    ok('a command is spawned without a shell on every platform', spawnOpts.shell === false)
    ok('a command runs in the repository root', spawnOpts.cwd === repo)
    ok('only the declared tasks are checked, and both were', pc.some((p) => p.task === 'T1') && pc.some((p) => p.task === 'T2') && pc.every((p) => ['T1', 'T2'].includes(p.task)))
    ok('an identical command string runs once and is recorded against each task', spawns.length === 1 && pc.filter((p) => p.target.type === 'command').map((p) => `${p.task}:${p.exit}:${p.ok}`).join() === 'T1:1:false,T2:1:false')
    const okRun = []
    const pc0 = await postconditions({ tasks: declaredTasks(planText, ['T1']), cwd: repo, base: mb, head, spawnImpl: commandSpawn(okRun, 0) })
    ok('a command that exits 0 is a passing postcondition', pc0.find((p) => p.target.type === 'command').ok === true && pc0.find((p) => p.target.type === 'command').exit === 0)
    const bad = await postconditions({ tasks: [{ id: 'T9', targets: [{ type: 'command', value: 'npm test | tee x', line: 1 }] }], cwd: repo, base: mb, head, spawnImpl: commandSpawn([], 0) })
    ok('a command that needs a shell is not run and fails with exit -1', bad[0].ok === false && bad[0].exit === -1 && /shell/.test(bad[0].detail))
    const missing = await postconditions({ tasks: [{ id: 'T9', targets: [{ type: 'command', value: 'no-such-tool-xyz', line: 1 }] }], cwd: repo, base: mb, head, spawnImpl: () => { throw Object.assign(new Error('spawn no-such-tool-xyz ENOENT'), { code: 'ENOENT' }) } })
    ok('a command that cannot start fails with exit -1 and says why', missing[0].ok === false && missing[0].exit === -1 && /ENOENT/.test(missing[0].detail))
  }

  // --- the CLI: T1-T2, five failed postconditions and one reviewer finding ---
  {
    const repo = mkrepo()
    const r = await cli(repo, conformance('T1-T2'), { verdictFor: () => reviewerFinding })
    const rec = readRecords({ cwd: repo })[0]
    ok('a completed conformance run exits 0 and writes one record', r.code === 0 && readRecords({ cwd: repo }).length === 1)
    ok('the record is a conformance record on the PR input', rec && rec.type === 'conformance' && rec.slot === 'conformance' && rec.input.kind === 'pr' && rec.input.identity === await inputIdentity({ cwd: repo, base: 'main', head: 'HEAD' }))
    ok('a command target that exits 1 is recorded with exit 1', rec.conformance.commands[0].exit === 1)
    ok('the identical command is run once and recorded once', r.commandSpawns.length === 1 && JSON.stringify(rec.conformance.commands) === '[{"cmd":"npm test","exit":1}]')
    ok('conformance.tasks is the declared tasks', rec.conformance.tasks.join() === 'T1,T2')
    ok('failed postconditions are P1 deviations D1..D5, numbered before the reviewer finding, which becomes D6', rec.findings.map((f) => `${f.id}:${f.severity}`).join() === 'D1:P1,D2:P1,D3:P1,D4:P1,D5:P1,D6:P2' && rec.findings[5].summary === 'reviewer deviation')
    ok('a postcondition deviation names its task and target, at the plan line', /T1/.test(rec.findings[0].summary) && /new\.mjs/.test(rec.findings[0].summary) && rec.findings[0].file === PLAN && Number.isInteger(rec.findings[0].line))
    ok('no undeclared task is checked', rec.findings.every((f) => !/T3|t3\.mjs/.test(f.summary)))
    ok('every unfixed finding is a deviation', rec.conformance.deviations.join() === 'D1,D2,D3,D4,D5,D6')
    const prompt = r.reviewerCalls[0]?.prompt ?? ''
    ok('one reviewer call, the conformance slot prompt with the declared tasks and the PR diff', r.reviewerCalls.length === 1 && prompt.includes('SLOT PROMPT FOR conformance') && prompt.includes('Task one body.') && prompt.includes(fixtureDiffMarker) && prompt.includes(`### Plan ${PLAN}, T1`) && prompt.includes(`### Plan ${PLAN}, T2`) && prompt.includes(`### Plan ${PLAN}, T3`) === false)
    ok('the prompt carries the postcondition results', /new\.mjs/.test(prompt) && /npm test/.test(prompt))
  }

  // --- an operator task with no targets ---
  {
    const repo = mkrepo()
    const r = await cli(repo, conformance('T4'))
    const zeroTargetSpawns = r.commandSpawns
    const zeroTargetReviewerCalls = r.reviewerCalls
    const zeroTargetRec = readRecords({ cwd: repo })[0]
    ok('conformance on an operator task with no targets: zero postcondition runs, and the one reviewer call carries the task body and the PR diff', zeroTargetSpawns.length === 0 && zeroTargetRec.conformance.commands.length === 0 && zeroTargetReviewerCalls.length === 1 && zeroTargetReviewerCalls[0].prompt.includes('capture the current UTC time (ISO 8601)') && zeroTargetReviewerCalls[0].prompt.includes(fixtureDiffMarker))
    ok('...and a passing review with nothing to deviate leaves no deviation', r.code === 0 && zeroTargetRec.findings.length === 0 && zeroTargetRec.conformance.deviations.length === 0)
  }

  // --- refusals before anything runs or is written ---
  {
    const repo = mkrepo()
    const unknownTaskRun = { ...(await cli(repo, conformance('T1,T99'))), records: readRecords({ cwd: repo }) }
    ok('conformance with an unknown task ID writes no record and spawns nothing', unknownTaskRun.records.length === 0 && unknownTaskRun.spawns.length === 0 && /T99/.test(unknownTaskRun.err))
    const noTasks = await cli(repo, ['conformance', '--plan', PLAN, '--author', 'anthropic'])
    ok('conformance without --tasks is refused', noTasks.code === 1 && noTasks.spawns.length === 0 && /--tasks/.test(noTasks.err))
    const none = await cli(repo, conformance('none'))
    ok('conformance with --tasks none is refused', none.code === 1 && none.spawns.length === 0 && /task/.test(none.err))
    const noPlan = await cli(repo, ['conformance', '--plan', 'docs/missing.md', '--tasks', 'T1', '--author', 'anthropic'])
    ok('a plan not committed at HEAD is refused', noPlan.code === 1 && noPlan.spawns.length === 0 && /missing\.md/.test(noPlan.err))
    const badAuthor = await cli(repo, ['conformance', '--plan', PLAN, '--tasks', 'T1', '--author', 'nobody'])
    ok('an unknown --author is refused', badAuthor.code === 1 && badAuthor.spawns.length === 0)
    const indep = await cli(repo, conformance('T4', ['--reviewer', 'claude']))
    ok('a reviewer of the author vendor is refused before any postcondition runs', indep.code === 1 && indep.spawns.length === 0 && /independence/.test(indep.err))
    put(repo, 'edited.mjs', 'uncommitted\n')
    const dirty = await cli(repo, conformance('T1'))
    ok('uncommitted changes to tracked files refuse a run with command targets', dirty.code === 1 && dirty.spawns.length === 0 && /commit/.test(dirty.err))
    ok('...and nothing was written by any refusal', readRecords({ cwd: repo }).length === 0)
  }

  // --- a re-run with --supersedes: postcondition deviations are recomputed, the reviewer's are inherited ---
  {
    const repo = mkrepo()
    await cli(repo, conformance('T3'), { verdictFor: () => reviewerFinding })
    const first = readRecords({ cwd: repo })[0]
    ok('T3: the missing create is D1 and the reviewer finding D2', first.findings.map((f) => f.id).join() === 'D1,D2')
    const fresh = await cli(repo, conformance('T3'))
    ok('a fresh run is refused while the chain head has open deviations', fresh.code === 1 && fresh.spawns.length === 0 && /--supersedes/.test(fresh.err))
    const again = await cli(repo, conformance('T3', ['--supersedes', first.stem]), { verdictFor: allInherited('open') })
    const chained = readRecords({ cwd: repo }).find((x) => x.supersedes === first.stem)
    ok('a re-run with --supersedes chains and inherits D2 if undisposed', chained.findings.some((f) => f.id.endsWith('#D2')))
    ok('the reviewer was asked to reassess D2 only: the postcondition D1 is recomputed, not inherited', inheritedIn(again.reviewerCalls[0].prompt).join() === `${first.stem}#D2` && chained.findings.map((f) => f.id).join() === `D1,${first.stem}#D2`)
    ok('the chained record lists both unfixed deviations', chained.conformance.deviations.join() === `D1,${first.stem}#D2`)
  }

  // --- PR #77 Gemini P1: a justified deviation the author then fixes and drops from the Deviations field ---
  {
    const repo = mkrepo()
    await cli(repo, conformance('T3'), { verdictFor: () => ({ verdict: 'fail', findings: [{ id: 'F1', severity: 'P1', summary: 'the plan said X; the diff does Y' }], inherited: [] }) })
    const first = readRecords({ cwd: repo })[0]
    const disp = await cli(repo, ['dispose', '--record', first.stem, '--finding', 'D2', '--kind', 'justified-deviation', '--reason', 'see Deviations'])
    const justified = readRecords({ cwd: repo }).find((x) => x.supersedes === first.stem)
    ok('D2 is disposed justified-deviation', disp.code === 0 && justified.findings.find((f) => f.id === 'D2').disposition.kind === 'justified-deviation')
    // the author fixes both: creates t3.mjs and changes the code D2 was about
    put(repo, 't3.mjs', 'export const t3 = 1\n')
    commit(repo, 'fix the deviations')
    const rerun = await cli(repo, conformance('T3', ['--supersedes', justified.stem]), { verdictFor: allInherited('resolved') })
    const head = heads(repo)[0]
    ok('the re-review sends the justified D2 to the reviewer for reassessment', rerun.code === 0 && inheritedIn(rerun.reviewerCalls[0].prompt).join() === `${justified.stem}#D2`)
    ok('the reviewer marks it fixed by the new record', head.supersedes === justified.stem && head.findings.length === 1 && head.findings[0].id === `${justified.stem}#D2` && head.findings[0].disposition.kind === 'fixed' && head.findings[0].disposition.by === head.stem)
    ok('the new chain head lists no deviation', head.conformance.deviations.length === 0)
    const identity = await inputIdentity({ cwd: repo, base: 'main', head: 'HEAD' })
    const body = parseBody(`Lane: specced\nSpec: docs/spec.md\nPlan: ${PLAN} T3\nDeviations: none`)
    const verdict = evaluate({ records: readRecords({ cwd: repo }), required: [{ slot: 'conformance', input: { kind: 'pr' } }], identity, body })
    ok('the new chain head passes review-evidence with a PR body whose Deviations no longer lists D2', verdict.ok === true && verdict.lines.some((l) => l.startsWith('ok conformance')))
  }

  // --- a justified deviation still present comes back undisposed for the author to re-dispose ---
  {
    const repo = mkrepo()
    await cli(repo, conformance('T4'), { verdictFor: () => reviewerFinding })
    const first = readRecords({ cwd: repo })[0]
    await cli(repo, ['dispose', '--record', first.stem, '--finding', 'D1', '--kind', 'justified-deviation', '--reason', 'see Deviations'])
    const justified = readRecords({ cwd: repo }).find((x) => x.supersedes === first.stem)
    await cli(repo, conformance('T4', ['--supersedes', justified.stem]), { verdictFor: allInherited('open') })
    const head = heads(repo)[0]
    ok('a justified deviation the reviewer still sees comes back with no disposition', head.findings.map((f) => `${f.id}:${f.disposition === undefined}`).join() === `${justified.stem}#D1:true` && head.conformance.deviations.join() === `${justified.stem}#D1`)
  }
  // --- I1: a P3 deviation, and a legacy reclassified-nit one, are reassessed by the re-review, not dropped ---
  {
    const repo = mkrepo()
    await cli(repo, conformance('T4'), { verdictFor: () => ({ verdict: 'fail', findings: [{ id: 'F1', severity: 'P3', summary: 'a nit deviation' }, { id: 'F2', severity: 'P1', summary: 'a real one' }], inherited: [] }) })
    const first = readRecords({ cwd: repo })[0]
    ok('I1: the first run has a P3 D1 and a P1 D2, both deviations', first.findings.map((f) => `${f.id}:${f.severity}`).join() === 'D1:P3,D2:P1' && first.conformance.deviations.join() === 'D1,D2')
    // a legacy record (written before dispose refused it) reclassified D2 as a nit
    const { stem: _s, ...body } = first // eslint-disable-line no-unused-vars
    const legacyPath = writeRecord({ cwd: repo, record: { ...body, findings: first.findings.map((f) => (f.id === 'D2' ? { ...f, disposition: { kind: 'reclassified-nit', reason: 'small' } } : f)), supersedes: first.stem, createdAt: '2026-11-06T12:00:00.000Z' } })
    const legacy = readRecords({ cwd: repo }).find((x) => legacyPath.endsWith(`${x.stem}.json`))
    const fresh = await cli(repo, conformance('T4'))
    ok('I1: a fresh run is refused while the conformance head still has a deviation, even a P3 or reclassified one', fresh.code === 1 && fresh.spawns.length === 0 && fresh.err.includes(legacy.stem) && /--supersedes/.test(fresh.err))
    const again = await cli(repo, conformance('T4', ['--supersedes', legacy.stem]), { verdictFor: allInherited('resolved') })
    ok('I1: the re-review sends the P3 and the reclassified deviation to the reviewer (toAssess)', again.code === 0 && inheritedIn(again.reviewerCalls[0].prompt).join() === `${legacy.stem}#D1,${legacy.stem}#D2`)
    const head = heads(repo)[0]
    ok('I1: both are marked fixed by the re-review and the head lists no deviation', head.findings.length === 2 && head.findings.every((f) => f.disposition?.kind === 'fixed' && f.disposition.by === head.stem) && head.conformance.deviations.length === 0)
  }

  // --- M5: an untyped Files line in a declared task is a P1 deviation ---
  {
    const repo = mkrepo()
    put(repo, 'docs/plan2.md', ['# Plan', '', '### Task 1: Untyped', '', '**Files:**', '- `made.mjs`', '', 'Body.', ''].join('\n'))
    commit(repo, 'plan2')
    await cli(repo, ['conformance', '--plan', 'docs/plan2.md', '--tasks', 'T1', '--author', 'anthropic'])
    const rec = readRecords({ cwd: repo })[0]
    ok('M5: an untyped Files line in a declared task becomes a P1 deviation D1 from the evidence writer', rec && rec.findings.length === 1 && rec.findings[0].id === 'D1' && rec.findings[0].severity === 'P1' && rec.findings[0].source === 'postcondition' && /untyped/.test(rec.findings[0].summary) && rec.findings[0].file === 'docs/plan2.md' && rec.conformance.deviations.join() === 'D1')
  }

  // --- a deviation still open after a re-review is justified under its chained ID, verbatim ---
  {
    const repo = mkrepo()
    await cli(repo, conformance('T4'), { verdictFor: () => ({ verdict: 'fail', findings: [{ id: 'F1', severity: 'P2', summary: 'one' }, { id: 'F2', severity: 'P1', summary: 'two' }], inherited: [] }) })
    const first = readRecords({ cwd: repo })[0]
    ok('chained: the first run has D1 and D2', first.findings.map((f) => f.id).join() === 'D1,D2')
    // the author fixes D1; the re-review resolves D1 and leaves D2 open
    put(repo, 'edited.mjs', 'export const e = 3\n')
    commit(repo, 'fix D1')
    await cli(repo, conformance('T4', ['--supersedes', first.stem]), { verdictFor: (prompt, ids) => ({ verdict: 'fail', findings: [], inherited: ids.map((id) => ({ id, status: id.endsWith('#D1') ? 'resolved' : 'open', note: '' })) }) })
    const second = heads(repo)[0]
    const chainedId = `${first.stem}#D2`
    ok('chained: D2 is left open as <stem>#D2 and is the only deviation', second.conformance.deviations.join() === chainedId && second.findings.find((f) => f.id === chainedId)?.disposition === undefined)
    const disp = await cli(repo, ['dispose', '--record', second.stem, '--finding', chainedId, '--kind', 'justified-deviation', '--reason', 'see Deviations'])
    const head = heads(repo)[0]
    const body = parseBody(`Lane: specced\nSpec: docs/spec.md\nPlan: ${PLAN} T4\nDeviations:\n- ${chainedId}: the plan's version is not needed; the built one is simpler`)
    ok('chained: the PR body parses the chained ID verbatim', body.problems.length === 0 && body.deviations.map((d) => d.id).join() === chainedId)
    ok('chained: the disposed head lists the same deviation ID set as the body', disp.code === 0 && head.supersedes === second.stem && head.conformance.deviations.join() === chainedId)
    ok('chained: dispositionOk accepts the justified chained finding', dispositionOk(head.findings.find((f) => f.id === chainedId), { deviations: body.deviations, recordType: head.type }) === true)
    const identity = await inputIdentity({ cwd: repo, base: 'main', head: 'HEAD' })
    const verdict = evaluate({ records: readRecords({ cwd: repo }), required: [{ slot: 'conformance', input: { kind: 'pr' } }], identity, body })
    ok('chained: the chain head passes review-evidence with the chained ID in Deviations', verdict.ok === true && verdict.lines.some((l) => l.startsWith('ok conformance')))
    const without = evaluate({ records: readRecords({ cwd: repo }), required: [{ slot: 'conformance', input: { kind: 'pr' } }], identity, body: parseBody(`Lane: specced\nSpec: docs/spec.md\nPlan: ${PLAN} T4\nDeviations: none`) })
    ok('chained: the same head fails when the body does not list the chained ID', without.ok === false)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
