// Self-test for scripts/review/semgrep-artifact.mjs. Never runs real semgrep: spawnImpl is injected.
// Run: node scripts/review/semgrep-artifact.test.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractBlocks, main, scanArtifact } from './semgrep-artifact.mjs'

let pass = 0, fail = 0
// A thenable condition is a failure: a Promise is truthy even when it resolves to false.
const ok = (n, c) => {
  if (c && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c) { pass++ } else { fail++; console.log('  FAIL', n) }
}

const scratch = mkdtempSync(join(tmpdir(), 'semgrep-artifact-'))
try {
  const write = (name, text) => { const p = join(scratch, name); writeFileSync(p, text); return p }
  // "line" is the 1-based line of the OPENING fence.
  const md = ['# Doc', '', '```js', 'const a = 1', '```', '', 'prose', '', '```yaml', 'a: 1', '```', ''].join('\n')
  const mdPath = write('doc.md', md)
  ok('extracts fenced blocks with their language and line', extractBlocks(md).map((b) => `${b.lang}:${b.line}`).join() === 'js:3,yaml:9')
  ok('block code is the body without fences', extractBlocks(md)[0].code === 'const a = 1\n')
  ok('a tilde line does not close a backtick fence', (() => {
    const b = extractBlocks('```md\n~~~\nINSIDE\n```\n')
    return b.length === 1 && b[0].code === '~~~\nINSIDE\n'
  })())
  ok('a longer fence holds a shorter fence inside it', (() => {
    const b = extractBlocks('````md\n```js\nx\n```\n````\n')
    return b.length === 1 && b[0].lang === 'md' && b[0].code.includes('```js')
  })())
  ok('a tilde fence is a block; an unclosed fence runs to the end', extractBlocks('~~~sh\nls\n~~~\n').length === 1 && extractBlocks('```js\nx\n').length === 1)
  ok('an info string keeps only its first word as the language', extractBlocks('```js title="x"\ny\n```\n')[0].lang === 'js')

  const noCode = write('nocode.md', '# Nothing\n\njust prose\n')
  const nc = scanArtifact({ path: noCode })
  ok('a doc with no code blocks -> ran:false, UNRUN', nc.ran === false)
  ok('...with the reason "no code blocks"', nc.reason === 'no code blocks')
  const bare = write('bare.md', '```\nplain\n```\n\n```text\nmore\n```\n')
  const bs = scanArtifact({ path: bare, spawnImpl: () => { throw new Error('must not spawn') } })
  ok('only blocks without a scannable language -> ran:false "no scannable code blocks"', bs.ran === false && bs.reason === 'no scannable code blocks')

  // spawn stubs
  let seen
  const stub = (status, stdout, extra = {}) => (cmd, args, opts) => {
    seen = { cmd, args, opts, files: existsSync(args.at(-1)) ? readdirSync(args.at(-1)).sort() : [] }
    return { status, stdout, stderr: '', ...extra }
  }
  const finding = (file, line) => ({ check_id: 'rule.x', path: file, start: { line }, extra: { message: 'bad', severity: 'ERROR' } })
  // the yaml block is scanned as block-2.yaml; finding on its first code line => doc line 10
  const hit = JSON.stringify({ results: [finding('/tmp/x/block-1.js', 1)], errors: [] })
  const r = scanArtifact({ path: mdPath, spawnImpl: stub(1, hit) })
  ok('semgrep exit 1 with findings JSON -> findings returned, ran:true', r.ran && r.findings.length === 1)
  ok('a finding is mapped back to the Markdown line (fence line + code line)', r.findings[0].line === 4 && r.findings[0].checkId === 'rule.x')
  ok('the yaml block maps to its own fence', scanArtifact({ path: mdPath, spawnImpl: stub(1, JSON.stringify({ results: [finding('block-2.yaml', 1)] })) }).findings[0].line === 10)
  ok('invoked as semgrep scan --config p/default --json --metrics=off <dir>, no shell', seen.cmd === 'semgrep' && seen.args.slice(0, 5).join(' ') === 'scan --config p/default --json --metrics=off' && seen.opts.shell === false)
  ok('blocks were written to the temp dir with language extensions', seen.files.join() === 'block-1.js,block-2.yaml')
  ok('the temp dir is deleted afterwards', !existsSync(seen.args.at(-1)))
  ok('semgrep exit 0 with no results -> ran:true, no findings', (() => { const c = scanArtifact({ path: mdPath, spawnImpl: stub(0, '{"results":[]}') }); return c.ran === true && c.findings.length === 0 })())
  const missing = scanArtifact({ path: mdPath, spawnImpl: stub(null, '', { error: Object.assign(new Error('spawn semgrep ENOENT'), { code: 'ENOENT' }) }) })
  ok('semgrep missing -> ran:false with the install hint', missing.ran === false && /semgrep/.test(missing.reason) && /pipx install semgrep/.test(missing.reason))
  ok('semgrep exit 2 is not a pass', scanArtifact({ path: mdPath, spawnImpl: stub(2, '{"results":[]}') }).ran === false)
  ok('semgrep killed by a signal (status null) is not a pass', scanArtifact({ path: mdPath, spawnImpl: stub(null, '') }).ran === false)
  ok('unparseable JSON at exit 0 is not a pass', scanArtifact({ path: mdPath, spawnImpl: stub(0, 'not json') }).ran === false)
  ok('JSON without a results array is not a pass', scanArtifact({ path: mdPath, spawnImpl: stub(0, '{}') }).ran === false)
  ok('exit 1 with zero results is not a pass', scanArtifact({ path: mdPath, spawnImpl: stub(1, '{"results":[]}') }).ran === false)
  // Semgrep's `errors` array: a parse error or partial scan is never a clean scan
  const errJson = (results) => JSON.stringify({ results, errors: [{ code: 3, level: 'error', type: 'Syntax error', message: 'Syntax error at line block-1.js:1' }] })
  const e0 = scanArtifact({ path: mdPath, spawnImpl: stub(0, errJson([])) })
  ok('exit 0, no results, a non-empty errors array -> ran:false', e0.ran === false)
  ok('...with a reason that summarises the errors', /1 error/.test(e0.reason ?? '') && /Syntax error/.test(e0.reason ?? ''))
  const e1 = scanArtifact({ path: mdPath, spawnImpl: stub(1, errJson([finding('block-1.js', 1)])) })
  ok('results AND errors -> ran:false, the findings still attached', e1.ran === false && e1.findings.length === 1 && e1.findings[0].line === 4 && /error/.test(e1.reason ?? ''))
  ok('a non-array errors field -> ran:false', scanArtifact({ path: mdPath, spawnImpl: stub(0, '{"results":[],"errors":{"x":1}}') }).ran === false)
  ok('an empty errors array is still a clean scan', scanArtifact({ path: mdPath, spawnImpl: stub(0, '{"results":[],"errors":[]}') }).ran === true)
  ok('a missing file -> ran:false',scanArtifact({ path: join(scratch, 'nope.md'), spawnImpl: stub(0, '{"results":[]}') }).ran === false)

  // CLI: exit 0 clean, 1 findings, 2 UNRUN
  const cap = () => { const o = { out: '', err: '' }; o.io = { out: (s) => { o.out += s }, err: (s) => { o.err += s } }; return o }
  const run = (argv, spawnImpl) => { const c = cap(); const code = main(argv, { spawnImpl, ...c.io }); return { code, ...c } }
  ok('CLI: clean scan exits 0', run([mdPath], stub(0, '{"results":[]}')).code === 0)
  const f = run([mdPath], stub(1, hit))
  ok('CLI: findings exit 1 and print the line', f.code === 1 && /4/.test(f.out) && /rule\.x/.test(f.out))
  const u = run([noCode])
  ok('CLI: UNRUN exits 2 and says UNRUN', u.code === 2 && /UNRUN/.test(u.out + u.err))
  ok('CLI: no path is a usage error (exit 2 is reserved for UNRUN, so 64)', run([]).code === 64)
  const pe = run([mdPath], stub(1, errJson([finding('block-1.js', 1)])))
  ok('CLI: findings plus Semgrep errors exit 2 (UNRUN), print the findings and say UNRUN', pe.code === 2 && /rule\.x/.test(pe.out) && /UNRUN/.test(pe.out))
  ok('CLI: errors with no results exit 2', run([mdPath], stub(0, errJson([]))).code === 2)

  // The CLI entry must run when reached through a symlink or a non-canonical path (exit 2 UNRUN for a doc with no code).
  {
    const real = fileURLToPath(new URL('./semgrep-artifact.mjs', import.meta.url))
    const viaNode = (script) => spawnSync(process.execPath, [script, noCode], { encoding: 'utf8', shell: false })
    const direct = viaNode(real)
    ok('CLI subprocess via the real path: prints UNRUN and exits 2', direct.status === 2 && /UNRUN/.test(direct.stdout))
    const link = join(scratch, 'linked-semgrep-artifact.mjs')
    let linked = true
    try { symlinkSync(real, link) } catch (e) {
      if (process.platform === 'win32' && e && e.code === 'EPERM') { linked = false; console.log('  SKIP CLI subprocess via a symlink: symlink creation needs privileges on this Windows host') } else throw e
    }
    if (linked) {
      const vl = viaNode(link)
      ok('CLI subprocess via a symlink: still runs, prints UNRUN and exits 2 (not a silent exit 0)', vl.status === 2 && /UNRUN/.test(vl.stdout))
    }
  }

} finally {
  rmSync(scratch, { recursive: true, force: true })
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
