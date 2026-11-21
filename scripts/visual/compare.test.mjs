// Tests for the screenshot comparison harness (scripts/visual/compare.mjs). They cover the request
// classifier, the one thing that keeps a capture run off production, and the route and width tables.
// Run: node scripts/visual/compare.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRequest, FIXTURE_SUPABASE_URL, ROUTES, STATES, WIDTHS } from './compare.mjs'

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
  assert.equal(classifyRequest('https://a.basemaps.cartocdn.com/light_all/3/1/2.png', ORIGIN), 'tile')
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
