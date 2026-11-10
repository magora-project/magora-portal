// Self-test for scripts/review/identity.mjs. Builds scratch git repos in mkdtemp and deletes them afterwards.
// Run: node scripts/review/identity.test.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate the scratch repos from the developer's global/system git config. The module must not
// rely on this: the config-override cases below set repo config and prove the flags win.
const root = mkdtempSync(join(tmpdir(), 'identity-test-'))
const emptyConfig = join(root, 'empty.gitconfig')
writeFileSync(emptyConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const identityModule = await import('./identity.mjs')
const { DIFF_ARGS, EVIDENCE_DIR, blobIdentity, geminiDiff, git, inputIdentity, mergeBase } = identityModule
const EMPTY_ATTRIBUTES = identityModule.EMPTY_ATTRIBUTES ?? join(root, 'missing-export')

let pass = 0, fail = 0
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); c.catch(() => {}); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}
const hex = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s)
const same = (a, b) => hex(a) && hex(b) && a === b
const differ = (a, b) => hex(a) && hex(b) && a !== b

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
const merge = (cwd, branch) => raw(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-edit', '-q', branch])
const put = (cwd, file, text) => writeFileSync(join(cwd, file), text)
const mkrepo = () => {
  const dir = join(root, `r${++seq}`)
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { shell: false })
  return dir
}
const id = (cwd, base, head) => inputIdentity({ cwd, base, head })

try {
  // --- exports ---
  ok('EVIDENCE_DIR is .review', EVIDENCE_DIR === '.review')
  ok('DIFF_ARGS carries the pinned flags', ['-U0', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', '--no-renames',
    '--diff-algorithm=myers', '--indent-heuristic', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/'].every((f) => DIFF_ARGS.includes(f)))

  // --- main scenario ---
  const filler = (p) => Array.from({ length: 8 }, (_, i) => `${p}${i}`)
  const app = (fn, b, ret) => [...filler('top'), `def ${fn}(x):`, '    a = 1', `    b = ${b}`, '    c = 3', `    ${ret}`, ...filler('bot')].join('\n') + '\n'
  const r1 = mkrepo()
  put(r1, 'app.py', app('compute', 2, 'return a + b + c'))
  commit(r1, 'base')
  raw(r1, ['checkout', '-q', '-b', 'pr'])
  put(r1, 'app.py', app('compute', 20, 'return a + b + c'))
  commit(r1, 'pr change')
  const idBefore = await id(r1, 'main', 'pr')
  ok('identity is 40-hex', hex(idBefore))

  raw(r1, ['checkout', '-q', 'main'])
  put(r1, 'app.py', 'new1\nnew2\nnew3\n' + app('calc', 2, 'return a + b + c'))
  commit(r1, 'main renames and shifts')
  raw(r1, ['checkout', '-q', 'pr'])
  merge(r1, 'main')
  const idAfterMerge = await id(r1, 'main', 'pr')
  ok('same PR change -> same identity after main renames the enclosing function and shifts lines', same(idBefore, idAfterMerge))

  raw(r1, ['checkout', '-q', 'main'])
  put(r1, 'app.py', 'new1\nnew2\nnew3\n' + app('calc', 2, 'return a + b'))
  commit(r1, 'main edits near the PR line')
  raw(r1, ['checkout', '-q', 'pr'])
  merge(r1, 'main')
  const idAdjacent = await id(r1, 'main', 'pr')
  ok('main edits a line adjacent to the PR line -> unchanged', same(idBefore, idAdjacent))

  const mb = await mergeBase({ cwd: r1, base: 'main', head: 'pr' })
  ok('mergeBase returns main tip after the merge', mb === raw(r1, ['rev-parse', 'main']))

  mkdirSync(join(r1, '.review'), { recursive: true })
  put(r1, '.review/r.json', '{"a":1}\n')
  commit(r1, 'evidence only')
  const idAfterEvidenceCommit = await id(r1, 'main', 'pr')
  ok('an evidence-only commit voids nothing', same(idBefore, idAfterEvidenceCommit))

  raw(r1, ['checkout', '-q', '-b', 'ev', 'main'])
  mkdirSync(join(r1, '.review'), { recursive: true })
  put(r1, '.review/only.json', '{"b":2}\n')
  commit(r1, 'only evidence')
  const idEvidenceOnly = await id(r1, 'main', 'ev')
  ok('a PR whose only change is under .review/ -> "empty"', idEvidenceOnly === 'empty')
  raw(r1, ['checkout', '-q', 'pr'])

  // config overrides (repo-level config must not change the identity)
  raw(r1, ['config', 'diff.noprefix', 'true'])
  const idNoPrefix = await id(r1, 'main', 'pr')
  raw(r1, ['config', '--unset', 'diff.noprefix'])
  ok('diff.noprefix=true in repo config -> same identity', same(idBefore, idNoPrefix))

  // more change
  put(r1, 'app.py', 'new1\nnew2\nnew3\n' + app('calc', 20, 'return a + b').replace('top3', 'top3 changed'))
  commit(r1, 'pr changes one more line')
  const idMore = await id(r1, 'main', 'pr')
  ok('PR changes one more line -> changed', differ(idBefore, idMore))

  // blob identity (working tree == committed bytes, autocrlf off)
  const blob = await blobIdentity({ cwd: r1, rev: 'pr', path: 'app.py' })
  ok('blobIdentity equals git hash-object of the committed bytes', hex(blob) && blob === raw(r1, ['hash-object', 'app.py']))

  // --- rename/copy + algorithm ---
  const r2 = mkrepo()
  const body = Array.from({ length: 20 }, (_, i) => `content line ${i}`).join('\n') + '\n'
  put(r2, 'old.txt', body)
  put(r2, 'c.txt', body.replace('line 3', 'line three'))
  commit(r2, 'base')
  raw(r2, ['checkout', '-q', '-b', 'pr'])
  raw(r2, ['mv', 'old.txt', 'new.txt'])
  put(r2, 'new.txt', body.replace('content line 7', 'content line seven'))
  put(r2, 'copy.txt', body.replace('line 3', 'line three'))
  put(r2, 'c.txt', body.replace('line 3', 'line three').replace('line 12', 'line twelve'))
  commit(r2, 'rename + edit + copy')
  const idRen = await id(r2, 'main', 'pr')
  raw(r2, ['config', 'diff.renames', 'copies'])
  raw(r2, ['config', 'diff.algorithm', 'histogram'])
  const idUserConfig = await id(r2, 'main', 'pr')
  ok('diff.renames=copies and diff.algorithm=histogram -> same identity', same(idRen, idUserConfig))

  // --- diff.algorithm on its own, with content where myers and histogram disagree ---
  const r2b = mkrepo()
  put(r2b, 'a.txt', 'x\nb\nif foo:\nb\n')
  commit(r2b, 'base')
  raw(r2b, ['checkout', '-q', '-b', 'pr'])
  put(r2b, 'a.txt', 'x\nif foo:\nb\na\nif foo:\ny\nb\n')
  commit(r2b, 'insert')
  const idAlgoDefault = await id(r2b, 'main', 'pr')
  raw(r2b, ['config', 'diff.algorithm', 'histogram'])
  const idAlgoHistogram = await id(r2b, 'main', 'pr')
  ok('diff.algorithm=histogram alone -> same identity', same(idAlgoDefault, idAlgoHistogram))

  // --- inter-hunk context ---
  const nums = (edits) => Array.from({ length: 20 }, (_, i) => edits.includes(i) ? `edited ${i}` : `n${i}`).join('\n') + '\n'
  const r3 = mkrepo()
  put(r3, 'n.txt', nums([]))
  commit(r3, 'base')
  raw(r3, ['checkout', '-q', '-b', 'pr'])
  put(r3, 'n.txt', nums([5, 9]))
  commit(r3, 'two edits three lines apart')
  const idTwoEdits = await id(r3, 'main', 'pr')
  raw(r3, ['config', 'diff.interHunkContext', '5'])
  const idTwoEditsInterHunk5 = await id(r3, 'main', 'pr')
  ok('diff.interHunkContext=5 in repo config, two PR edits three lines apart -> same identity as with it unset', same(idTwoEdits, idTwoEditsInterHunk5))

  // --- binary ---
  const r4 = mkrepo()
  writeFileSync(join(r4, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 0, 7]))
  commit(r4, 'base')
  raw(r4, ['checkout', '-q', '-b', 'p1'])
  writeFileSync(join(r4, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 9, 0, 7]))
  commit(r4, 'bin1')
  raw(r4, ['checkout', '-q', '-b', 'p2', 'main'])
  writeFileSync(join(r4, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 8, 0, 7]))
  commit(r4, 'bin2')
  const idBin1 = await id(r4, 'main', 'p1')
  const idBin2 = await id(r4, 'main', 'p2')
  ok('a binary file change has an identity, and changing its bytes changes it', differ(idBin1, idBin2))

  // --- indentation ---
  const r5 = mkrepo()
  put(r5, 'f.py', 'def f():\n    pass\n')
  commit(r5, 'base')
  raw(r5, ['checkout', '-q', '-b', 'i4'])
  put(r5, 'f.py', 'def f():\n    pass\n    return True\n')
  commit(r5, 'indent 4')
  raw(r5, ['checkout', '-q', '-b', 'i8', 'main'])
  put(r5, 'f.py', 'def f():\n    pass\n        return True\n')
  commit(r5, 'indent 8')
  const idIndent4 = await id(r5, 'main', 'i4')
  const idIndent8 = await id(r5, 'main', 'i8')
  ok('an indentation-only change to an added line -> changed', differ(idIndent4, idIndent8))

  // --- indent heuristic ---
  const r6 = mkrepo()
  put(r6, 'h.py', '}\n{\na\na\n')
  commit(r6, 'base')
  raw(r6, ['checkout', '-q', '-b', 'pr'])
  put(r6, 'h.py', '}\n{\na\n\na\na\n')
  commit(r6, 'insert block above a repeated line')
  raw(r6, ['config', 'diff.indentHeuristic', 'true'])
  const idHeuristicOn = await id(r6, 'main', 'pr')
  raw(r6, ['config', 'diff.indentHeuristic', 'false'])
  const idHeuristicOff = await id(r6, 'main', 'pr')
  ok('diff.indentHeuristic=false in repo config, a block inserted above a repeated line -> same identity as with it true', same(idHeuristicOn, idHeuristicOff))

  // --- file order ---
  const r7 = mkrepo()
  put(r7, 'x.txt', 'x0\nx1\nx2\n')
  put(r7, 'y.txt', 'y0\ny1\ny2\n')
  commit(r7, 'base')
  raw(r7, ['checkout', '-q', '-b', 'xy'])
  put(r7, 'x.txt', 'x0\nX1\nx2\n'); commit(r7, 'x')
  put(r7, 'y.txt', 'y0\nY1\ny2\n'); commit(r7, 'y')
  raw(r7, ['checkout', '-q', '-b', 'yx', 'main'])
  put(r7, 'y.txt', 'y0\nY1\ny2\n'); commit(r7, 'y')
  put(r7, 'x.txt', 'x0\nX1\nx2\n'); commit(r7, 'x')
  const idOrderXY = await id(r7, 'main', 'xy')
  const idOrderYX = await id(r7, 'main', 'yx')
  ok('the same two-file change in either file order -> same identity', same(idOrderXY, idOrderYX))

  // --- CRLF checkout with autocrlf=true ---
  const clone = join(root, 'clone')
  raw(root, ['clone', '-q', '-c', 'core.autocrlf=true', r1, clone])
  const idCrlfCheckout = await id(clone, 'origin/main', 'origin/pr')
  ok('CRLF working tree with autocrlf=true does not change the identity', same(idMore, idCrlfCheckout))
  ok('the clone really has a CRLF working tree', readFileSync(join(clone, 'app.py'), 'utf8').includes('\r\n'))

  // --- user gitattributes (core.attributesFile, and its XDG default) must not change the identity ---
  {
    const ra = mkrepo()
    put(ra, 'f.txt', 'a\nb\n')
    writeFileSync(join(ra, 'b.bin'), Buffer.from([0, 1, 2]))
    commit(ra, 'base')
    raw(ra, ['checkout', '-q', '-b', 'pr'])
    put(ra, 'f.txt', 'a\nB\n')
    writeFileSync(join(ra, 'b.bin'), Buffer.from([0, 1, 3]))
    commit(ra, 'pr')
    const idPlain = await id(ra, 'main', 'pr')
    const attrs = join(root, 'user.gitattributes')
    writeFileSync(attrs, '*.txt -diff\n')
    raw(ra, ['config', 'core.attributesFile', attrs])
    ok('fixture: the attributes file really turns the text diff binary', raw(ra, ['diff', '--binary', 'main', 'pr', '--', 'f.txt']).includes('GIT binary patch'))
    const idAttrsFile = await id(ra, 'main', 'pr')
    raw(ra, ['config', '--unset', 'core.attributesFile'])
    ok('core.attributesFile marking *.txt -diff -> same identity', same(idPlain, idAttrsFile))
    const xdg = join(root, 'xdg')
    mkdirSync(join(xdg, 'git'), { recursive: true })
    writeFileSync(join(xdg, 'git', 'attributes'), '*.txt -diff\n')
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = xdg
    let idXdg
    try { idXdg = await id(ra, 'main', 'pr') } finally { if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg }
    ok('the default user attributes file ($XDG_CONFIG_HOME/git/attributes) marking *.txt -diff -> same identity', same(idPlain, idXdg))
    ok('the empty attributes file the module points git at exists and is empty', (() => { try { return readFileSync(EMPTY_ATTRIBUTES, 'utf8') === '' } catch { return false } })())

    // A PR's own committed .gitattributes is read from the checked-out work tree. Without --attr-source, a PR adding
    // `*.txt -diff` turns its own edit into "Binary files differ" for Gemini, and the identity depends on which
    // commit is checked out (PR D Task 20 review, finding 3).
    raw(ra, ['checkout', '-q', 'pr'])
    put(ra, '.gitattributes', '*.txt -diff\n')
    put(ra, 'f.txt', 'a\nBB\n')
    commit(ra, 'pr adds a work-tree .gitattributes')
    ok('fixture: plain git diff of the PR really shows f.txt as binary', raw(ra, ['diff', 'main...pr', '--', 'f.txt']).includes('Binary files'))
    const idPrCheckedOut = await id(ra, 'main', 'pr')
    const gdPrCheckedOut = (await geminiDiff({ cwd: ra, base: 'main', head: 'pr' })).toString()
    raw(ra, ['checkout', '-q', 'main'])
    const idMainCheckedOut = await id(ra, 'main', 'pr')
    ok('a PR-committed .gitattributes marking *.txt -diff: same identity whichever commit is checked out', same(idPrCheckedOut, idMainCheckedOut))
    ok('a PR-committed .gitattributes marking *.txt -diff: geminiDiff still shows the text edit', gdPrCheckedOut.includes('+BB') && !gdPrCheckedOut.includes('Binary files a/f.txt'))
  }

  // --- geminiDiff and git() ---
  const gd = await geminiDiff({ cwd: r1, base: 'main', head: 'pr' })
  ok('geminiDiff returns a Buffer of the PR diff without .review', Buffer.isBuffer(gd) && gd.length > 0 && !gd.toString().includes('.review'))
  const bad = await git(['rev-parse', '--verify', 'nope'], { cwd: r1 })
  ok('git() reports a non-zero code without throwing', bad.code !== 0 && typeof bad.stderr === 'string' && Buffer.isBuffer(bad.stdout))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
