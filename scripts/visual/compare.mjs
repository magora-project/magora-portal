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
// third-party APIs are served, and each of those (apart from the app and fonts) is answered from fixtures.
// Anything else is aborted, recorded, and fails the run. This file imports nothing from src/.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as supabaseFixtures from './fixtures/supabase.mjs'
import * as apiFixtures from './fixtures/api.mjs'

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
// or 'no-handle' (a signed-in listener with no handle yet). `act(page)` brings the state up.
export const STATES = [
  {
    id: 'auth-modal', path: '/', signedIn: false,
    async act(page) {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.locator('input[type="email"]').waitFor()
    },
  },
  {
    // Signed in, because a signed-out Listen opens AuthModal instead.
    id: 'listen-modal', path: '/', signedIn: true,
    async act(page) {
      await page.getByRole('button', { name: 'Listen', exact: true }).first().click()
      await page.getByText('Fixtureville').waitFor()
    },
  },
  {
    id: 'share-sheet', path: '/node/fixture-node-1', signedIn: false,
    async act(page) {
      await page.getByRole('button', { name: 'Share this detection' }).first().click()
      await page.getByText('Download').first().waitFor()
    },
  },
  {
    // DonatePrompt shows after a 60 s timer; the fake clock runs it at once.
    id: 'donate-prompt', path: '/about', signedIn: false,
    async act(page) {
      await page.clock.runFor(60000)
      await page.getByText('Finding this valuable?').waitFor()
    },
  },
  {
    id: 'account-menu', path: '/', signedIn: true,
    async act(page) {
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menu').waitFor()
    },
  },
  {
    id: 'profile-editor', path: '/', signedIn: true,
    async act(page) {
      await page.getByRole('button', { name: 'Account menu' }).click()
      await page.getByRole('menuitem', { name: 'Edit profile' }).click()
      await page.getByText('Follows').first().waitFor()
    },
  },
  {
    // A signed-in listener with no handle who tries to follow a journal: NodePage calls promptHandleClaim.
    id: 'handle-prompt', path: '/node/fixture-node-1', signedIn: 'no-handle',
    async act(page) {
      await page.getByRole('button', { name: 'Follow Their Journal' }).click()
      await page.getByText('Claim your field journal').waitFor()
    },
  },
]

// Which kind of request is this? Anything that is not named here is 'blocked'.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com']
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

// MapPage re-fits its map every time one more source of markers arrives, and Leaflet animates each fit. If
// the sources land close together the animations interrupt each other and the final view moves by a few
// pixels from run to run, so the sources that feed the map's markers are answered in a fixed order, far
// enough apart for each animation to finish.
const STAGGER_MS = { public_mobile_detections: 700, public_listen_sessions: 1400 }
function staggerMs(url) {
  const table = new URL(url).pathname.match(/^\/rest\/v1\/([^/]+)/)?.[1]
  return STAGGER_MS[table] ?? 0
}

// Routes every request of a context through classifyRequest. Returns the log it fills.
async function installRouting(context, { origin, brand }) {
  const log = { blocked: [], v4Fonts: [], counts: {} }
  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    const kind = classifyRequest(url, origin)
    log.counts[kind] = (log.counts[kind] || 0) + 1
    if (brand === 'current') {
      try { if (new URL(url).pathname.includes('/fonts/v4/')) log.v4Fonts.push(url) } catch { /* not a URL */ }
    }
    const fulfil = (r) => route.fulfill({ status: r.status, headers: r.headers, body: r.body })
    switch (kind) {
      case 'app':
      case 'font':
        return route.continue()
      case 'supabase':
        await new Promise((resolve) => setTimeout(resolve, staggerMs(url)))
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

// Chromium's launch options. Playwright finds its own browser; MAGORA_VISUAL_CHROMIUM names another
// executable when the one this Playwright version wants is not installed. Compare runs only against
// screenshots taken with the same browser build.
function launchOptions(extra = {}) {
  const executablePath = process.env.MAGORA_VISUAL_CHROMIUM
  return executablePath ? { executablePath, ...extra } : extra
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
  // Leaflet's documented switch: without 3D transforms it does not animate zooms, whose end state
  // otherwise comes out a pixel apart from run to run.
  window.L_DISABLE_3D = true
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
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

async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(
    () => !/Loading|Gathering the record|Looking around/.test(document.body.innerText),
    null, { timeout: 15000, polling: 100 },
  )
  // Leaflet pans and zooms to fit its markers once data arrives, and has no "animation done" signal.
  await page.waitForTimeout(1800)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

// Rendering is not always finished when the network and fonts are: under load, text and map layers can
// still be rastering. Shoot until two shots in a row are byte-identical, and fail if that never happens.
async function stableScreenshot(page) {
  const shoot = () => page.screenshot({ fullPage: true, animations: 'disabled' })
  let previous = await shoot()
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(500)
    const next = await shoot()
    if (next.equals(previous)) return next
    previous = next
  }
  throw new Error('the page never stopped changing between screenshots')
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
  const log = await installRouting(context, { origin, brand })
  try {
    await addBrandCookie(context, origin, brand)
    await context.addInitScript(SEED_RANDOM)
    await context.addInitScript(STOP_ANIMATIONS)
    const session = sessionFor(item.signedIn)
    if (session) await context.addInitScript(SEED_SESSION, session)
    const page = await context.newPage()
    page.on('pageerror', (e) => console.warn(`  [${file}] page error: ${e.message}`))
    // The clock starts at FIXED_TIME and then runs, because freezing Date stops Leaflet's pan animation
    // part-way. Fixture times sit whole minutes from FIXED_TIME, so the seconds a capture takes cannot
    // change a relative time ("35 min ago").
    await page.clock.install({ time: FIXED_TIME })
    await page.goto(origin + item.path, { waitUntil: 'networkidle' })
    await settle(page)
    if (item.act) {
      await item.act(page)
      await settle(page)
    }
    return { png: await stableScreenshot(page), blocked: log.blocked, v4Fonts: log.v4Fonts }
  } finally {
    await context.close()
  }
}

async function capture({ dist, out, brand, only }) {
  if (!dist || !out) throw new Error('capture needs --dist <dir> and --out <dir>')
  if (brand !== 'current' && brand !== 'v4') throw new Error('capture needs --brand current|v4')
  const { chromium } = await import('playwright')
  const outDir = path.resolve(out)
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png')) fs.rmSync(path.join(outDir, f))

  const items = [
    ...ROUTES.map((r) => ({ id: r.id, path: r.path, signedIn: false, act: null })),
    ...STATES,
  ].filter((it) => !only || only.includes(it.id))
  if (only && items.length !== only.length) throw new Error(`--only names an unknown id: ${only.join(',')}`)

  const { server, origin } = await serveDist(dist)
  const browser = await chromium.launch(launchOptions())
  const failures = []
  const blocked = []
  let shots = 0
  try {
    for (const item of items) {
      for (const width of WIDTHS) {
        const file = `${item.id}-${width}.png`
        try {
          // A page is shot in fresh contexts until two in a row are byte-identical. A single capture
          // occasionally lands a pixel off (a Leaflet marker, a glyph) for no reason a wait can see.
          let previous = null
          let png = null
          for (let attempt = 0; attempt < 4 && !png; attempt++) {
            const r = await shootOnce(browser, { origin, brand, item, width, file })
            blocked.push(...r.blocked.map((u) => `${file}: ${u}`))
            if (r.v4Fonts.length) failures.push(`${file}: --brand current requested /fonts/v4/: ${r.v4Fonts.join(', ')}`)
            if (previous && previous.equals(r.png)) png = r.png
            previous = r.png
          }
          if (!png) throw new Error('four captures in a row never produced two identical ones')
          fs.writeFileSync(path.join(outDir, file), png)
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
  if (unknownFixtures.length) console.log(`unanswered fixture requests:\n  ${unknownFixtures.join('\n  ')}`)
  if (blocked.length) failures.push(`blocked requests:\n  ${blocked.join('\n  ')}`)
  if (failures.length) {
    console.error(`capture FAILED (${shots} of ${items.length * WIDTHS.length} shots):\n${failures.join('\n')}`)
    return false
  }
  console.log(`capture ok: ${shots} shots in ${outDir}`)
  return true
}

// ---------------------------------------------------------------------------------------------- serve

async function serve({ dist, brand = 'current', signedIn }) {
  if (!dist) throw new Error('serve needs --dist <dir>')
  const { chromium } = await import('playwright')
  const { server, origin } = await serveDist(dist)
  const browser = await chromium.launch(launchOptions({ headless: false }))
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
  return log.blocked.length === 0 && log.v4Fonts.length === 0
}

// ---------------------------------------------------------------------------------------------- diff

async function diff(dirA, dirB) {
  if (!dirA || !dirB) throw new Error('diff needs <dirA> <dirB>')
  const list = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort()
  const a = list(dirA)
  const b = list(dirB)
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
        browser = await chromium.launch(launchOptions())
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
