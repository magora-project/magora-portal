// buildNodeInsightPrompt resolves the node from detection_id (#60): the map page sends no location
// for a feed card whose node is not in its nodes list, and the prompt must still name the place.
// Run: node api/insight.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNodeInsightPrompt } from './insight.js'

const DETECTION = {
  id: 'd1', node_id: 'n-unlisted', species_name: 'American Robin', confidence: 0.82,
  detected_at: '2026-11-04T15:00:00Z', range_status: 'unchecked',
}

const ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'EBIRD_API_KEY']

function withFetch(routes, fn) {
  const real = globalThis.fetch
  // Save and restore each variable this stub touches, key by key, so nothing leaks past the test.
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  process.env.VITE_SUPABASE_URL = 'https://sb.test'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  delete process.env.EBIRD_API_KEY
  const seen = []
  globalThis.fetch = async url => {
    const path = String(url).replace('https://sb.test/rest/v1/', '')
    seen.push(path)
    const hit = routes.find(([prefix]) => path.startsWith(prefix))
    return { ok: true, json: async () => (hit ? hit[1] : []) }
  }
  return Promise.resolve(fn(seen)).finally(() => {
    globalThis.fetch = real
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
}

test('a detection_id with no location builds a prompt from the node the server loads', () =>
  withFetch([
    ['detections?id=eq.d1&', [DETECTION]],
    ['nodes?id=eq.n-unlisted&', [{ id: 'n-unlisted', name: 'Willow Creek' }]],
  ], async seen => {
    const built = await buildNodeInsightPrompt({ detection_id: 'd1', species_name: 'American Robin' })
    assert.equal(built.error, undefined, JSON.stringify(built))
    assert.match(built.prompt, /based at a node in Willow Creek/)
    assert.ok(seen.some(p => p.startsWith('nodes?id=eq.n-unlisted&')), 'node looked up from the detection')
  }))

test('the detection is read under the range gate; with no row and no location the request is refused', () =>
  withFetch([], async seen => {
    const built = await buildNodeInsightPrompt({ detection_id: 'd1', species_name: 'American Robin' })
    assert.equal(built.status, 400, 'no location is invented when the gated read returns nothing')
    const detectionRead = seen.find(p => p.startsWith('detections?id=eq.d1&'))
    assert.match(detectionRead, /range_status\.neq\.quarantined/, 'a quarantined row is withheld by the read itself')
  }))
