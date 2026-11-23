// Tests for the screenshot comparison harness (scripts/visual/compare.mjs). They cover the request
// classifier, the one thing that keeps a capture run off production; the route, state and width tables;
// diff's refusal to compare two browser builds; the held-response order; and the font fixtures.
// Run: node scripts/visual/compare.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  capture, classifyRequest, coverageProblems, expectedShots, FIXTURE_SUPABASE_URL, metaProblems, requestKey, ROUTES,
  selectItems, STATES, subsetProblems, WIDTHS,
} from './compare.mjs'
import * as apiFixtures from './fixtures/api.mjs'
import * as fontFixtures from './fixtures/fonts.mjs'

const ORIGIN = 'http://127.0.0.1:4173'

test('production and unknown hosts are blocked', () => {
  assert.equal(classifyRequest('https://abcd.supabase.co/rest/v1/nodes', ORIGIN), 'blocked')
  assert.equal(classifyRequest('https://magora-portal.vercel.app/api/insight', ORIGIN), 'blocked')
  assert.equal(classifyRequest('https://example.com/x.js', ORIGIN), 'blocked')
})

test('fixture routes are classified', () => {
  assert.equal(classifyRequest(`${FIXTURE_SUPABASE_URL}/rest/v1/nodes?select=*`, ORIGIN), 'supabase')
  assert.equal(classifyRequest(`${ORIGIN}/api/insight`, ORIGIN), 'api')
  assert.equal(classifyRequest(`${ORIGIN}/assets/index.js`, ORIGIN), 'app')
  assert.equal(classifyRequest('https://fonts.gstatic.com/s/dmsans/v1/a.woff2', ORIGIN), 'font')
  assert.equal(classifyRequest('https://a.tile.openstreetmap.org/3/1/2.png', ORIGIN), 'tile')
  // The app no longer uses CARTO tiles, so a request for one fails the run.
  assert.equal(classifyRequest('https://a.basemaps.cartocdn.com/light_all/3/1/2.png', ORIGIN), 'blocked')
  assert.equal(classifyRequest('https://en.wikipedia.org/api/rest_v1/page/summary/X', ORIGIN), 'external-fixture')
})

test('ROUTES covers the nine spec routes at both widths', () => {
  assert.equal(ROUTES.length, 9)
  assert.deepEqual(WIDTHS, [375, 1280])
})

test('the tile hosts the app uses are tiles, not blocked', () => {
  assert.equal(classifyRequest('https://a.tile.openstreetmap.org/5/7/11.png', ORIGIN), 'tile')
  assert.equal(classifyRequest('https://api.gbif.org/v2/map/occurrence/density/2/1/1@1x.png?taxonKey=1', ORIGIN), 'tile')
  assert.equal(classifyRequest('https://api.gbif.org/v1/species/match?name=X', ORIGIN), 'external-fixture')
  assert.equal(classifyRequest('https://api.inaturalist.org/v1/x', ORIGIN), 'external-fixture')
  assert.equal(classifyRequest('https://nominatim.openstreetmap.org/reverse?lat=1', ORIGIN), 'external-fixture')
  assert.equal(classifyRequest('https://give.themethodproject.org/widget/v1.js', ORIGIN), 'external-fixture')
})

test('lookalike hosts and origins are blocked', () => {
  assert.equal(classifyRequest('https://fixture.supabase.invalid.evil.com/rest/v1/x', ORIGIN), 'blocked')
  assert.equal(classifyRequest('http://127.0.0.1:9999/api/insight', ORIGIN), 'blocked')
  assert.equal(classifyRequest('https://fonts.gstatic.com.evil.com/a.woff2', ORIGIN), 'blocked')
  assert.equal(classifyRequest('not a url', ORIGIN), 'blocked')
})

test('STATES has the seven spec ids', () => {
  assert.deepEqual(STATES.map((s) => s.id), [
    'auth-modal', 'listen-modal', 'share-sheet', 'donate-prompt', 'account-menu', 'profile-editor', 'handle-prompt',
  ])
})

test('every state brings itself up with act and says what must show', () => {
  for (const s of STATES) {
    assert.equal(typeof s.act, 'function', s.id)
    assert.equal(typeof s.shows, 'function', s.id)
  }
})

const META = { browser: 'chromium', browserVersion: '156.0.8078.4' }

test('diff accepts two sets taken with one browser build', () => {
  assert.deepEqual(metaProblems(META, { ...META, brand: 'v4' }), [])
})

test('diff refuses two sets taken with different browser builds', () => {
  const p = metaProblems(META, { ...META, browserVersion: '157.0.1.0' }, 'base', 'head')
  assert.equal(p.length, 1)
  assert.match(p[0], /browser differs: base chromium 156\.0\.8078\.4, head chromium 157\.0\.1\.0/)
  assert.equal(metaProblems(META, { ...META, browser: 'firefox' }).length, 1)
})

test('diff refuses two sets taken with different browser flags', () => {
  const p = metaProblems({ ...META, args: ['--disable-partial-raster'] }, META, 'base', 'head')
  assert.equal(p.length, 1)
  assert.match(p[0], /browser flags differ/)
  assert.deepEqual(metaProblems({ ...META, args: ['--x'] }, { ...META, args: ['--x'] }), [])
})

test('diff refuses a set with no or incomplete meta.json', () => {
  assert.match(metaProblems(null, META, 'base', 'head')[0], /base has no meta\.json/)
  assert.match(metaProblems(META, null, 'base', 'head')[0], /head has no meta\.json/)
  assert.match(metaProblems(META, { browser: 'chromium' }, 'base', 'head')[0], /head meta\.json has no browserVersion/)
  assert.match(metaProblems({ browserVersion: '1' }, META, 'base', 'head')[0], /base meta\.json has no browser/)
})

// Codex correctness--20cc322f8ca0--1 F1: a failed capture must never pass diff with coverage missing.
const FULL = expectedShots(null)

test('expectedShots is every route and state at both widths', () => {
  assert.equal(FULL.length, (ROUTES.length + STATES.length) * WIDTHS.length)
  assert.ok(FULL.includes('map-375.png') && FULL.includes('handle-prompt-1280.png'))
  assert.deepEqual(expectedShots(['about']), ['about-1280.png', 'about-375.png'])
})

test('a complete set whose PNGs match its meta has no coverage problem', () => {
  assert.deepEqual(coverageProblems({ complete: true, only: null, shots: FULL }, FULL, 'base'), [])
})

test('an incomplete capture is refused', () => {
  const p = coverageProblems({ complete: false, only: null, shots: FULL }, FULL, 'base')
  assert.match(p.join('\n'), /base is not a complete capture/)
  assert.match(coverageProblems({ only: null, shots: FULL }, FULL, 'base').join('\n'), /not a complete capture/)
})

test('a missing or extra PNG is refused', () => {
  const missing = coverageProblems({ complete: true, only: null, shots: FULL }, FULL.slice(1), 'head')
  assert.match(missing.join('\n'), new RegExp(`head is missing ${FULL[0].replace('.', '\\.')}`))
  const extra = coverageProblems({ complete: true, only: null, shots: FULL }, [...FULL, 'stray-375.png'], 'head')
  assert.match(extra.join('\n'), /head has an unexpected stray-375\.png/)
})

test('a meta shot list short of the full set is refused', () => {
  const short = FULL.slice(2)
  assert.match(coverageProblems({ complete: true, only: null, shots: short }, short, 'head').join('\n'), /head is missing/)
})

test('two sets captured with different --only subsets are refused', () => {
  assert.match(subsetProblems({ only: ['about'] }, { only: null }, 'base', 'head').join('\n'), /different --only/)
  assert.match(subsetProblems({ only: ['about'] }, { only: ['donate'] }, 'base', 'head').join('\n'), /different --only/)
  assert.deepEqual(subsetProblems({ only: ['about'] }, { only: ['about'] }), [])
  assert.deepEqual(subsetProblems({ only: null }, {}), [])
})

test('requestKey orders held requests by method, URL and body', () => {
  const keys = [
    { method: 'GET', url: 'https://fixture.supabase.invalid/rest/v1/nodes' },
    { method: 'GET', url: 'https://fixture.supabase.invalid/rest/v1/aci_logs' },
    { method: 'POST', url: 'https://fixture.supabase.invalid/rest/v1/rpc/x', postData: '{"a":1}' },
  ].map(requestKey).sort()
  assert.deepEqual(keys, [
    'GET https://fixture.supabase.invalid/rest/v1/aci_logs ',
    'GET https://fixture.supabase.invalid/rest/v1/nodes ',
    'POST https://fixture.supabase.invalid/rest/v1/rpc/x {"a":1}',
  ])
})

test('Google Fonts are answered from fixtures, and an unknown font URL is not', () => {
  const css = fontFixtures.handle({ url: 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&display=swap' })
  assert.equal(css.status, 200)
  // Every file the saved stylesheets name is saved too, and none is the l/font?kit variant.
  for (const sheet of ['css2-site.css', 'css2-big-shoulders.css']) {
    const text = fs.readFileSync(new URL(`./fixtures/fonts/${sheet}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /\/l\/font\?kit=/)
    for (const [, u] of text.matchAll(/url\((https:[^)]+)\)/g)) assert.ok(fontFixtures.handle({ url: u }), u)
  }
  assert.equal(fontFixtures.handle({ url: 'https://fonts.gstatic.com/s/jost/v20/missing.woff2' }), null)
  assert.equal(fontFixtures.handle({ url: 'https://fonts.googleapis.com/css2?family=Roboto' }), null)
})

test('selectItems names each unknown --only id, and keeps the known ones', () => {
  assert.deepEqual(selectItems(['about']).map((it) => it.id), ['about'])
  assert.throws(() => selectItems(['about', 'abotu']), /unknown id: abotu$/)
})

test('a mistyped --only leaves an existing capture set untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-only-'))
  try {
    fs.writeFileSync(path.join(dir, 'about-375.png'), 'png')
    fs.writeFileSync(path.join(dir, 'meta.json'), '{}')
    await assert.rejects(capture({ dist: dir, out: dir, brand: 'current', only: ['abotu'] }), /unknown id: abotu/)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['about-375.png', 'meta.json'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('third-party fixtures answer only the paths the app calls', () => {
  apiFixtures.unknown.clear()
  const get = (url) => apiFixtures.handle({ method: 'GET', url })
  assert.equal(get('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=40&lon=-105').status, 200)
  assert.deepEqual([...apiFixtures.unknown], [])
  assert.equal(get('https://nominatim.openstreetmap.org/search?q=x').status, 404)
  assert.equal(get('https://api.inaturalist.org/v1/observations').status, 404)
  assert.deepEqual([...apiFixtures.unknown], [
    'GET nominatim.openstreetmap.org/search', 'GET api.inaturalist.org/v1/observations',
  ])
  apiFixtures.unknown.clear()
})
