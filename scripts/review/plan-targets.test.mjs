// Self-test for scripts/review/plan-targets.mjs. This plan's own Files blocks are the reference fixture. The file
// sets below are synthetic, derived from the plan's own targets or literal lists, never from git history (CI checks
// out at depth 1). The git helpers run against scratch repos in mkdtemp, deleted afterwards.
// Run: node scripts/review/plan-targets.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'plan-targets-test-'))
const emptyConfig = join(root, 'empty.gitconfig')
writeFileSync(emptyConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const { checkExisting, filesAtRev, gitFacts, parsePlan, resolveRev, resolveTasks } = await import('./plan-targets.mjs')

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const setOf = (paths) => { const s = new Set(paths); return (p) => s.has(p) }

const thisPlan = readFileSync(new URL('../../docs/superpowers/plans/2026-10-30-shared-dev-process.md', import.meta.url), 'utf8')
const parsedThis = parsePlan(thisPlan)
const num = (t) => Number(t.id.slice(1))
const targetValues = (from, to, types) => parsedThis.tasks.filter((t) => num(t) >= from && num(t) <= to)
  .flatMap((t) => t.targets.filter((x) => types.includes(x.type) && !x.value.startsWith('~/')).map((x) => x.value))
const minus = (a, b) => a.filter((x) => !b.includes(x))
const ALL = 1000

// Phase 1 is Tasks 1-9. Before it, the files its tasks modify or read exist and the ones they create do not.
const phase1Creates = targetValues(1, 9, ['create'])
const filesBeforePhase1 = minus(targetValues(1, 9, ['modify', 'existing']), phase1Creates)
const laterTasks = parsedThis.tasks.filter((t) => num(t) >= 10).map((t) => t.id)
const laterNeeds = minus(targetValues(10, ALL, ['modify', 'existing']), targetValues(10, ALL, ['create']))
const filesAfterPhase1 = [...filesBeforePhase1, ...phase1Creates, ...laterNeeds]
// PR C is Tasks 17-25. At its merge base the files of Tasks 1-16 exist; at HEAD after Task 18, Tasks 17 and 18 have landed too.
const phase3to5Tasks = parsedThis.tasks.filter((t) => num(t) >= 17).map((t) => t.id)
const laterCreates = targetValues(17, ALL, ['create'])
const filesAtMergeBaseBeforePhase3 = [...targetValues(1, 16, ['create']), ...minus(targetValues(17, ALL, ['modify', 'existing']), laterCreates)]
const filesAtHeadAfterT18 = [...filesAtMergeBaseBeforePhase3, ...targetValues(17, 18, ['create'])]

const hdr = (n, t = 'X') => `### Task ${n}: ${t}\n\n**Files:**\n`
const planWithMissing = `${hdr(1)}- existing: \`a.mjs\`\n- existing: \`missing.mjs\`\n- command: \`npm test\`\n`
const planCreatingExisting = `${hdr(1)}- create: \`x.mjs\`\n- command: \`npm test\`\n`
const planWithHomeTarget = `${hdr(1)}- existing: \`~/code/x/y.sh\` (read, not copied)\n- create: \`z.mjs\`\n`
const dupPlan = `${hdr(2)}- create: \`a\`\n\n${hdr(2, 'Again')}- create: \`b\`\n`
const p = `${hdr(1)}- command: \`npm run check:migrations\`\n`

try {
  // --- parsePlan ---
  ok('parses this plan: Task 10 has an existing-free target list ending in a command', parsedThis.tasks.find((t) => t.id === 'T10').targets.at(-1).type === 'command')
  ok('this plan has no problems of its own, trailing text after the closing backtick included (T2, T20)', parsedThis.problems.length === 0)
  ok('the trailing text is not part of the value (T2)', parsedThis.tasks.find((t) => t.id === 'T2').targets[0].value === '~/code/claude-config/hooks/spec_plan_threshold.sh')
  ok('this plan parses T1 to T25, once each', parsedThis.tasks.length === 25 && new Set(parsedThis.tasks.map((t) => t.id)).size === 25)
  ok('an untyped "- Create: x" line is a problem with its line number', /line \d+/.test(parsePlan('### Task 1: X\n\n**Files:**\n- Create: `x`\n').problems.join()))
  // push-gate P2: a ./ or backslash spelling of a path is the same file as git's spelling
  {
    const has = setOf(['package.json', 'src/a.mjs'])
    ok('modify ./package.json of an existing file is not reported', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- modify: `./package.json`\n', exists: has }).problems.length === 0)
    ok('create ./package.json of an existing file is reported', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- create: `./package.json`\n', exists: has }).problems.some((p) => /already exists/.test(p)))
    ok('a backslash path names the same file', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- modify: `src\\a.mjs`\n', exists: has }).problems.length === 0)
    ok('create x.mjs then create ./x.mjs is a duplicate create', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- create: `x.mjs`\n\n### Task 2: Y\n\n**Files:**\n- create: `./x.mjs`\n', exists: has }).problems.some((p) => /already created by T1/.test(p)))
    ok('delete a.mjs then modify ./src/a.mjs is reported', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- delete: `src/a.mjs`\n\n### Task 2: Y\n\n**Files:**\n- modify: `./src/a.mjs`\n', exists: has }).problems.some((p) => /T2.*not a file/.test(p)))
  }
  // conformance D1: a list item that is not a "- " bullet is an untyped line, not the end of the Files block
  {
    const star = parsePlan('### Task 1: X\n\n**Files:**\n- create: `a.mjs`\n* `missing.mjs`\n- create: `b.mjs`\n')
    ok('a "* " bullet in a Files block is an untyped-line problem naming it', star.problems.some((x) => /T1 line 5: untyped Files line .*missing\.mjs/.test(x)))
    ok('...and the block goes on: the target after it is still read', star.tasks[0].targets.map((t) => t.value).join() === 'a.mjs,b.mjs')
    ok('a numbered bullet in a Files block is an untyped-line problem', parsePlan('### Task 1: X\n\n**Files:**\n1. `x.mjs`\n').problems.some((x) => /untyped Files line .*x\.mjs/.test(x)))
    ok('an indented "- " bullet in a Files block is an untyped-line problem, not a continuation', parsePlan('### Task 1: X\n\n**Files:**\n- create:\n  - `x.mjs`\n').problems.some((x) => /line 5: untyped Files line .*x\.mjs/.test(x)))
    ok('a wrapped continuation line is still not a problem', parsePlan('### Task 1: X\n\n**Files:**\n- create: `x.mjs` (a long note\n  that wraps)\n').problems.length === 0)
    ok('a "**Files**:" heading is a problem, not a task with no targets', parsePlan('### Task 1: X\n\n**Files**:\n- create: `x.mjs`\n').problems.some((x) => /T1 line 3: Files heading/.test(x)))
  }
  ok('the untyped line number is the line of the bullet', /line 4:/.test(parsePlan('### Task 1: X\n\n**Files:**\n- Create: `x`\n').problems[0]))
  ok('a typed line without a backticked value is a problem', parsePlan('### Task 1: X\n\n**Files:**\n- create: x\n').problems.length === 1)
  ok('duplicate task IDs are a problem', /duplicate T2/.test(parsePlan(dupPlan).problems.join()))
  ok('a duplicate heading adds no tasks and none of its targets', (() => { const r = parsePlan(dupPlan); return r.tasks.length === 1 && r.tasks[0].targets.length === 1 && r.tasks[0].targets[0].value === 'a' })())
  ok('operator headings parse: T16 and T24 are found, with no targets and no problem', (() => { const r = parsedThis; return ['T16', 'T24'].every((id) => r.tasks.some((t) => t.id === id && t.targets.length === 0)) && !r.problems.some((q) => /T16|T24/.test(q)) })())
  ok('an operator task with a Files block still parses its targets', parsePlan('### Task 8 (operator): Y\n\n**Files:**\n- create: `a`\n').tasks[0].targets.length === 1)
  ok('a command target keeps its value verbatim, spaces included', parsePlan(p).tasks[0].targets[0].value === 'npm run check:migrations')
  ok('a task heading inside a fenced block is an example, not a task', parsePlan('### Task 1: X\n\n```md\n### Task 2: Y\n**Files:**\n- Create: `z`\n```\n').tasks.length === 1)
  ok('a malformed task heading is a problem', parsePlan('### Task 3 oops\n').problems.length === 1)
  ok('bullets after a blank line are not Files lines', parsePlan('### Task 1: X\n\n**Files:**\n- create: `a`\n\n**Interfaces:**\n- Produces: stuff\n').problems.length === 0)
  ok('CRLF line endings parse', parsePlan('### Task 1: X\r\n\r\n**Files:**\r\n- create: `a`\r\n').tasks[0].targets[0].value === 'a')

  // --- checkExisting ---
  ok('a missing existing target is reported', checkExisting({ plan: planWithMissing, exists: setOf(['a.mjs']) }).problems.some((q) => /missing\.mjs/.test(q)))
  ok('an existing target that is there is not', checkExisting({ plan: planWithMissing, exists: setOf(['a.mjs', 'missing.mjs']) }).problems.length === 0)
  ok('a create target that already exists is reported', checkExisting({ plan: planCreatingExisting, exists: setOf(['x.mjs']) }).problems.length === 1)
  ok('a create target that does not exist is fine', checkExisting({ plan: planCreatingExisting, exists: setOf([]) }).problems.length === 0)
  ok('two tasks creating one path: the second is reported', checkExisting({ plan: `${hdr(1)}- create: \`a\`\n\n${hdr(2)}- create: \`a\`\n`, exists: setOf([]) }).problems.length === 1)
  ok('modify of a path an earlier task deletes is reported', checkExisting({ plan: `${hdr(1)}- delete: \`a\`\n\n${hdr(2)}- modify: \`a\`\n`, exists: setOf(['a']) }).problems.length === 1)
  ok('delete then create of the same path is fine', checkExisting({ plan: `${hdr(1)}- delete: \`a\`\n\n${hdr(2)}- create: \`a\`\n- modify: \`a\`\n`, exists: setOf(['a']) }).problems.length === 0)
  ok('modify before the task that creates it is reported', checkExisting({ plan: `${hdr(1)}- modify: \`a\`\n\n${hdr(2)}- create: \`a\`\n`, exists: setOf([]) }).problems.length === 1)
  ok('an earlier task outside the scope creates nothing', checkExisting({ plan: `${hdr(1)}- create: \`a\`\n\n${hdr(2)}- modify: \`a\`\n`, exists: setOf([]), tasks: ['T2'] }).problems.length === 1)
  ok('an untyped line is a problem of checkExisting too', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- Create: `x`\n', exists: setOf([]) }).problems.length === 1)
  ok('an untyped line in a task out of scope is not', checkExisting({ plan: '### Task 1: X\n\n**Files:**\n- Create: `x`\n', exists: setOf([]), tasks: [] }).problems.length === 0)
  ok('modify of a file an earlier task creates is not reported (Task 3 modifies the settings.json Task 2 creates)', (() => { const r = checkExisting({ plan: thisPlan, exists: setOf(filesBeforePhase1), tasks: ['T2', 'T3'], ci: true }); return r.problems.length === 0 && r.considered.length > 0 })())
  ok('...but Task 3 alone, without Task 2 landed, reports it', checkExisting({ plan: thisPlan, exists: setOf(filesBeforePhase1), tasks: ['T3'], ci: true }).problems.some((q) => /\.claude\/settings\.json/.test(q)))
  ok('after Phase 1 lands, checking only T10+ reports nothing for Phase 1 files, and did consider targets', (() => { const r = checkExisting({ plan: thisPlan, exists: setOf(filesAfterPhase1), tasks: laterTasks, ci: true }); return r.considered.length > 0 && r.problems.every((q) => !/\.claude\/hooks/.test(q)) })())
  ok('the whole plan against its own synthetic start state has no problems', checkExisting({ plan: thisPlan, exists: setOf(minus(targetValues(1, ALL, ['modify', 'existing']), targetValues(1, ALL, ['create']))), ci: true }).problems.length === 0)
  ok('a ~/ existing target in CI is a note, not a problem', (() => { const r = checkExisting({ plan: planWithHomeTarget, exists: () => false, ci: true }); return r.problems.length === 0 && r.notes.some((n) => n.includes('~/')) })())
  ok('a ~/ existing target locally is checked on disk (absent: a problem)', checkExisting({ plan: planWithHomeTarget, exists: () => false, ci: false, homeExists: () => false }).problems.length === 1)
  ok('a ~/ existing target locally that is there is fine and not noted', (() => { const r = checkExisting({ plan: planWithHomeTarget, exists: () => false, ci: false, homeExists: (v) => v === '~/code/x/y.sh' }); return r.problems.length === 0 && r.notes.length === 0 })())
  ok('PR C bootstrap: T17-T25 checked at the merge base reports nothing, though T17 and T18 files exist at HEAD', checkExisting({ plan: thisPlan, exists: setOf(filesAtMergeBaseBeforePhase3), tasks: phase3to5Tasks, ci: true }).problems.length === 0 && checkExisting({ plan: thisPlan, exists: setOf(filesAtHeadAfterT18), tasks: phase3to5Tasks, ci: true }).problems.some((q) => /plan-targets\.mjs/.test(q)))
  ok('--tasks none checks nothing and notes it', (() => { const r = checkExisting({ plan: thisPlan, exists: setOf([]), tasks: [] }); return r.problems.length === 0 && r.considered.length === 0 && r.notes.some((n) => /no remaining tasks/.test(n)) })())
  ok('an unknown task in the scope is a problem', checkExisting({ plan: planWithMissing, exists: setOf(['a.mjs', 'missing.mjs']), tasks: ['T9'] }).problems.some((q) => /T9/.test(q)))
  ok('considered lists the walked targets with task, type, value and line', (() => { const r = checkExisting({ plan: planWithMissing, exists: setOf(['a.mjs', 'missing.mjs']) }); return r.considered.length === 3 && r.considered[0].task === 'T1' && r.considered[0].line === 4 && r.considered[2].type === 'command' })())

  // --- resolveRev ---
  const stubGit = { mergeBase: 'MERGEBASE_SHA' }
  ok('the CLI default rev is the merge base, not HEAD', resolveRev({ rev: undefined, gitImpl: stubGit }) === stubGit.mergeBase)
  ok('an explicit --rev wins', resolveRev({ rev: 'abc', gitImpl: stubGit }) === 'abc')

  // --- resolveTasks ---
  ok('amendment to a merged plan without --tasks is refused, naming the flag', /--tasks/.test(resolveTasks({ tasks: undefined, planExistsAtRev: true }).error))
  ok('an unknown task ID is refused, even mixed with valid ones or from a range', ['T99', 'T17,T99', 'T24-T26'].every((sel) => /T99|T26/.test(resolveTasks({ tasks: sel, planExistsAtRev: true, plan: thisPlan }).error ?? '')))
  ok('every unknown ID is named', (() => { const e = resolveTasks({ tasks: 'T98,T17,T99', planExistsAtRev: true, plan: thisPlan }).error; return /T98/.test(e) && /T99/.test(e) && !/T17/.test(e) })())
  ok('a refused selection selects nothing', resolveTasks({ tasks: 'T17,T99', planExistsAtRev: true, plan: thisPlan }).tasks === undefined)
  ok('--tasks none is accepted and distinct from an invalid selection', (() => { const r = resolveTasks({ tasks: 'none', planExistsAtRev: true, plan: thisPlan }); return r.error === undefined && r.tasks.length === 0 })())
  ok('a list and a range expand, in plan order', (() => { const r = resolveTasks({ tasks: 'T20,T17-T18', planExistsAtRev: true, plan: thisPlan }); return r.error === undefined && r.tasks.join() === 'T17,T18,T20' })())
  ok('garbage is refused', ['', 'T', 'x', 'T17,', 'T18-T17', 'none,T17', '17'].every((sel) => typeof resolveTasks({ tasks: sel, planExistsAtRev: true, plan: thisPlan }).error === 'string'))
  ok('a new plan (absent at rev) defaults to every task, so a create target that already exists is still reported', resolveTasks({ tasks: undefined, planExistsAtRev: false, plan: planCreatingExisting }).tasks.length === parsePlan(planCreatingExisting).tasks.length && checkExisting({ plan: planCreatingExisting, exists: setOf(['x.mjs']) }).problems.length === 1)

  // --- gitFacts and filesAtRev over scratch repos ---
  const raw = (cwd, args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', shell: false })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    return r.stdout.trim()
  }
  const origin = join(root, 'origin')
  mkdirSync(origin)
  raw(origin, ['init', '-q', '-b', 'main'])
  mkdirSync(join(origin, 'sub dir'))
  writeFileSync(join(origin, 'a.txt'), 'a\n')
  writeFileSync(join(origin, 'sub dir', 'b é.txt'), 'b\n')
  raw(origin, ['add', '-A'])
  raw(origin, ['commit', '-q', '-m', 'base'])
  const baseSha = raw(origin, ['rev-parse', 'HEAD'])
  const work = join(root, 'work')
  raw(root, ['clone', '-q', origin, work])
  raw(work, ['checkout', '-q', '-b', 'feature'])
  writeFileSync(join(work, 'new.txt'), 'n\n')
  raw(work, ['add', '-A'])
  raw(work, ['commit', '-q', '-m', 'feature work'])
  // main moves on after the clone: the fetch must pick it up
  writeFileSync(join(origin, 'later.txt'), 'l\n')
  raw(origin, ['add', '-A'])
  raw(origin, ['commit', '-q', '-m', 'main moves'])
  const facts = await gitFacts({ cwd: work })
  ok('gitFacts fetches origin main, then reports the merge base with HEAD (not HEAD, not the new origin/main)', facts.mergeBase === baseSha && facts.mergeBase !== raw(work, ['rev-parse', 'HEAD']) && raw(work, ['rev-parse', 'origin/main']) !== baseSha)
  const atBase = await filesAtRev({ cwd: work, rev: facts.mergeBase })
  ok('filesAtRev lists the files at the merge base, spaces and non-ASCII names included, and not the branch\'s own', atBase.has('a.txt') && atBase.has('sub dir/b é.txt') && !atBase.has('new.txt') && !atBase.has('later.txt'))
  ok('filesAtRev at HEAD has the branch\'s file', (await filesAtRev({ cwd: work, rev: 'HEAD' })).has('new.txt'))
  ok('gitFacts without an origin fails with the fetch named', await (async () => { try { await gitFacts({ cwd: origin }); return false } catch (e) { return /fetch origin main/.test(e.message) } })())
  ok('filesAtRev of an unknown rev throws', await (async () => { try { await filesAtRev({ cwd: work, rev: 'nope' }); return false } catch { return true } })())
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
