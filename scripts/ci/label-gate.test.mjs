// Self-test for scripts/ci/label-gate.mjs. Pure; the API is a stub, no network.
// Run: node scripts/ci/label-gate.test.mjs
import { readFileSync } from 'node:fs'
import { evaluateLabels, fetchLabels, inferLabel, main, parseControlFiles } from './label-gate.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

ok('exactly one depth label -> ok', evaluateLabels(['standard']).ok === true)
ok('one depth label among others -> ok', evaluateLabels(['dependencies', 'subtle-correctness']).ok === true)
ok('zero labels -> FAIL', evaluateLabels([]).ok === false)
ok('only non-depth labels -> FAIL', evaluateLabels(['dependencies']).ok === false)
ok('two depth labels -> FAIL naming both', (() => {
  const v = evaluateLabels(['mechanical', 'standard'])
  return v.ok === false && /mechanical, standard/.test(v.line)
})())
ok('near-miss name is not a depth label', evaluateLabels(['Standard']).ok === false)

const stub = (pages, status = 200) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'))
  return { ok: status === 200, status, json: async () => pages[page - 1] ?? [] }
}
const full = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }))
ok('paginates past 100 labels', (await fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([full, [{ name: 'standard' }]]) })).length === 101)
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }
ok('API error throws (fails closed) with the status', /403/.test(await errOf(() => fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: stub([], 403) })) ?? ''))
ok('non-array response throws a non-array error', /non-array/.test(await errOf(() => fetchLabels({ repo: 'o/r', pr: 1, token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })) ?? ''))

// main(): the fail-closed entry point. Console output is captured so test output stays pristine.
const goodEnv = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '1' }
const quiet = async (fn) => {
  const { log, error } = console
  const lines = []
  console.log = console.error = (...a) => { lines[lines.length] = a.join(' ') }
  try { return { code: await fn(), lines } } finally { console.log = log; console.error = error }
}
const m1 = await quiet(() => main({ env: {} }))
ok('main: missing env -> 1', m1.code === 1 && /required/.test(m1.lines.join()))
const m2 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([], 403) }))
ok('main: API error -> 1 (could not judge)', m2.code === 1 && /could not judge/.test(m2.lines.join()))
const m3 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([[{ name: 'standard' }]]) }))
ok('main: one depth label -> 0', m3.code === 0)
const m4 = await quiet(() => main({ env: goodEnv, fetchImpl: stub([[{ name: 'dependencies' }]]) }))
ok('main: no depth label -> 1', m4.code === 1)

// --- auto-label ---
const AGENTS = '# x\n\n## Control files\n\n`.github/**`, `scripts/ci/**`, `AGENTS.md`, `package.json`.\nprose\n\n## Migrations\n\n`not/this.md`\n'
ok('parseControlFiles reads only the Control files section',
  JSON.stringify(parseControlFiles(AGENTS)) === JSON.stringify(['.github/**', 'scripts/ci/**', 'AGENTS.md', 'package.json']))
ok('parseControlFiles throws when the section is missing', /no control files/.test(await errOf(async () => parseControlFiles('# x\n## Other\n`a`\n')) ?? ''))
ok('parseControlFiles reads the real AGENTS.md', (() => {
  const real = parseControlFiles(readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8'))
  return real.includes('.github/**') && real.includes('scripts/ci/**') && real.includes('AGENTS.md')
})())
const CF = parseControlFiles(AGENTS)
ok('infer: src only -> standard', inferLabel(['src/pages/MapPage.jsx', 'docs/x.md'], CF) === 'standard')
ok('infer: migration -> subtle', inferLabel(['src/a.js', 'supabase/migrations/2026_x.sql'], CF) === 'subtle-correctness')
ok('infer: api/ -> subtle', inferLabel(['api/register-node.js'], CF) === 'subtle-correctness')
ok('infer: control dir glob -> subtle', inferLabel(['.github/workflows/ci.yml'], CF) === 'subtle-correctness')
ok('infer: exact control file -> subtle', inferLabel(['package.json'], CF) === 'subtle-correctness')
ok('infer: near-miss is not a control file', inferLabel(['src/package.json', 'scripts/cia/x.mjs', '.githubx'], CF) === 'standard')
ok('infer: never mechanical', inferLabel([], CF) === 'standard')

// A stateful stub for the GitHub API: POST adds a label, DELETE removes one (404 if absent), every
// write is recorded, and `events` grows with each bot POST, as GitHub's would.
const BOT = 'github-actions[bot]'
function labeled(name, login) { return { event: 'labeled', label: { name }, actor: { login } } }
const gh = ({ labels = [], files = [], events = [], failWrites = false, dispatchStatus = 204 } = {}) => {
  const state = [...labels], log = [...events], writes = [], dispatches = []
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method ?? 'GET'
    const page = Number(u.searchParams.get('page') ?? 1)
    const slice = (arr) => arr.slice((page - 1) * 100, page * 100)
    // A workflow dispatch answers 204 with no body: json() throws, as a real empty body would.
    if (u.pathname.endsWith('/dispatches')) {
      dispatches.push(`${method} ${u.pathname} ${opts.body}`)
      return { ok: dispatchStatus < 300, status: dispatchStatus, json: async () => { throw new Error('no body') } }
    }
    if (method !== 'GET') {
      writes.push(`${method} ${decodeURIComponent(u.pathname.split('/labels')[1] || '')} ${opts.body ?? ''}`.trim())
      if (failWrites) return { ok: false, status: 403, json: async () => ({}) }
      if (method === 'POST') {
        for (const name of JSON.parse(opts.body).labels) if (!state.includes(name)) { state.push(name); log.push(labeled(name, BOT)) }
      } else {
        const name = decodeURIComponent(u.pathname.split('/labels/')[1])
        if (!state.includes(name)) return { ok: false, status: 404, json: async () => ({}) }
        state.splice(state.indexOf(name), 1)
        log.push({ event: 'unlabeled', label: { name }, actor: { login: BOT } })
      }
      return { ok: true, status: 200, json: async () => state.map((name) => ({ name })) }
    }
    if (u.pathname.endsWith('/labels')) return { ok: true, json: async () => slice(state.map((name) => ({ name }))) }
    if (u.pathname.endsWith('/files')) return { ok: true, json: async () => slice(files) }
    if (u.pathname.endsWith('/events')) return { ok: true, json: async () => slice(log) }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchImpl, writes, state, dispatches }
}
const auto = { ...goodEnv, AUTO_LABEL: 'true' }
const readAgents = () => AGENTS
const W = (x) => JSON.stringify(x)

const a1 = gh({ files: [{ filename: 'src/pages/MapPage.jsx' }] })
const r1 = await quiet(() => main({ env: auto, fetchImpl: a1.fetchImpl, readAgents }))
ok('auto: no label, src change -> applies standard and passes',
  r1.code === 0 && W(a1.writes) === W(['POST  {"labels":["standard"]}']))
const a2 = gh({ files: [{ filename: 'src/a.js' }, { filename: 'scripts/ci/x.mjs' }] })
const r2 = await quiet(() => main({ env: auto, fetchImpl: a2.fetchImpl, readAgents }))
ok('auto: no label, control file -> applies subtle-correctness', r2.code === 0 && W(a2.state) === W(['subtle-correctness']))
const a3 = gh({ files: [{ filename: 'src/b.js', previous_filename: 'scripts/ci/old.mjs' }] })
await quiet(() => main({ env: auto, fetchImpl: a3.fetchImpl, readAgents }))
ok('auto: a rename FROM a control file counts', W(a3.state) === W(['subtle-correctness']))
const a4 = gh({ files: Array.from({ length: 3000 }, (_, i) => ({ filename: `src/f${i}.js` })) })
await quiet(() => main({ env: auto, fetchImpl: a4.fetchImpl, readAgents }))
ok('auto: file list at the 3000 cap -> subtle-correctness (cannot see every path)', W(a4.state) === W(['subtle-correctness']))
const a5 = gh({ files: [{ filename: 'src/a.js' }] })
const r5 = await quiet(() => main({ env: goodEnv, fetchImpl: a5.fetchImpl, readAgents }))
ok('no AUTO_LABEL: never writes, no label -> FAIL as before', r5.code === 1 && a5.writes.length === 0)
const a6 = gh({ files: [{ filename: 'src/a.js' }], failWrites: true })
const r6 = await quiet(() => main({ env: auto, fetchImpl: a6.fetchImpl, readAgents }))
ok('auto: write refused -> FAIL, saying auto-label failed', r6.code === 1 && /auto-label failed/.test(r6.lines.join()))
const a7 = gh({ files: [{ filename: 'src/a.js' }] })
const r7 = await quiet(() => main({ env: auto, fetchImpl: a7.fetchImpl, readAgents: () => '# no section\n' }))
ok('auto: unreadable control list -> FAIL, nothing written (does not guess standard)', r7.code === 1 && a7.writes.length === 0)
const a8 = gh({ labels: ['standard'], events: [labeled('standard', 'noahwaldron55')], files: [{ filename: 'supabase/migrations/x.sql' }] })
const r8 = await quiet(() => main({ env: auto, fetchImpl: a8.fetchImpl, readAgents }))
ok("auto: a person's single label is never changed, even below the inferred one", r8.code === 0 && a8.writes.length === 0)

// The bot's label follows later pushes (review finding 1).
const a9 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'src/a.js' }, { filename: 'supabase/migrations/x.sql' }] })
const r9 = await quiet(() => main({ env: auto, fetchImpl: a9.fetchImpl, readAgents }))
ok('auto: bot standard, a new commit adds a migration -> raised to subtle-correctness', r9.code === 0 && W(a9.state) === W(['subtle-correctness']))
const a10 = gh({ labels: ['subtle-correctness'], events: [labeled('subtle-correctness', BOT)], files: [{ filename: 'src/a.js' }] })
const r10 = await quiet(() => main({ env: auto, fetchImpl: a10.fetchImpl, readAgents }))
ok('auto: bot subtle-correctness is never lowered', r10.code === 0 && a10.writes.length === 0)
const a10b = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'src/a.js' }] })
const r10b = await quiet(() => main({ env: auto, fetchImpl: a10b.fetchImpl, readAgents }))
ok('auto: bot label already right -> no writes', r10b.code === 0 && a10b.writes.length === 0)

// Two bot labels from overlapping runs heal (review finding 2).
const a11 = gh({ labels: ['standard', 'subtle-correctness'], events: [labeled('standard', BOT), labeled('subtle-correctness', BOT)], files: [{ filename: 'src/a.js' }] })
const r11 = await quiet(() => main({ env: auto, fetchImpl: a11.fetchImpl, readAgents }))
ok('auto: two bot labels -> keeps subtle-correctness, removes the other, passes', r11.code === 0 && W(a11.state) === W(['subtle-correctness']))

// A person's label wins.
const a12 = gh({ labels: ['standard', 'subtle-correctness'], events: [labeled('standard', BOT), labeled('subtle-correctness', 'noahwaldron55')] })
const r12 = await quiet(() => main({ env: auto, fetchImpl: a12.fetchImpl, readAgents }))
ok("auto: person adds a label -> bot's is removed, passes", r12.code === 0 && W(a12.writes) === W(['DELETE /standard']))
const a12b = gh({ labels: ['subtle-correctness', 'standard'], events: [labeled('subtle-correctness', BOT), labeled('standard', 'noahwaldron55')] })
const r12b = await quiet(() => main({ env: auto, fetchImpl: a12b.fetchImpl, readAgents }))
ok("auto: a person may lower the bot's label (their call, as before)", r12b.code === 0 && W(a12b.state) === W(['standard']))
const a13 = gh({ labels: ['standard', 'mechanical'], events: [labeled('standard', 'alice'), labeled('mechanical', 'bob')] })
const r13 = await quiet(() => main({ env: auto, fetchImpl: a13.fetchImpl, readAgents }))
ok("auto: two people's labels -> nothing removed, FAIL", r13.code === 1 && a13.writes.length === 0)
const a14 = gh({ labels: ['standard', 'subtle-correctness'], events: [labeled('standard', BOT), labeled('subtle-correctness', 'noahwaldron55'), { event: 'unlabeled', label: { name: 'standard' }, actor: { login: 'x' } }, labeled('standard', 'noahwaldron55')] })
const r14 = await quiet(() => main({ env: auto, fetchImpl: a14.fetchImpl, readAgents }))
ok('auto: a label a person re-added after the bot is theirs, not removed', r14.code === 1 && a14.writes.length === 0)
const a15 = gh({ labels: ['standard', 'mechanical'], events: [...Array.from({ length: 100 }, () => ({ event: 'commented' })), labeled('standard', BOT), labeled('mechanical', 'alice')] })
await quiet(() => main({ env: auto, fetchImpl: a15.fetchImpl, readAgents }))
ok('auto: events paginate past 100', W(a15.writes) === W(['DELETE /standard']))

// Judges the PR's labels after writing, not this run's view (review findings 2 and 3).
// A person removes `standard` between the run's ownership read and its DELETE (Opus re-review).
const a16 = gh({ labels: ['standard', 'subtle-correctness'], events: [labeled('standard', BOT), labeled('subtle-correctness', BOT)], files: [{ filename: 'src/a.js' }] })
const extra16 = []
const raced = async (url, opts = {}) => {
  if (opts.method === 'DELETE' && !extra16.length) {
    a16.state.splice(a16.state.indexOf('standard'), 1)
    extra16.push({ event: 'unlabeled', label: { name: 'standard' }, actor: { login: 'alice' } })
  }
  const r = await a16.fetchImpl(url, opts)
  if (extra16.length && (opts.method ?? 'GET') === 'GET' && new URL(url).pathname.endsWith('/events')) {
    const evs = await r.json()
    return { ok: true, json: async () => [...evs, ...extra16] }
  }
  return r
}
const r16 = await quiet(() => main({ env: auto, fetchImpl: raced, readAgents }))
ok("auto: DELETE 404 (a person removed it) passes, and the bot does not put it back",
  r16.code === 0 && W(a16.state) === W(['subtle-correctness']) && !a16.writes.some((w) => w.startsWith('POST')) && !/restored/.test(r16.lines.join()))

// A present label with no `labeled` event yet (events endpoint lagging): retry, then fail closed.
const a16b = gh({ labels: ['standard'], events: [], files: [{ filename: 'supabase/migrations/x.sql' }] })
let slept = 0
const r16b = await quiet(() => main({ env: auto, fetchImpl: a16b.fetchImpl, readAgents, sleep: async () => { slept++ } }))
ok('auto: label with no event after retries -> FAIL (could not judge), no writes, retried twice',
  r16b.code === 1 && /could not judge/.test(r16b.lines.join()) && a16b.writes.length === 0 && slept === 2)
let calls16c = 0
const a16c = gh({ labels: ['standard'], events: [], files: [{ filename: 'supabase/migrations/x.sql' }] })
const catchesUp = async (url, opts = {}) => {
  const r = await a16c.fetchImpl(url, opts)
  if ((opts.method ?? 'GET') === 'GET' && new URL(url).pathname.endsWith('/events') && ++calls16c > 1) {
    const evs = await r.json()
    return { ok: true, json: async () => [labeled('standard', BOT), ...evs] }
  }
  return r
}
const r16c = await quiet(() => main({ env: auto, fetchImpl: catchesUp, readAgents, sleep: async () => {} }))
ok('auto: events catch up on retry -> the bot label is upgraded', r16c.code === 0 && W(a16c.state) === W(['subtle-correctness']))
const a17 = gh({ files: [{ filename: 'src/a.js' }] })
const sneaky = async (url, opts = {}) => {
  // A concurrent run adds subtle-correctness between this run's read and its POST.
  if ((opts.method ?? 'GET') === 'POST') a17.state.push('subtle-correctness')
  return a17.fetchImpl(url, opts)
}
const r17 = await quiet(() => main({ env: auto, fetchImpl: sneaky, readAgents }))
ok('auto: judges the re-read labels (two present -> FAIL, not a stale pass)', r17.code === 1)

// Partial write failure: POST lands, DELETE fails (Codex review). The stale snapshot had one label.
const a18 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }] })
const delFails = async (url, opts = {}) =>
  (opts.method === 'DELETE') ? { ok: false, status: 503, json: async () => ({}) } : a18.fetchImpl(url, opts)
const r18 = await quiet(() => main({ env: auto, fetchImpl: delFails, readAgents }))
ok('auto: POST ok then DELETE 503 -> FAIL (could not judge)', r18.code === 1 && /could not judge/.test(r18.lines.join()))
// A refused upgrade must not pass on the old, too-low label (Codex review round 3).
const a19 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }], failWrites: true })
const r19 = await quiet(() => main({ env: auto, fetchImpl: a19.fetchImpl, readAgents }))
ok('auto: bot standard, upgrade POST refused -> FAIL, not a pass on standard', r19.code === 1 && W(a19.state) === W(['standard']))
// A person re-adds the label mid-run: the pending DELETE must not remove it (Codex review round 3).
// Simulated on the event log: once the bot's POST lands, alice removes and re-adds `standard`.
const a20 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }] })
let afterPost = false
const humanReaddsLog = async (url, opts = {}) => {
  const r = await a20.fetchImpl(url, opts)
  if (opts.method === 'POST') afterPost = true
  if (afterPost && (opts.method ?? 'GET') === 'GET' && new URL(url).pathname.endsWith('/events')) {
    const evs = await r.json()
    return { ok: true, json: async () => [...evs, labeled('standard', 'alice')] }
  }
  return r
}
const r20 = await quiet(() => main({ env: auto, fetchImpl: humanReaddsLog, readAgents }))
ok("auto: a person's re-add during the run is not deleted", a20.state.includes('standard') && !a20.writes.some((w) => w.startsWith('DELETE')) && r20.code === 1)
// Same, but the person's re-add lands AFTER the ownership re-read and before the DELETE (Codex round 4).
const a21 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }] })
let raced21 = false
const lateHuman = async (url, opts = {}) => {
  if (opts.method === 'DELETE' && !raced21) {
    raced21 = true
    // alice removes and re-adds `standard` in the gap; the label is present, the event log grows.
    a21.extraEvents = [labeled('standard', 'alice')]
  }
  const r = await a21.fetchImpl(url, opts)
  if (a21.extraEvents && (opts.method ?? 'GET') === 'GET' && new URL(url).pathname.endsWith('/events')) {
    const evs = await r.json()
    return { ok: true, json: async () => [...evs, ...a21.extraEvents] }
  }
  return r
}
const r21 = await quiet(() => main({ env: auto, fetchImpl: lateHuman, readAgents }))
ok("auto: a person's re-add racing the DELETE is restored",
  a21.state.includes('standard') && a21.writes.includes('POST  {"labels":["standard"]}') && /restored standard/.test(r21.lines.join()))
// The person's own queued run then settles it: their `standard` wins over the bot's upgrade.
const a21b = gh({ labels: ['subtle-correctness', 'standard'], events: [labeled('standard', BOT), labeled('subtle-correctness', BOT), labeled('standard', 'alice'), labeled('standard', BOT)] })
const r21b = await quiet(() => main({ env: auto, fetchImpl: a21b.fetchImpl, readAgents }))
ok("auto: ...and the person's queued run keeps their label", r21b.code === 0 && W(a21b.state) === W(['standard']))
// The race restore missed it (events lagged), so a person's label is absent while their claim
// stands. A later run must restore it and remove the bot's label beside it (Codex round 7).
const a24 = gh({ labels: ['subtle-correctness'], events: [labeled('standard', BOT), labeled('subtle-correctness', BOT), labeled('standard', 'alice'), unl0('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }] })
const r24 = await quiet(() => main({ env: auto, fetchImpl: a24.fetchImpl, readAgents }))
ok("auto: a person's label the bot removed is restored and wins, in one run",
  r24.code === 0 && W(a24.state) === W(['standard']) && /restored standard/.test(r24.lines.join()))
const a24b = gh({ labels: [], events: [labeled('mechanical', 'alice'), unl0('mechanical', BOT)], files: [{ filename: 'src/a.js' }] })
const r24b = await quiet(() => main({ env: auto, fetchImpl: a24b.fetchImpl, readAgents }))
ok('auto: bot-removed person label alone -> restored, passes', r24b.code === 0 && W(a24b.state) === W(['mechanical']))
const a24c = gh({ labels: [], events: [labeled('mechanical', 'alice'), unl0('mechanical', 'alice')], files: [{ filename: 'src/a.js' }] })
const r24c = await quiet(() => main({ env: auto, fetchImpl: a24c.fetchImpl, readAgents }))
ok("auto: a label the person removed is not restored (inferred instead)", r24c.code === 0 && W(a24c.state) === W(['standard']))
// The person's removal is on the labels endpoint but its event is not visible yet (Codex round 8):
// never resurrect it, fail closed after retries.
const a24d = gh({ labels: [], events: [labeled('mechanical', 'alice')], files: [{ filename: 'supabase/migrations/x.sql' }] })
const r24d = await quiet(() => main({ env: auto, fetchImpl: a24d.fetchImpl, readAgents, sleep: async () => {} }))
ok('auto: claimed label absent with no removal event -> FAIL (could not judge), nothing written',
  r24d.code === 1 && /could not judge/.test(r24d.lines.join()) && a24d.writes.length === 0)
function unl0(name, login) { return { event: 'unlabeled', label: { name }, actor: { login } } }

// A person's removal clears their claim: a later bot label is the bot's (Codex round 5).
const unl = (name, login) => ({ event: 'unlabeled', label: { name }, actor: { login } })
const a22 = gh({ labels: ['standard', 'mechanical'], events: [labeled('standard', 'alice'), unl('standard', 'alice'), labeled('standard', BOT), labeled('mechanical', 'alice')] })
const r22 = await quiet(() => main({ env: auto, fetchImpl: a22.fetchImpl, readAgents }))
ok("auto: person removed their label, bot re-applied it, person overrides -> bot's removed",
  r22.code === 0 && W(a22.state) === W(['mechanical']))
// The bot's own removal does not clear a person's claim (keeps the race restore theirs).
const a23 = gh({ labels: ['standard', 'subtle-correctness'], events: [labeled('standard', 'alice'), unl('standard', BOT), labeled('standard', BOT), labeled('subtle-correctness', BOT)] })
const r23 = await quiet(() => main({ env: auto, fetchImpl: a23.fetchImpl, readAgents }))
ok("auto: bot delete + restore of a person's label leaves it theirs", r23.code === 0 && W(a23.state) === W(['standard']))

// Gemini dispatch (issue #58): only when this run's bot applies subtle-correctness.
const gem = { ...auto, GEMINI_DISPATCH: 'true' }
const DISPATCH = 'POST /repos/o/r/actions/workflows/gemini-review.yml/dispatches {"ref":"main","inputs":{"pr_number":"1"}}'
const g1 = gh({ files: [{ filename: 'scripts/ci/x.mjs' }] })
const rg1 = await quiet(() => main({ env: gem, fetchImpl: g1.fetchImpl, readAgents }))
ok('gemini: bot applies subtle-correctness at open -> one dispatch on main with the PR number (204 handled)',
  rg1.code === 0 && W(g1.dispatches) === W([DISPATCH]) && /started gemini-review/.test(rg1.lines.join()))
const g2 = gh({ labels: ['standard'], events: [labeled('standard', BOT)], files: [{ filename: 'supabase/migrations/x.sql' }] })
const rg2 = await quiet(() => main({ env: gem, fetchImpl: g2.fetchImpl, readAgents }))
ok('gemini: bot upgrades its standard to subtle-correctness -> dispatches',
  rg2.code === 0 && W(g2.state) === W(['subtle-correctness']) && W(g2.dispatches) === W([DISPATCH]))
const g3 = gh({ files: [{ filename: 'src/a.js' }] })
await quiet(() => main({ env: gem, fetchImpl: g3.fetchImpl, readAgents }))
ok('gemini: bot applies standard -> no dispatch', W(g3.state) === W(['standard']) && g3.dispatches.length === 0)
const g4 = gh({ labels: ['subtle-correctness'], events: [labeled('subtle-correctness', BOT)], files: [{ filename: 'scripts/ci/x.mjs' }] })
await quiet(() => main({ env: gem, fetchImpl: g4.fetchImpl, readAgents }))
ok('gemini: bot subtle-correctness already there -> no dispatch (the run that applied it dispatched)', g4.dispatches.length === 0)
const g5 = gh({ labels: ['subtle-correctness'], events: [labeled('subtle-correctness', 'alice')] })
await quiet(() => main({ env: gem, fetchImpl: g5.fetchImpl, readAgents }))
ok("gemini: a person's subtle-correctness -> no dispatch (their labeled event runs Gemini)", g5.dispatches.length === 0)
const g5b = gh({ events: [labeled('subtle-correctness', 'alice'), unl('subtle-correctness', BOT)], files: [{ filename: 'scripts/ci/x.mjs' }] })
await quiet(() => main({ env: gem, fetchImpl: g5b.fetchImpl, readAgents }))
ok("gemini: restoring a person's raced subtle-correctness -> no dispatch", W(g5b.state) === W(['subtle-correctness']) && g5b.dispatches.length === 0)
const g6 = gh({ files: [{ filename: 'scripts/ci/x.mjs' }] })
await quiet(() => main({ env: auto, fetchImpl: g6.fetchImpl, readAgents }))
ok('gemini: no GEMINI_DISPATCH -> applies subtle-correctness, never dispatches', W(g6.state) === W(['subtle-correctness']) && g6.dispatches.length === 0)
const g7 = gh({ files: [{ filename: 'scripts/ci/x.mjs' }], dispatchStatus: 422 })
const rg7 = await quiet(() => main({ env: gem, fetchImpl: g7.fetchImpl, readAgents }))
ok('gemini: dispatch refused -> gate still passes, with a ::warning:: naming the status',
  rg7.code === 0 && g7.dispatches.length === 1 && /::warning::.*422/.test(rg7.lines.join()))
const g8 = gh({ files: [{ filename: 'scripts/ci/x.mjs' }], failWrites: true })
const rg8 = await quiet(() => main({ env: gem, fetchImpl: g8.fetchImpl, readAgents }))
ok('gemini: label write refused -> gate fails, no dispatch', rg8.code === 1 && g8.dispatches.length === 0)

// The dispatched run must execute main's YAML, never a branch's (decision 5 of gemini-review.yml).
const gyml = readFileSync(new URL('../../.github/workflows/gemini-review.yml', import.meta.url), 'utf8')
ok("gemini workflow: a dispatched run is gated on refs/heads/main",
  /\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\) \|\|/.test(gyml))
ok('gemini workflow: the PR number input is read through env, never expanded into a script',
  /INPUT_PR: \$\{\{ inputs\.pr_number \}\}/.test(gyml) && (gyml.match(/inputs\.pr_number/g) ?? []).length === 2)
const lyml = readFileSync(new URL('../../.github/workflows/label-gate.yml', import.meta.url), 'utf8')
ok('label-gate workflow: can dispatch, and only for same-repo non-Dependabot PRs into main',
  /^\s*actions: write\b/m.test(lyml) &&
  /GEMINI_DISPATCH: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name == github\.repository && github\.event\.pull_request\.user\.login != 'dependabot\[bot\]' && github\.event\.pull_request\.base\.ref == 'main' \}\}/.test(lyml))

// Labels belong to the PR, so runs for different heads must not overlap their writes (Codex review).
const yml = readFileSync(new URL('../../.github/workflows/label-gate.yml', import.meta.url), 'utf8')
ok('workflow: concurrency is per PR, not per head SHA, and queues',
  /^\s*group: label-gate-\$\{\{ github\.event\.pull_request\.number \}\}\s*$/m.test(yml) && /^\s*cancel-in-progress: false\s*$/m.test(yml))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
