// Codex @f764465 fix verification, no network (fetch is stubbed):
//
// T1 (api/_lib/nodeTime.js): a failed first-detection fallback lookup must NOT read as zero
//     tenure. It throws, like the heartbeat lookup (M5); only a successful empty response is
//     "no history".
// T2 (api/insight.js): a request with no node (species_name + location fallback) or a failed
//     tenure lookup has UNKNOWN tenure. It takes the first-impression framing (no observation
//     window for node patterns, no season, no pattern thread) instead of defaulting to a mature
//     14-day node.

process.env.VITE_SUPABASE_URL = 'https://supabase.test'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test'
delete process.env.EBIRD_API_KEY

const { nodeTenure } = await import('./_lib/nodeTime.js')
const { buildNodeInsightPrompt, tenureFraming, framingBullet, observationWindowLine } = await import('./insight.js')

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// Route stubbed fetches by PostgREST table; `routes[table]` returns a Response or throws.
function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.replace('/rest/v1/', '')
    const route = routes[table] ?? routes['*']
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    return route(url)
  }
}
async function rejects(fn) { try { await fn(); return false } catch { return true } }

// ── T1: detection fallback failure is not zero tenure ────────────────────────
const NODE = '7fe2f0d2-932a-404a-9c83-cbdd6a837ee9'
const NOW = new Date('2026-11-05T12:00:00Z')

stubFetch({ aci_logs: () => json([]), detections: () => json({ message: 'timeout' }, 503) })
ok('T1: no heartbeats + detection lookup 503 -> throws (not zero tenure)', await rejects(() => nodeTenure(NODE, NOW)))

stubFetch({ aci_logs: () => json([]), detections: () => { throw new TypeError('fetch failed') } })
ok('T1: no heartbeats + detection network error -> throws', await rejects(() => nodeTenure(NODE, NOW)))

stubFetch({ aci_logs: () => json([]), detections: () => json([]) })
const empty = await nodeTenure(NODE, NOW)
ok('T1: successful empty history -> zero tenure', empty.first_heard_at === null && empty.days_listening === 0)

stubFetch({ aci_logs: () => json([]), detections: () => json([{ detected_at: '2026-11-04T12:00:00Z' }]) })
const fromDetection = await nodeTenure(NODE, NOW)
ok('T1: detection fallback still supplies tenure', fromDetection.first_heard_at === '2026-11-04T12:00:00Z' && fromDetection.days_listening === 1)

stubFetch({ aci_logs: () => json({ message: 'timeout' }, 503) })
ok('T1: heartbeat lookup failure still throws (M5 unchanged)', await rejects(() => nodeTenure(NODE, NOW)))

// ── T2: pure framing helpers ────────────────────────────────────────────────
const unknown = tenureFraming(null)
ok('T2: null tenure is unknown, first-impression', unknown.unknownTenure === true && unknown.earlyNode === true)
const mature = tenureFraming({ first_heard_at: '2026-10-01T00:00:00Z', days_listening: 35 })
ok('T2: mature tenure keeps 14-day window', mature.unknownTenure === false && mature.earlyNode === false && mature.recentDays === 14)
const young = tenureFraming({ first_heard_at: '2026-11-04T19:22:00Z', days_listening: 0.7 })
ok('T2: young tenure is early, known', young.unknownTenure === false && young.earlyNode === true)
ok('T2: unknown window line makes no node-patterns or just-began claim',
  !observationWindowLine(true, null, true).includes('node patterns') && !observationWindowLine(true, null, true).includes('begun listening'))
ok('T2: unknown framing bullet forbids patterns and does not claim a new node',
  framingBullet(true, true).includes('do not describe patterns') && !framingBullet(true, true).includes('begun listening'))
ok('T2: mature framing bullet unchanged', framingBullet(false).includes('pattern being built at this node'))

// ── T2: end-to-end prompt for a node-less fallback request ──────────────────
// Every PostgREST read returns empty; no node, so no tenure lookup at all.
stubFetch({ '*': () => json([]) })
const nodeless = await buildNodeInsightPrompt({ species_name: 'Cactus Wren', location: 'Terlingua, Texas', confidence: 0.9 })
ok('T2: node-less request builds a prompt', typeof nodeless.prompt === 'string')
const p = nodeless.prompt || ''
ok('T2: node-less prompt has no 14-day node-pattern window', !p.includes('Observation window used for node patterns'))
ok('T2: node-less prompt has no pattern thread', !p.includes('pattern being built at this node'))
ok('T2: node-less prompt drops the seasonal inference', !p.includes(', and the season'))
ok('T2: node-less prompt has no Season line', !/\nSeason: /.test(p))
ok('T2: node-less prompt states no history is available', p.includes('no listening history is available'))

// ── T2: tenure lookup failure on a real detection degrades to unknown tenure ─
stubFetch({
  detections: (url) => url.includes('id=eq.det-1')
    ? json([{ id: 'det-1', node_id: NODE, species_name: 'Cactus Wren', confidence: 0.9, detected_at: '2026-11-05T15:00:00Z' }])
    : json([]),
  nodes: () => json([{ id: NODE, name: 'Villa Magora', location: { coordinates: [-103.2334, 29.2708] } }]),
  aci_logs: () => json({ message: 'timeout' }, 503),
  '*': () => json([]),
})
const failed = await buildNodeInsightPrompt({ detection_id: 'det-1' })
ok('T2: tenure lookup failure still builds a prompt (no 500)', typeof failed.prompt === 'string')
ok('T2: tenure lookup failure takes unknown framing, not mature', (failed.prompt || '').includes('no listening history is available')
  && !(failed.prompt || '').includes('pattern being built at this node'))

console.log(`insight-tenure: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
