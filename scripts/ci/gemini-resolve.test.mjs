// Executes the "Resolve the PR" step of .github/workflows/gemini-review.yml: its Python heredoc is
// extracted from the YAML and run with `python3 -I` against a local stub of the pulls API, so the
// test exercises the exact text the workflow runs.
// Where it runs: the step runs only on ubuntu-latest, so this is skipped on Windows (CI's
// windows-latest job included), where python3, line endings and a socket-ready env all differ.
// Elsewhere it needs python3: CI runners have it and there it is required; on a laptop without
// it, the file is skipped with a message, so `npm test` stays Node-only for contributors.
// Run: node scripts/ci/gemini-resolve.test.mjs
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

// The resolve step's heredoc, bounded to that one step so another step's heredoc can never be
// taken for it. CRLF is normalised first: a Windows checkout with core.autocrlf has CRLF.
export function extractResolve(yaml) {
  const y = yaml.replace(/\r\n/g, '\n')
  const start = y.indexOf('      - name: Resolve the PR\n')
  if (start < 0) return null
  const next = y.indexOf('\n      - ', start + 1)
  const step = next < 0 ? y.slice(start) : y.slice(start, next + 1)
  const m = step.match(/python3 -I - <<'PY'\n([\s\S]*?)\n {10}PY\n/)
  return m ? m[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n') : null
}

const yml = readFileSync(new URL('../../.github/workflows/gemini-review.yml', import.meta.url), 'utf8')
const script = extractResolve(yml)
if (!script) { console.log('  FAIL could not find the resolve heredoc in gemini-review.yml'); process.exit(1) }
ok('extract: a CRLF checkout yields the same script', extractResolve(yml.replace(/\r?\n/g, '\r\n')) === script)
ok('extract: bounded to the resolve step (no match when its heredoc is gone, even if a later step has one)',
  extractResolve(yml.replace(/\r\n/g, '\n').replace("python3 -I - <<'PY'\n", 'python3 -I - <<EOF\n').replace('- name: Post the review', "- name: Post the review\n        run: |\n          python3 -I - <<'PY'\n          x\n          PY\n")) === null)

if (process.platform === 'win32') {
  console.log('  SKIP resolver cases: the step runs only on ubuntu-latest')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
if (spawnSync('python3', ['--version']).status !== 0) {
  if (process.env.CI) { console.log('  FAIL python3 is required in CI to run the resolver cases'); process.exit(1) }
  console.log('  SKIP resolver cases: no python3 on this machine; CI always runs them')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

const REPO = 'o/r', A = 'a'.repeat(40), B = 'b'.repeat(40)
const goodPr = () => ({
  state: 'open', draft: false, title: 'Fix it\nforged=1', labels: [{ name: 'subtle-correctness' }],
  base: { ref: 'main', sha: A }, head: { sha: B, repo: { full_name: REPO } }, user: { login: 'alice' },
})
let reply = { status: 200, body: goodPr() }, lastPath = null, lastAuth = null
const server = createServer((req, res) => {
  lastPath = req.url; lastAuth = req.headers.authorization
  res.writeHead(reply.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply.body))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const api = `http://127.0.0.1:${server.address().port}`

async function resolve(env) {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-resolve-'))
  const output = join(dir, 'out'); writeFileSync(output, '')
  const full = { PATH: process.env.PATH, GITHUB_REPOSITORY: REPO, GITHUB_OUTPUT: output, RUNNER_TEMP: dir,
    GITHUB_API_URL: api, GH_TOKEN: 'tok', EVENT_NAME: 'workflow_dispatch', INPUT_PR: '57',
    EV_NUMBER: '', EV_BASE_SHA: '', EV_HEAD_SHA: '', EV_TITLE: '', ...env }
  const code = await new Promise((r) => {
    const p = execFile('python3', ['-I', '-'], { env: full }, (err) => r(err ? (err.code ?? 1) : 0))
    p.stdin.end(script)
  })
  const out = Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)))
  const titleFile = join(dir, 'pr-title')
  const title = existsSync(titleFile) ? readFileSync(titleFile, 'utf8') : null
  rmSync(dir, { recursive: true, force: true })
  return { code, out, title }
}
const W = (x) => JSON.stringify(x)

let r = await resolve({})
ok('dispatch: labelled same-repo PR into main -> run=true with number and both SHAs',
  r.code === 0 && W(r.out) === W({ run: 'true', number: '57', base_sha: A, head_sha: B }))
ok('dispatch: reads the PR named by the input, with the token', lastPath === '/repos/o/r/pulls/57' && lastAuth === 'Bearer tok')
ok('dispatch: a newline in the title goes to the title file, never forges an output', r.title === 'Fix it\nforged=1' && !('forged' in r.out))

const skipCase = async (name, mutate) => {
  const body = goodPr(); mutate(body); reply = { status: 200, body }
  const s = await resolve({})
  ok(`dispatch: ${name} -> run=false, nothing else`, s.code === 0 && W(s.out) === W({ run: 'false' }) && s.title === null)
}
await skipCase('closed PR', (b) => { b.state = 'closed' })
await skipCase('draft PR', (b) => { b.draft = true })
await skipCase('base not main', (b) => { b.base.ref = 'release' })
await skipCase('fork PR', (b) => { b.head.repo.full_name = 'evil/r' })
await skipCase('deleted fork (head.repo null)', (b) => { b.head.repo = null })
await skipCase('Dependabot PR', (b) => { b.user.login = 'dependabot[bot]' })
await skipCase('no subtle-correctness label', (b) => { b.labels = [{ name: 'standard' }] })
reply = { status: 200, body: goodPr() }

for (const bad of ['57; echo x', '', '0', '-1', '57\nrun=true', '1'.repeat(11), ' 57', '57 ', ' 57 ']) {
  lastPath = null
  const s = await resolve({ INPUT_PR: bad })
  ok(`dispatch: input ${JSON.stringify(bad)} refused before any API call`, s.code !== 0 && lastPath === null && !('run' in s.out))
}

reply = { status: 404, body: { message: 'Not Found' } }
r = await resolve({})
ok('dispatch: API error -> step fails, no run output (nothing posts)', r.code !== 0 && !('run' in r.out))
reply = { status: 200, body: { ...goodPr(), head: { sha: 'zz', repo: { full_name: REPO } } } }
r = await resolve({})
ok('dispatch: malformed SHA from the API -> step fails, no run output', r.code !== 0 && !('run' in r.out))
reply = { status: 200, body: goodPr() }

lastPath = null
r = await resolve({ EVENT_NAME: 'pull_request', INPUT_PR: '', EV_NUMBER: '9', EV_BASE_SHA: A, EV_HEAD_SHA: B, EV_TITLE: 'T' })
ok('pull_request: payload values pass through, no API call',
  r.code === 0 && lastPath === null && W(r.out) === W({ run: 'true', number: '9', base_sha: A, head_sha: B }) && r.title === 'T')

server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
