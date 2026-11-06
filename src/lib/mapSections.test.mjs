// Map page section loader (#64): each section applies its own query result as soon as that query
// settles, so one slow query delays only its own section.
// Run: node src/lib/mapSections.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMapSectionLoader, nextNodes, nodeInsightRequest, MAP_SECTIONS, FEED_SECTIONS } from './mapSections.js'

const never = () => new Promise(() => {})
const ok = data => () => Promise.resolve({ data, error: null })
const tick = () => new Promise(r => setTimeout(r, 0))

function allOk(overrides = {}) {
  return Object.fromEntries(MAP_SECTIONS.map(name => [name, overrides[name] ?? ok([name])]))
}

function recorder() {
  const applied = []
  const feed = []
  const loader = createMapSectionLoader({
    apply: (name, res) => applied.push([name, res]),
    onFeedSettled: results => feed.push(results),
  })
  return { applied, feed, loader }
}

test('a pending nodes query does not hold back the other sections or the feed', async () => {
  const { applied, feed, loader } = recorder()
  loader(allOk({ nodes: never }))
  await tick()
  assert.deepEqual(applied.map(([n]) => n).sort(), MAP_SECTIONS.filter(n => n !== 'nodes').sort())
  assert.equal(feed.length, 1, 'feed settles without waiting for nodes')
  assert.deepEqual(applied.find(([n]) => n === 'detections')[1], { data: ['detections'], error: null })
})

test('a pending feed query still lets the other feed sections apply', async () => {
  const { applied, feed, loader } = recorder()
  loader(allOk({ sessions: never }))
  await tick()
  assert.ok(applied.some(([n]) => n === 'detections'))
  assert.ok(applied.some(([n]) => n === 'mobile'))
  assert.ok(!applied.some(([n]) => n === 'sessions'))
  assert.equal(feed.length, 0, 'feed status waits for all three feed queries')
})

test('feed status reports each feed result in FEED_SECTIONS order', async () => {
  const { feed, loader } = recorder()
  const boom = new Error('boom')
  loader(allOk({ mobile: () => Promise.reject(boom) }))
  await tick()
  assert.deepEqual(FEED_SECTIONS, ['detections', 'mobile', 'sessions'])
  assert.equal(feed[0].length, 3)
  assert.equal(feed[0][0].error, null)
  assert.equal(feed[0][1].error, boom)
  assert.equal(feed[0][1].data, null)
})

test('a query that throws synchronously becomes an error result, not a crash', async () => {
  const { applied, loader } = recorder()
  const boom = new Error('sync')
  await loader(allOk({ aci: () => { throw boom } }))
  assert.deepEqual(applied.find(([n]) => n === 'aci')[1], { data: null, error: boom })
})

test('a result with no { data, error } shape is treated as an error', async () => {
  const { applied, loader } = recorder()
  await loader(allOk({ today: () => Promise.resolve(undefined) }))
  const res = applied.find(([n]) => n === 'today')[1]
  assert.equal(res.data, null)
  assert.ok(res.error instanceof Error)
})

test('an older refresh that settles after a newer one does not overwrite it', async () => {
  const { applied, feed, loader } = recorder()
  let resolveOld
  const oldDetections = () => new Promise(r => { resolveOld = r })
  loader(allOk({ detections: oldDetections }))          // refresh 1: detections slow
  await tick()
  await loader(allOk({ detections: ok(['new']) }))     // refresh 2 settles fully
  resolveOld({ data: ['old'], error: null })           // refresh 1's detections arrive late
  await tick()
  const dets = applied.filter(([n]) => n === 'detections').map(([, r]) => r.data)
  assert.deepEqual(dets, [['new']], 'stale detections dropped')
  const callbacks = feed.length
  assert.ok(callbacks > 0)
  assert.deepEqual(feed.at(-1)[0].data, ['new'], 'status describes the applied detections')
  resolveOld({ data: ['old'], error: null })
  await tick()
  assert.equal(feed.length, callbacks, 'a dropped result does not report a status')
})

test('feed status always describes the feed data on screen, across overlapping loads', async () => {
  // Codex's interleaving: load 1 detections/mobile succeed, sessions pending; load 2 detections
  // fail, its sessions pending; load 1's sessions then succeed.
  const { applied, feed, loader } = recorder()
  let resolveOldSessions
  loader(allOk({ sessions: () => new Promise(r => { resolveOldSessions = r }) }))
  await tick()
  const boom = new Error('detections down')
  loader(allOk({ detections: () => Promise.reject(boom), sessions: never }))
  await tick()
  resolveOldSessions({ data: ['sessions'], error: null })
  await tick()
  const shownDetections = applied.filter(([n]) => n === 'detections').at(-1)[1]
  assert.equal(shownDetections.error, boom, 'load 2 detections failure is on screen')
  assert.equal(feed.at(-1)[0].error, boom, 'status reports the detections failure on screen')
})

test('an older refresh may still apply a section the newer one has not reached', async () => {
  const { applied, loader } = recorder()
  let resolveOld
  loader(allOk({ aci: () => new Promise(r => { resolveOld = r }) }))
  await tick()
  loader(allOk({ aci: never }))
  resolveOld({ data: ['old'], error: null })
  await tick()
  assert.deepEqual(applied.filter(([n]) => n === 'aci').map(([, r]) => r.data), [['old']])
})

test('the returned promise resolves once every query has settled', async () => {
  const { applied, loader } = recorder()
  await loader(allOk())
  assert.equal(applied.length, MAP_SECTIONS.length)
})

test('a feed card whose node is not in the nodes list still gets an insight request (#60)', () => {
  const d = { id: 'd1', node_id: 'n-unlisted', species_name: null, raw_label: 'American Robin_Turdus migratorius', confidence: 0.8, is_dawn_chorus: false }
  const body = nodeInsightRequest(d, undefined)
  assert.equal(body.detection_id, 'd1', 'the server resolves the node from the detection')
  assert.equal(body.species_name, 'American Robin_Turdus migratorius')
  assert.equal(body.scientific_name, 'Turdus migratorius')
  assert.equal('location' in body, false, 'no location is invented for an unlisted node')
  assert.equal(nodeInsightRequest(d, { name: 'Pond' }).location, 'Pond')
  assert.equal(nodeInsightRequest(d, { name: 'Pond', habitat_type: 'Riparian' }).location, 'Riparian')
})

test('a failed nodes refresh keeps the last list; a successful one replaces it (#59)', () => {
  const prev = [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }]
  assert.equal(nextNodes(prev, { data: null, error: new Error('timeout') }), prev)
  assert.deepEqual(nextNodes(prev, { data: [{ id: 'n5', detections: [{ id: 'd' }] }], error: null }), [{ id: 'n5' }])
  assert.deepEqual(nextNodes(prev, { data: null, error: null }), [])
  assert.deepEqual(nextNodes([], { data: null, error: new Error('first load failed') }), [])
})
