// Screenshot comparison harness (portal v4 foundation plan, Task 1).
//
// Proves "zero pixel change": builds the app, screenshots every route and several modal states on FIXTURE
// data, and diffs two screenshot sets pixel by pixel.
//
//   node scripts/visual/compare.mjs build (--rev <ref> | --here) --out <dir>
//   node scripts/visual/compare.mjs capture --dist <dir> --out <dir> --brand current|v4 [--only id,id]
//   node scripts/visual/compare.mjs diff <dirA> <dirB>
//   node scripts/visual/compare.mjs serve --dist <dir> [--brand current|v4] [--signed-in]   (headed, manual)
//
// Each command exits 0 on success and 1 on failure.
//
// SAFETY. `vite dev` and `vite preview` proxy to production, so this tool never runs them. The app is built
// with VITE_SUPABASE_URL set to a fixture host that does not resolve, and every browser request goes through
// classifyRequest: only the fixture app, the fixture Supabase host, fonts, map tiles and a short list of
// third-party APIs are served, and each of those (apart from the app itself) is answered from fixtures,
// fonts included (fixtures/fonts.mjs). Anything else is aborted, recorded, and fails the run. This file
// imports nothing from src/.
//
// DETERMINISM. Two captures of one build must be byte-identical, or a diff proves nothing. That holds by
// construction, not by retrying: the page clock is paused and advanced in fixed steps; every fixture response
// is held and released one at a time in a fixed order, only while the page is quiet and never mid-step (pump,
// settle); readiness is a condition (nothing in flight, no DOM change, images and fonts done), never a sleep;
// and Chromium rasters whole tiles (CHROMIUM_ARGS). Each page is still shot twice in fresh contexts, and a
// difference fails the run loudly; that check is never retried. capture writes meta.json with the browser
// build, and diff refuses two sets taken with different builds.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as supabaseFixtures from './fixtures/supabase.mjs'
import * as apiFixtures from './fixtures/api.mjs'
import * as fontFixtures from './fixtures/fonts.mjs'

export const FIXTURE_SUPABASE_URL = 'https://fixture.supabase.invalid'
export const WIDTHS = [375, 1280]
const HEIGHTS = { 375: 812, 1280: 800 }
const FIXED_TIME = new Date('2026-11-20T12:00:00Z')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

// One entry per route in src/App.jsx, with fixture params.
export const ROUTES = [
  { id: 'map', path: '/' },
  { id: 'node', path: '/node/fixture-node-1' },
  { id: 'node-report', path: '/node/fixture-node-1/report/2026-11-20' },
  { id: 'species', path: '/species/American%20Robin' },
  { id: 'journal', path: '/journal/fixture' },
  { id: 'add-node', path: '/add-node' },
  { id: 'register', path: '/register' },
  { id: 'about', path: '/about' },
  { id: 'donate', path: '/donate' },
]

// Modal and menu states. `signedIn` is false (signed out), true (the listener `fixture`, who has a handle)
// or 'no-handle' (a signed-in listener with no handle yet). `act(page)` brings the state up; it only clicks
// (or runs the clock), and never waits for data, because responses are held until the harness pumps them
// (see pump). `shows(page)` is a locator that must match once the page has settled after `act`.
export const STATES = [
  {
    id: 'auth-modal', path: '/', signedIn: false,
    act: (page) => page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    shows: (page) => page.locator('input[type="email"]'),
  },
  {
    // Signed in, because a signed-out Listen opens AuthModal instead.
    id: 'listen-modal', path: '/', signedIn: true,
    act: (page) => page.getByRole('button', { name: 'Listen', exact: true }).first().click(),
    shows: (page) => page.getByText('Fixtureville'),
  },
  {
    id: 'share-sheet', path: '/node/fixture-node-1', signedIn: false,
    act: (page) => page.getByRole('button', { name: 'Share this detection' }).first().click(),
    shows: (page) => page.getByText('Download'),
  },
  {
    // DonatePrompt shows after a 60 s timer; the paused fake clock is run past it.
    id: 'donate-prompt', path: '/about', signedIn: false,
    act: (page) => page.clock.runFor(60000),
    shows: (page) => page.getByText('Finding this valuable?'),
  },
  {
    id: 'account-menu', path: '/', signedIn: true,
    act: (page) => page.getByRole('button', { name: 'Account menu' }).click(),
    shows: (page) => page.getByRole('menu'),
  },
  {
    id: 'profile-editor', path: '/', signedIn: true,
    async act(page) {
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menuitem', { name: 'Edit profile' }).click()
    },
    shows: (page) => page.getByText('Follows'),
  },
  {
    // A signed-in listener with no handle who tries to follow a journal: NodePage calls promptHandleClaim.
    id: 'handle-prompt', path: '/node/fixture-node-1', signedIn: 'no-handle',
    act: (page) => page.getByRole('button', { name: 'Follow Their Journal' }).click(),
    shows: (page) => page.getByText('Claim your field journal'),
  },
]

// Which kind of request is this? Anything that is not named here is 'blocked'.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
const TILE_HOSTS = ['tile.openstreetmap.org']
// Nominatim answers the Listen modal's place name. give.themethodproject.org serves DonatePage's donation
// widget script, which the fixtures answer with an empty script, so the page keeps its fallback link.
const EXTERNAL_FIXTURE_HOSTS = [
  'en.wikipedia.org', 'api.gbif.org', 'api.inaturalist.org', 'nominatim.openstreetmap.org', 'give.themethodproject.org',
]

const hostIs = (host, domain) => host === domain || host.endsWith(`.${domain}`)

export function classifyRequest(url, serverOrigin) {
  let u
  try { u = new URL(url) } catch { return 'blocked' }
  if (u.origin === serverOrigin) {
    return u.pathname === '/api' || u.pathname.startsWith('/api/') ? 'api' : 'app'
  }
  if (u.origin === FIXTURE_SUPABASE_URL) return 'supabase'
  if (u.protocol !== 'https:') return 'blocked'
  const host = u.hostname
  // GBIF serves both its JSON API and its density map tiles.
  if (host === 'api.gbif.org' && u.pathname.startsWith('/v2/map/')) return 'tile'
  if (FONT_HOSTS.some((d) => host === d)) return 'font'
  if (TILE_HOSTS.some((d) => hostIs(host, d))) return 'tile'
  if (EXTERNAL_FIXTURE_HOSTS.some((d) => host === d)) return 'external-fixture'
  return 'blocked'
}

// ---------------------------------------------------------------------------------------------- build

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw new Error(`${cmd} failed to launch: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`)
}

function fixtureEnv() {
  const env = { ...process.env, VITE_SUPABASE_URL: FIXTURE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'fixture' }
  return env
}

async function build({ rev, here, out }) {
  if (!out) throw new Error('build needs --out <dir>')
  if (Boolean(rev) === Boolean(here)) throw new Error('build needs exactly one of --rev <ref> or --here')
  const dist = path.resolve(out, 'dist')

  if (here) {
    fs.mkdirSync(path.resolve(out), { recursive: true })
    run('npm', ['run', 'build', '--', '--outDir', dist, '--emptyOutDir'], { cwd: REPO_ROOT, env: fixtureEnv() })
    return
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magora-visual-'))
  const wt = path.join(tmp, 'checkout')
  let added = false
  try {
    run('git', ['worktree', 'add', '--detach', wt, rev], { cwd: REPO_ROOT })
    added = true
    run('npm', ['ci'], { cwd: wt })
    run('npm', ['run', 'build'], { cwd: wt, env: fixtureEnv() })
    fs.rmSync(dist, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dist), { recursive: true })
    fs.cpSync(path.join(wt, 'dist'), dist, { recursive: true })
  } finally {
    // Remove only the worktree this run created, never anything else.
    if (added) spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: REPO_ROOT, stdio: 'inherit' })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------- capture

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}

// Static server with an SPA fallback to index.html, on 127.0.0.1 and a free port.
async function serveDist(dist) {
  const root = path.resolve(dist)
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`no index.html in ${root}`)
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.resolve(root, `.${pathname}`)
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

const TILE_PNG = fs.readFileSync(path.join(HERE, 'fixtures', 'tile.png'))

// Every response except the app's own files is held here until the harness releases it (see pump). The
// harness releases one at a time, in a fixed order, and only when the page is quiet; nothing is released while
// the virtual clock steps. So the page receives its data in the same order, at the same virtual time, on
// every run, however fast or slow the machine is.
//
// Why the order matters: MapPage re-fits its Leaflet map each time one more marker source arrives. A fit at
// the same zoom is an animated pan whose offset Leaflet truncates to whole pixels from wherever the map is at
// that moment, so the final view depends on which sources arrived together, and the markers can land a pixel
// apart (measured: map-375 differed by 589 px between two fresh contexts when sources arrived as they came).
export function requestKey({ method, url, postData }) {
  return `${method} ${url} ${postData || ''}`
}

function makeGate() {
  const held = []
  return {
    held,
    hold(entry) { return new Promise((resolve) => held.push({ ...entry, release: resolve })) },
    // Releases the held request whose key sorts first.
    releaseNext() {
      held.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
      held.shift().release()
    },
    count(type) { return held.filter((h) => h.type === type).length },
  }
}

// Routes every request of a context through classifyRequest. Returns the log it fills.
async function installRouting(context, { origin, brand, gate = null }) {
  const log = { blocked: [], v4Fonts: [], counts: {} }
  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const kind = classifyRequest(url, origin)
    log.counts[kind] = (log.counts[kind] || 0) + 1
    if (brand === 'current') {
      try { if (new URL(url).pathname.includes('/fonts/v4/')) log.v4Fonts.push(url) } catch { /* not a URL */ }
    }
    if (gate && kind !== 'app') {
      await gate.hold({ key: requestKey({ method: req.method(), url, postData: req.postData() }), type: req.resourceType() })
    }
    const fulfil = (r) => route.fulfill({ status: r.status, headers: r.headers, body: r.body })
    switch (kind) {
      case 'app':
        return route.continue()
      case 'font': {
        const r = fontFixtures.handle({ url })
        if (r) return fulfil(r)
        log.blocked.push(`${url} (font not in fixtures/fonts)`)
        return route.abort('blockedbyclient')
      }
      case 'supabase':
        return fulfil(supabaseFixtures.handle({ method: req.method(), url, headers: req.headers() }))
      case 'api':
      case 'external-fixture':
        return fulfil(apiFixtures.handle({ method: req.method(), url, headers: req.headers(), body: req.postData() }))
      case 'tile':
        return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG })
      default:
        log.blocked.push(url)
        return route.abort('blockedbyclient')
    }
  })
  return log
}

// Requests the browser has started and not finished, counted in Node.
function trackRequests(context) {
  const net = { inflight: new Set(), started: 0 }
  context.on('request', (r) => { net.inflight.add(r); net.started++ })
  context.on('requestfinished', (r) => net.inflight.delete(r))
  context.on('requestfailed', (r) => net.inflight.delete(r))
  return net
}

// The browser is always the headless Chromium build this Playwright version was released with
// (`npx playwright install chromium` fetches it); there is no override. Two capture sets are comparable only
// when one browser build took both, so capture records the build in meta.json and diff checks it.
export const META_FILE = 'meta.json'

// Chromium normally re-rasters only the part of a tile a change invalidated ("partial raster"), so the pixels
// of an unchanged element depend on which intermediate frames the compositor happened to draw. Measured
// 2026-11-21 on account-menu-1280: one anti-aliased pixel of the Leaflet zoom control's rounded corner came
// out one level apart in 6 of 59 fresh-context captures with partial raster on, and in 0 of 59 (0 of 79 under
// CPU load) with it off. Off, every tile is rastered whole, so the result depends only on the final page.
export const CHROMIUM_ARGS = ['--disable-partial-raster']

// What diff refuses to compare. Pure, for the tests: `a` and `b` are parsed meta.json contents or null.
export function metaProblems(a, b, nameA = 'A', nameB = 'B') {
  const problems = []
  if (!a) problems.push(`${nameA} has no ${META_FILE}; capture it again with this harness`)
  if (!b) problems.push(`${nameB} has no ${META_FILE}; capture it again with this harness`)
  if (problems.length) return problems
  for (const key of ['browser', 'browserVersion']) {
    if (typeof a[key] !== 'string' || !a[key]) problems.push(`${nameA} ${META_FILE} has no ${key}`)
    if (typeof b[key] !== 'string' || !b[key]) problems.push(`${nameB} ${META_FILE} has no ${key}`)
  }
  if (problems.length) return problems
  if (a.browser !== b.browser || a.browserVersion !== b.browserVersion) {
    problems.push(`browser differs: ${nameA} ${a.browser} ${a.browserVersion}, ${nameB} ${b.browser} ${b.browserVersion}`)
  }
  // Launch flags change rasterisation (CHROMIUM_ARGS), so they must match too.
  const args = (m) => JSON.stringify(m.args ?? [])
  if (args(a) !== args(b)) problems.push(`browser flags differ: ${nameA} ${args(a)}, ${nameB} ${args(b)}`)
  return problems
}

// The shot files a full capture writes, or a capture limited by --only. Sorted.
export function expectedShots(only) {
  const ids = [...ROUTES, ...STATES].map((it) => it.id).filter((id) => !only || only.includes(id))
  return ids.flatMap((id) => WIDTHS.map((w) => `${id}-${w}.png`)).sort()
}

// Whether one capture set covers what it must. Only a capture that succeeded writes `complete: true`, so a
// failed run can never be compared, even when another run failed on the same pages (Codex
// correctness--20cc322f8ca0--1 F1). The set's PNGs must be exactly the expected set for its --only subset.
// Pure, for the tests: `meta` is the parsed meta.json, `pngs` the PNG names in the directory.
export function coverageProblems(meta, pngs, name = 'set') {
  if (!meta || meta.complete !== true) return [`${name} is not a complete capture (its capture failed or was cut short); capture it again`]
  const expected = expectedShots(meta.only ?? null)
  const problems = []
  for (const f of expected) if (!pngs.includes(f) || !(meta.shots ?? []).includes(f)) problems.push(`${name} is missing ${f}`)
  for (const f of pngs) if (!expected.includes(f)) problems.push(`${name} has an unexpected ${f}`)
  return problems
}

// Two sets limited by different --only subsets cover different pages, so a diff of them proves nothing.
export function subsetProblems(a, b, nameA = 'A', nameB = 'B') {
  const subset = (m) => JSON.stringify(m?.only ? [...m.only].sort() : null)
  return subset(a) === subset(b) ? [] : [`${nameA} and ${nameB} were captured with different --only subsets: ${subset(a)}, ${subset(b)}`]
}

function readMeta(dir) {
  const file = path.join(dir, META_FILE)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// A seeded Math.random, so nothing that draws on it varies between runs.
const SEED_RANDOM = () => {
  let s = 0x9e3779b9
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// `animations: 'disabled'` at screenshot time does not stop an infinite CSS animation for good: the layer an
// animation promoted keeps rasterising differently from run to run. So no animation or transition ever runs.
const STOP_ANIMATIONS = () => {
  // Leaflet's documented switch: without 3D transforms it does not animate zooms.
  window.L_DISABLE_3D = true
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
}

// Counts DOM mutations, so the harness can tell when the page has stopped changing.
const COUNT_MUTATIONS = () => {
  window.__visualMutations = 0
  new MutationObserver((records) => { window.__visualMutations += records.length })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
}

// supabase-js reads its session from localStorage['sb-<first label of the host>-auth-token'].
const SEED_SESSION = (session) => {
  localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
}

function sessionFor(signedIn) {
  if (!signedIn) return null
  return supabaseFixtures.makeSession(signedIn === 'no-handle' ? supabaseFixtures.NO_HANDLE_USER : supabaseFixtures.HANDLE_USER)
}

async function addBrandCookie(context, origin, brand) {
  if (brand === 'v4') await context.addCookies([{ name: 'magora_brand', value: 'v4', url: origin }])
}

// One snapshot of everything that can still change the page. Before reading, it lets every task already
// queued run: React schedules its renders and effects as MessageChannel tasks, which run in order, so a few
// round trips through a MessageChannel drain work that a response or a click queued.
async function pageSnapshot(page) {
  return page.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => {
        const ch = new MessageChannel()
        ch.port1.onmessage = () => resolve()
        ch.port2.postMessage(null)
      })
    }
    return {
      mutations: window.__visualMutations,
      images: [...document.images].filter((img) => !img.complete).length,
      fonts: document.fonts.status,
      ready: document.readyState,
    }
  })
}

// With the clock paused, releases held responses one at a time until none is left and the page is quiet:
// no request in flight that is not held, no image still decoding except those whose response is held, no
// font loading unless a font response is held, and three snapshots in a row with no DOM change and no new
// request. Each of these is a condition, not a delay: under load it simply takes longer. It fails loudly
// rather than give up.
const QUIET_SNAPSHOTS = 3
const QUIET_TIMEOUT_MS = 30000
async function pump(page, net, gate, label) {
  const deadline = Date.now() + QUIET_TIMEOUT_MS
  let previous = null
  let streak = 0
  for (;;) {
    const s = await pageSnapshot(page)
    const key = `${s.mutations}|${net.started}|${gate.held.length}`
    const quiet = net.inflight.size === gate.held.length
      && s.images <= gate.count('image')
      && (s.fonts === 'loaded' || gate.count('font') > 0)
    streak = quiet && key === previous ? streak + 1 : 0
    previous = key
    if (streak >= QUIET_SNAPSHOTS - 1) {
      if (gate.held.length === 0) {
        if (s.ready === 'complete') return s
      } else {
        gate.releaseNext()
        streak = 0
        previous = null
        continue
      }
    }
    if (Date.now() > deadline) {
      const pending = [...net.inflight].map((r) => r.url()).join(', ')
      throw new Error(`${label}: the page never went quiet (requests in flight or held: ${pending || 'none'}; `
        + `images loading: ${s.images}; fonts: ${s.fonts}; document: ${s.ready})`)
    }
  }
}

// The page's clock is Playwright's fake clock, installed at FIXED_TIME and PAUSED: no timer, interval or
// animation frame runs unless the harness advances it. settle() advances it in fixed steps and pumps the
// held responses between steps, never during one. So every capture of a page sees the same events in the
// same virtual order and ends at the same virtual time. Leaflet's pan animation and tile fade, and React
// effects that wait on a timer, all run on that virtual time, so they always finish within the steps.
// SETTLE_MS is far below the shortest app timer that would change a page (DonatePrompt's 60 s; the 30 s
// refetch intervals), and the same for every page, so no page sees a different "now".
const STEP_MS = 100
const SETTLE_MS = 3000
const VERIFY_MS = 1000
async function settle(page, net, gate, label) {
  await pump(page, net, gate, `${label} (before the clock runs)`)
  for (let t = 0; t < SETTLE_MS; t += STEP_MS) {
    await page.clock.runFor(STEP_MS)
    await pump(page, net, gate, `${label} (at +${t + STEP_MS} ms)`)
  }
}

// After settling, a further VERIFY_MS of virtual time must change nothing: no DOM mutation and no request.
// A page that fails this is still animating or still loading, and the capture fails loudly instead of
// shooting it.
async function verifyStill(page, net, gate, label) {
  const before = await pump(page, net, gate, `${label} (verify)`)
  const started = net.started
  await page.clock.runFor(VERIFY_MS)
  const after = await pump(page, net, gate, `${label} (verify)`)
  if (after.mutations !== before.mutations || net.started !== started) {
    throw new Error(`${label}: the page still changed after settling (${after.mutations - before.mutations} DOM `
      + `mutations, ${net.started - started} requests in ${VERIFY_MS} ms of page time)`)
  }
  if (after.images || after.fonts !== 'loaded') throw new Error(`${label}: images or fonts still loading after settling`)
  const loading = await page.evaluate(() => (document.body.innerText.match(/Loading|Gathering the record|Looking around/) || [])[0])
  if (loading) throw new Error(`${label}: the page still shows "${loading}" after settling`)
  const tiles = await page.evaluate(() => document.querySelectorAll('.leaflet-tile:not(.leaflet-tile-loaded)').length)
  if (tiles) throw new Error(`${label}: ${tiles} map tiles are not loaded after settling`)
}

// One capture of one page at one width, in a fresh browser context.
async function shootOnce(browser, { origin, brand, item, width, file }) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: 40.01, longitude: -105.27 },
  })
  const gate = makeGate()
  const log = await installRouting(context, { origin, brand, gate })
  const net = trackRequests(context)
  const errors = []
  try {
    await addBrandCookie(context, origin, brand)
    await context.addInitScript(SEED_RANDOM)
    await context.addInitScript(STOP_ANIMATIONS)
    await context.addInitScript(COUNT_MUTATIONS)
    const session = sessionFor(item.signedIn)
    if (session) await context.addInitScript(SEED_SESSION, session)
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.clock.install({ time: FIXED_TIME })
    await page.clock.pauseAt(FIXED_TIME)
    // 'commit': the load event cannot come until pump releases the held stylesheets, fonts and data.
    await page.goto(origin + item.path, { waitUntil: 'commit' })
    await settle(page, net, gate, file)
    if (item.act) {
      await item.act(page)
      await settle(page, net, gate, `${file} after ${item.id}`)
      if (await item.shows(page).count() === 0) throw new Error(`${file}: ${item.id} did not come up`)
    }
    await verifyStill(page, net, gate, file)
    const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })
    return { png, blocked: log.blocked, v4Fonts: log.v4Fonts, errors }
  } finally {
    await context.close()
  }
}

// The routes and states a capture shoots: all of them, or those --only names. Throws on an id that is
// neither, so a typo is refused before capture deletes anything.
export function selectItems(only) {
  const items = [
    ...ROUTES.map((r) => ({ id: r.id, path: r.path, signedIn: false, act: null })),
    ...STATES,
  ].filter((it) => !only || only.includes(it.id))
  const unknownIds = (only ?? []).filter((id) => !items.some((it) => it.id === id))
  if (unknownIds.length) throw new Error(`--only names an unknown id: ${unknownIds.join(',')}`)
  return items
}

export async function capture({ dist, out, brand, only }) {
  if (!dist || !out) throw new Error('capture needs --dist <dir> and --out <dir>')
  if (brand !== 'current' && brand !== 'v4') throw new Error('capture needs --brand current|v4')
  // Before the output directory is touched: a mistyped --only must not delete an existing set.
  const items = selectItems(only)
  const { chromium } = await import('playwright')
  const outDir = path.resolve(out)
  const unstableDir = path.join(outDir, 'unstable')
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png') || f === META_FILE) fs.rmSync(path.join(outDir, f))
  fs.rmSync(unstableDir, { recursive: true, force: true })

  const { server, origin } = await serveDist(dist)
  const browser = await chromium.launch({ args: CHROMIUM_ARGS })
  const meta = {
    browser: browser.browserType().name(),
    browserVersion: browser.version(),
    playwright: createRequire(import.meta.url)('playwright/package.json').version,
    args: CHROMIUM_ARGS,
    brand,
  }
  console.log(`browser: ${meta.browser} ${meta.browserVersion} (Playwright ${meta.playwright})`)
  const started = Date.now()
  const failures = []
  const blocked = []
  let shots = 0
  try {
    for (const item of items) {
      for (const width of WIDTHS) {
        const file = `${item.id}-${width}.png`
        try {
          // Every page is shot twice, each time in a fresh context. The two must be byte-identical. This is a
          // check, not a retry: a difference fails the run and keeps both shots in unstable/ to look at.
          const shotsOf = []
          for (let n = 0; n < 2; n++) {
            const r = await shootOnce(browser, { origin, brand, item, width, file })
            blocked.push(...r.blocked.map((u) => `${file}: ${u}`))
            if (r.v4Fonts.length) failures.push(`${file}: --brand current requested /fonts/v4/: ${r.v4Fonts.join(', ')}`)
            // A page error fails the shot: a route that throws can render the same empty or fallback state
            // in both revisions and still compare equal.
            for (const e of r.errors) failures.push(`${file}: page error: ${e}`)
            shotsOf.push(r.png)
          }
          if (!shotsOf[0].equals(shotsOf[1])) {
            fs.mkdirSync(unstableDir, { recursive: true })
            shotsOf.forEach((png, n) => fs.writeFileSync(path.join(unstableDir, file.replace(/\.png$/, `.${n + 1}.png`)), png))
            throw new Error(`two captures in fresh contexts differ; both are in ${unstableDir}`)
          }
          fs.writeFileSync(path.join(outDir, file), shotsOf[0])
          shots++
          console.log(`captured ${file}`)
        } catch (e) {
          failures.push(`${file}: ${e.message.split('\n')[0]}`)
        }
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
  const unknownFixtures = [...supabaseFixtures.unknown, ...apiFixtures.unknown]
  // An unanswered request fails the run (Review Focus 1): the fixtures answer it with an empty result or a
  // 404, so both revisions could render the same empty state and compare equal.
  if (unknownFixtures.length) failures.push(`unanswered fixture requests:\n  ${unknownFixtures.join('\n  ')}`)
  if (blocked.length) failures.push(`blocked requests:\n  ${blocked.join('\n  ')}`)
  const seconds = Math.round((Date.now() - started) / 1000)
  if (failures.length) {
    console.error(`capture FAILED (${shots} of ${items.length * WIDTHS.length} shots, ${seconds} s):\n${failures.join('\n')}`)
    return false
  }
  // meta.json is written last, and only after a fully successful run, so diff can tell a complete set from a
  // failed one. The stale meta.json was deleted at the start of the run.
  const written = fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort()
  const full = { ...meta, complete: true, only: only ?? null, shots: written }
  const problems = coverageProblems(full, written, outDir)
  if (problems.length) {
    console.error(`capture FAILED: ${problems.join('; ')}`)
    return false
  }
  fs.writeFileSync(path.join(outDir, META_FILE), `${JSON.stringify(full, null, 2)}\n`)
  console.log(`capture ok: ${shots} shots in ${outDir} (${seconds} s)`)
  return true
}

// ---------------------------------------------------------------------------------------------- serve

async function serve({ dist, brand = 'current', signedIn }) {
  if (!dist) throw new Error('serve needs --dist <dir>')
  const { chromium } = await import('playwright')
  const { server, origin } = await serveDist(dist)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: null, locale: 'en-US', serviceWorkers: 'block',
    permissions: ['geolocation'], geolocation: { latitude: 40.01, longitude: -105.27 },
  })
  const log = await installRouting(context, { origin, brand })
  await addBrandCookie(context, origin, brand)
  const session = sessionFor(signedIn ? true : false)
  if (session) await context.addInitScript(SEED_SESSION, session)
  const page = await context.newPage()
  page.on('requestfailed', (r) => { if (log.blocked.includes(r.url())) console.warn(`blocked: ${r.url()}`) })
  await page.goto(origin + '/')
  console.log(`serving ${dist} at ${origin}; close the window to stop`)
  await new Promise((resolve) => browser.on('disconnected', resolve))
  server.close()
  // As in capture: a request the fixtures did not answer fails the session.
  const unknownFixtures = [...supabaseFixtures.unknown, ...apiFixtures.unknown]
  if (unknownFixtures.length) console.error(`unanswered fixture requests:\n  ${unknownFixtures.join('\n  ')}`)
  return log.blocked.length === 0 && log.v4Fonts.length === 0 && unknownFixtures.length === 0
}

// ---------------------------------------------------------------------------------------------- diff

async function diff(dirA, dirB) {
  if (!dirA || !dirB) throw new Error('diff needs <dirA> <dirB>')
  // Screenshots from two browser builds differ in text rendering for reasons unrelated to the app, so
  // comparing them would prove nothing either way. Refuse.
  const list = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort()
  const a = list(dirA)
  const b = list(dirB)
  const metaA = readMeta(dirA)
  const metaB = readMeta(dirB)
  const problems = metaProblems(metaA, metaB, dirA, dirB)
  if (!problems.length) {
    problems.push(...coverageProblems(metaA, a, dirA), ...coverageProblems(metaB, b, dirB), ...subsetProblems(metaA, metaB, dirA, dirB))
  }
  if (problems.length) {
    for (const p of problems) console.log(`refusing to compare: ${p}`)
    return false
  }
  let ok = true
  for (const f of a) if (!b.includes(f)) { console.log(`only in ${dirA}: ${f}`); ok = false }
  for (const f of b) if (!a.includes(f)) { console.log(`only in ${dirB}: ${f}`); ok = false }
  if (a.length === 0) { console.log(`no PNGs in ${dirA}`); ok = false }

  let browser = null
  let page = null
  try {
    for (const f of a.filter((n) => b.includes(n))) {
      const bufA = fs.readFileSync(path.join(dirA, f))
      const bufB = fs.readFileSync(path.join(dirB, f))
      if (bufA.equals(bufB)) { console.log(`ok ${f}`); continue }
      if (!page) {
        const { chromium } = await import('playwright')
        browser = await chromium.launch()
        page = await browser.newPage()
      }
      // Decode both in a canvas and count the pixels where any channel differs.
      const result = await page.evaluate(async ([x, y]) => {
        const load = async (b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          const c = new OffscreenCanvas(bmp.width, bmp.height)
          const ctx = c.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(bmp, 0, 0)
          return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
        }
        const A = await load(x)
        const B = await load(y)
        if (A.w !== B.w || A.h !== B.h) return { size: `${A.w}x${A.h} vs ${B.w}x${B.h}` }
        let n = 0
        for (let i = 0; i < A.data.length; i += 4) {
          if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1]
            || A.data[i + 2] !== B.data[i + 2] || A.data[i + 3] !== B.data[i + 3]) n++
        }
        return { n }
      }, [bufA.toString('base64'), bufB.toString('base64')])
      if (result.size) { console.log(`size differs (${result.size}) ${f}`); ok = false }
      else if (result.n === 0) console.log(`ok ${f}`)
      else { console.log(`${result.n} px differ ${f}`); ok = false }
    }
  } finally {
    if (browser) await browser.close()
  }
  return ok
}

// ---------------------------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (!t.startsWith('--')) { positional.push(t); continue }
    const name = t.slice(2)
    if (['here', 'signed-in'].includes(name)) flags[name] = true
    else flags[name] = argv[++i]
  }
  return { flags, positional }
}

async function main(argv) {
  const [command, ...rest] = argv
  const { flags, positional } = parseArgs(rest)
  switch (command) {
    case 'build':
      await build({ rev: flags.rev, here: flags.here, out: flags.out })
      return true
    case 'capture':
      return capture({ dist: flags.dist, out: flags.out, brand: flags.brand, only: flags.only?.split(',') })
    case 'diff':
      return diff(positional[0], positional[1])
    case 'serve':
      return serve({ dist: flags.dist, brand: flags.brand, signedIn: flags['signed-in'] })
    default:
      throw new Error('usage: compare.mjs build|capture|diff|serve ... (see the header of this file)')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => { console.error(e.message); process.exit(1) },
  )
}
