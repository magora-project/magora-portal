// Species reference-audio proxy tests — exercises api/xeno-canto.js against a stubbed
// network (pure; no real requests). Run: node api/_audio/proxy.test.mjs
//
// Covers: ladder order and v3 query construction, the q_gt:C grade floor, descent to
// lower grades for sparse species, recovery via the English-name rung, the GBIF safety
// net on 401/unset-key (no species may lose audio), honest 404s, and response caching.
//
// `globalThis.fetch` is stubbed throughout, so this never touches xeno-canto's
// rate-limited volunteer API.
const MOD = new URL('../xeno-canto.js', import.meta.url).href

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const realFetch = globalThis.fetch
const calls = []
let modSeq = 0

function mkRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function mkRes404() { return mkRes({}, 404) }

function stub(handler) {
  calls.length = 0
  globalThis.fetch = async (url) => { calls.push(String(url)); return handler(String(url)) }
}

// A fresh module instance = a cold container = an empty memo. Reuse the returned
// handler within a scenario to exercise warm-container behaviour.
async function coldHandler() {
  const { default: h } = await import(MOD + `?v=${++modSeq}`)
  return h
}

async function call(handler, query, env) {
  const prev = process.env.XENO_CANTO_API_KEY
  if (env === undefined) delete process.env.XENO_CANTO_API_KEY
  else process.env.XENO_CANTO_API_KEY = env
  let statusCode = 0, payload = null
  const headers = {}
  const res = {
    setHeader: (k, v) => { headers[k] = v },
    status(c) { statusCode = c; return this },
    json(p) { payload = p; return this },
  }
  await handler({ method: 'GET', query }, res)
  if (prev === undefined) delete process.env.XENO_CANTO_API_KEY
  else process.env.XENO_CANTO_API_KEY = prev
  return { statusCode, payload, headers }
}

// Convenience for scenarios that don't care about warm state.
async function run(query, env) { return call(await coldHandler(), query, env) }

const rec = (o) => ({ file: `https://xeno-canto.org/${o.id}/download`, ...o })
const xcCalls = () => calls.filter((c) => c.includes('xeno-canto.org/api')).length

// ── 1. common species: grade floor satisfied on the first rung ─────────────────
stub((u) => {
  if (u.includes('q_gt%3AC')) {
    return mkRes({ recordings: [
      rec({ id: '1', q: 'B', smp: 48000, length: '0:30', type: 'song' }),
      rec({ id: '2', q: 'A', smp: 22050, length: '0:30', type: 'song' }),
      rec({ id: '3', q: 'A', smp: 48000, length: '0:30', type: 'song' }),
    ] })
  }
  return mkRes({ recordings: [] })
})
{
  const { statusCode, payload, headers } = await run({ sci: 'Turdus migratorius', name: 'American Robin' }, 'k')
  ok('common: 200', statusCode === 200)
  ok('common: source is xeno-canto', payload.source === 'xeno-canto')
  ok('common: A/B floor reported', payload.floor === 'A/B')
  ok('common: picked grade A @48k (not first-match B)', payload.recording.id === '3')
  ok('common: only one upstream call needed', calls.length === 1)
  ok('common: query is tagged gen/sp', decodeURIComponent(calls[0]).includes('gen:"Turdus" sp:"migratorius"'))
  ok('common: quality floor in query', decodeURIComponent(calls[0]).includes('q_gt:C'))
  ok('common: key sent', calls[0].includes('key=k'))
  ok('common: edge-cached for a day', /s-maxage=86400/.test(headers['Cache-Control'] || ''))
}

// ── 2. sparse species: nothing at A/B, must descend the ladder ─────────────────
stub((u) => {
  if (u.includes('q_gt%3AC')) return mkRes({ recordings: [] })
  if (u.includes('gen%3A')) return mkRes({ recordings: [rec({ id: 'd1', q: 'D', smp: 22050, length: '1:10' })] })
  return mkRes({ recordings: [] })
})
{
  const { statusCode, payload } = await run({ sci: 'Grallaria ridgelyi', name: 'Jocotoco Antpitta' }, 'k')
  ok('sparse: still plays something', statusCode === 200 && !!payload.recording.url)
  ok('sparse: fell through to any-grade', payload.floor === 'any')
  ok('sparse: grade D accepted as last resort', payload.recording.quality === 'D')
  ok('sparse: tried the A/B rung first', decodeURIComponent(calls[0]).includes('q_gt:C'))
}

// ── 3. scientific name misses entirely -> common-name rungs ───────────────────
stub((u) => {
  if (u.includes('gen%3A')) return mkRes({ recordings: [] })
  if (u.includes('en%3A') && u.includes('q_gt%3AC')) {
    return mkRes({ recordings: [rec({ id: 'en1', q: 'A', smp: 44100, length: '0:15', type: 'call' })] })
  }
  return mkRes({ recordings: [] })
})
{
  const { payload } = await run({ sci: 'Bogus namus', name: 'Northern Cardinal' }, 'k')
  ok('en-rung: recovered via common name', payload?.recording?.id === 'en1')
  ok('en-rung: english tag used', decodeURIComponent(calls.at(-1)).includes('en:"Northern Cardinal"'))
  ok('en-rung: exhausted sci rungs first', calls.length === 3)
}

// ── 4. bad key -> stop hammering, fall back to GBIF (no audio regression) ──────
stub((u) => {
  if (u.includes('xeno-canto.org/api')) return mkRes({ error: 'unauthorized' }, 401)
  if (u.includes('api.gbif.org')) {
    return mkRes({ results: [{ media: [{ type: 'Sound', identifier: '//gbif.example/a.mp3' }] }] })
  }
  return mkRes404()
})
{
  const { statusCode, payload } = await run({ sci: 'Turdus migratorius', name: 'American Robin' }, 'badkey')
  ok('401: falls back to GBIF', statusCode === 200 && payload.source === 'gbif')
  ok('401: protocol-relative url normalised', payload.recording.url === 'https://gbif.example/a.mp3')
  ok('401: degradation reported', /401/.test(payload.degraded))
  ok('401: only one XC attempt before bailing', xcCalls() === 1)
}

// ── 5. key unset (pre-provision state) -> GBIF, i.e. exactly today's behaviour ─
stub((u) => {
  if (u.includes('api.gbif.org')) {
    return mkRes({ results: [{ media: [{ type: 'Sound', identifier: 'https://gbif.example/b.mp3' }] }] })
  }
  return mkRes404()
})
{
  const { statusCode, payload } = await run({ sci: 'Turdus migratorius', name: 'American Robin' }, undefined)
  ok('no key: still serves audio', statusCode === 200 && payload.recording.url === 'https://gbif.example/b.mp3')
  ok('no key: never calls xeno-canto', xcCalls() === 0)
  ok('no key: reason surfaced', /not configured/.test(payload.degraded))
}

// ── 6. genuinely nothing anywhere -> honest 404 ───────────────────────────────
stub(() => mkRes({ recordings: [], results: [] }))
{
  const { statusCode, headers } = await run({ sci: 'Nullus nullus', name: 'Nothing' }, 'k')
  ok('no audio anywhere: 404', statusCode === 404)
  ok('404: cached, but briefly — a clip may get uploaded', /s-maxage=3600/.test(headers['Cache-Control'] || ''))
}

// ── 7. input guards ───────────────────────────────────────────────────────────
stub(() => mkRes404())
{
  const { statusCode } = await run({}, 'k')
  ok('missing params: 400', statusCode === 400)
  const { statusCode: s2 } = await run({ sci: 'Turdus migratorius' }, 'k')
  ok('sci alone is accepted', s2 !== 400)
}

// ── 8. single-word "scientific name" must not produce a broken gen/sp query ────
stub((u) => {
  if (u.includes('en%3A')) return mkRes({ recordings: [rec({ id: 'x', q: 'A', smp: 44100 })] })
  return mkRes({ recordings: [] })
})
{
  await run({ sci: 'Corvus', name: 'Crow' }, 'k')
  ok('unary sci: no malformed gen/sp rung', calls.every((c) => !c.includes('gen%3A')))
}

// ══ Item 4: response caching ══════════════════════════════════════════════════

// ── 9. repeat request for the same species is served from cache ───────────────
stub((u) => {
  if (u.includes('q_gt%3AC')) return mkRes({ recordings: [rec({ id: 'r1', q: 'A', smp: 48000, length: '0:30' })] })
  return mkRes({ recordings: [] })
})
{
  const h = await coldHandler()
  const robin = { sci: 'Turdus migratorius', name: 'American Robin' }
  const first = await call(h, robin, 'k')
  const afterFirst = xcCalls()
  const second = await call(h, robin, 'k')

  ok('cache: first request is a miss', first.headers['X-Magora-Cache'] === 'miss')
  ok('cache: second request is a hit', second.headers['X-Magora-Cache'] === 'hit')
  ok('cache: hit made no second XC call', xcCalls() === afterFirst)
  ok('cache: hit returns the same selection', second.payload.recording.id === first.payload.recording.id)
  ok('cache: hit still carries the CDN header', /s-maxage=86400/.test(second.headers['Cache-Control'] || ''))

  // ...but a different species must not be served the robin's recording.
  const jay = await call(h, { sci: 'Cyanocitta cristata', name: 'Blue Jay' }, 'k')
  ok('cache: different species is a miss', jay.headers['X-Magora-Cache'] === 'miss')
  ok('cache: different species triggers a fresh XC call', xcCalls() > afterFirst)
  ok('cache: different species queried by its own name',
    decodeURIComponent(calls.at(-1)).includes('sp:"cristata"'))
}

// ── 10. misses are cached too — the rate-limit case that mattered most ────────
// A species with no recording used to run 4 XC rungs + 2 GBIF calls on EVERY card mount.
stub(() => mkRes({ recordings: [], results: [] }))
{
  const h = await coldHandler()
  const q = { sci: 'Nullus nullus', name: 'Nothing' }
  await call(h, q, 'k')
  const afterFirst = calls.length
  const second = await call(h, q, 'k')
  ok('cache: 404 is memoised', second.headers['X-Magora-Cache'] === 'hit')
  ok('cache: repeat miss makes no upstream calls at all', calls.length === afterFirst)
  ok('cache: repeat miss still 404s', second.statusCode === 404)
}

// ── 11. the GBIF fallback path is cached too, and unaffected by the layer ──────
stub((u) => {
  if (u.includes('api.gbif.org')) {
    return mkRes({ results: [{ media: [{ type: 'Sound', identifier: 'https://gbif.example/c.mp3' }] }] })
  }
  return mkRes404()
})
{
  const h = await coldHandler()
  const q = { sci: 'Turdus migratorius', name: 'American Robin' }
  const first = await call(h, q, undefined)
  const afterFirst = calls.length
  const second = await call(h, q, undefined)
  ok('cache: unset-key path still serves audio', first.payload.recording.url === 'https://gbif.example/c.mp3')
  ok('cache: unset-key path caches', second.headers['X-Magora-Cache'] === 'hit')
  ok('cache: unset-key hit makes no upstream call', calls.length === afterFirst)
  ok('cache: unset-key hit keeps the GBIF source', second.payload.source === 'gbif')
}

// ── 12. setting the key must invalidate a warm container's GBIF memo ───────────
// Otherwise flipping XENO_CANTO_API_KEY reads as "the key changed nothing".
stub((u) => {
  if (u.includes('xeno-canto.org/api') && u.includes('q_gt%3AC')) {
    return mkRes({ recordings: [rec({ id: 'upgraded', q: 'A', smp: 48000, length: '0:30' })] })
  }
  if (u.includes('api.gbif.org')) {
    return mkRes({ results: [{ media: [{ type: 'Sound', identifier: 'https://gbif.example/old.mp3' }] }] })
  }
  return mkRes({ recordings: [] })
})
{
  const h = await coldHandler()
  const q = { sci: 'Turdus migratorius', name: 'American Robin' }
  const unkeyed = await call(h, q, undefined)
  ok('flip: unkeyed serves GBIF', unkeyed.payload.source === 'gbif')

  const keyed = await call(h, q, 'k') // same warm container, key now present
  ok('flip: keyed request is NOT served the stale GBIF memo', keyed.headers['X-Magora-Cache'] === 'miss')
  ok('flip: keyed request upgrades to xeno-canto', keyed.payload.source === 'xeno-canto')
  ok('flip: keyed request gets the graded recording', keyed.payload.recording.id === 'upgraded')

  // ...and the unkeyed entry is still intact rather than clobbered.
  const backToUnkeyed = await call(h, q, undefined)
  ok('flip: unkeyed memo survives alongside the keyed one', backToUnkeyed.headers['X-Magora-Cache'] === 'hit')
}

// ── 13. memo is bounded — a long-lived container cannot grow unbounded ─────────
stub((u) => {
  if (u.includes('q_gt%3AC')) return mkRes({ recordings: [rec({ id: 'b', q: 'A', smp: 48000 })] })
  return mkRes({ recordings: [] })
})
{
  const h = await coldHandler()
  // 520 distinct species against a 500-entry cap.
  for (let i = 0; i < 520; i++) {
    await call(h, { sci: `Genus sp${i}`, name: `Species ${i}` }, 'k')
  }
  const early = await call(h, { sci: 'Genus sp0', name: 'Species 0' }, 'k')
  const late = await call(h, { sci: 'Genus sp519', name: 'Species 519' }, 'k')
  ok('memo: oldest entries evicted past the cap', early.headers['X-Magora-Cache'] === 'miss')
  ok('memo: most recent entries retained', late.headers['X-Magora-Cache'] === 'hit')
}

globalThis.fetch = realFetch
console.log(`\nxc-proxy: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
