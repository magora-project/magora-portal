// Species reference-audio lookup — "what this species sounds like" on the detection card.
//
// This is a SPECIES affordance, not the place's own recording. It has nothing to do with
// node audio (the featured-sound build is separate and unbuilt).
//
// Why this is a server function rather than a browser fetch: xeno-canto's API moved to v3,
// which requires an API key. The key must never reach the client bundle, so the lookup is
// proxied here. (v2 was previously reachable without a key and is now 404 — the migration
// was forced, independent of the quality work.)
//
// Selection is ranked, not first-match — see ./_audio/xc-select.js for the ordering and why.
//
// GBIF fallback: the card used to read GBIF's occurrence-media API directly. GBIF aggregates
// xeno-canto but flattens away the quality grade and sample rate, which is exactly what we
// need to rank on — so it is no longer the primary source. It is kept as a safety net for
// when the key is unset or xeno-canto is down, so no species that had audio before loses it.

import { pickBest, normaliseFileUrl } from './_audio/xc-select.js'

const XC_API = 'https://xeno-canto.org/api/3/recordings'

// v3 requires every search term to carry a tag; untagged free text is no longer accepted.
function speciesTags(sci) {
  const parts = String(sci).trim().split(/\s+/)
  if (parts.length < 2) return null
  const [gen, sp] = parts
  return `gen:"${gen}" sp:"${sp}"`
}

async function queryXenoCanto(query, key) {
  const url = `${XC_API}?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) {
    const err = new Error(`xeno-canto ${r.status}`)
    err.status = r.status
    throw err
  }
  const data = await r.json()
  return Array.isArray(data?.recordings) ? data.recordings : []
}

// The fallback ladder. Each rung widens the net rather than lowering our standards
// arbitrarily: we ask for A/B first, and only accept C-and-below for species that
// genuinely have nothing better recorded.
function ladder(sci, name) {
  const tags = sci ? speciesTags(sci) : null
  const rungs = []
  if (tags) {
    rungs.push({ query: `${tags} q_gt:C`, floor: 'A/B' })   // grade A or B only
    rungs.push({ query: tags, floor: 'any' })               // any grade, incl. unrated
  }
  if (name) {
    const en = `en:"${String(name).replace(/"/g, '')}"`
    rungs.push({ query: `${en} q_gt:C`, floor: 'A/B' })
    rungs.push({ query: en, floor: 'any' })
  }
  return rungs
}

// Legacy path, unchanged in behaviour from what the card did inline. No quality signal
// available here — first playable media wins, which is precisely the old bug. Only ever
// reached when xeno-canto cannot answer.
async function gbifFallback(sci, name) {
  const queries = [
    sci && `scientificName=${encodeURIComponent(sci)}`,
    name && `q=${encodeURIComponent(name)}`,
  ].filter(Boolean)

  for (const q of queries) {
    try {
      const r = await fetch(`https://api.gbif.org/v1/occurrence/search?mediaType=Sound&${q}&limit=20`)
      if (!r.ok) continue
      const data = await r.json()
      for (const occ of data?.results || []) {
        for (const m of occ?.media || []) {
          if (m?.type === 'Sound' && m?.identifier) {
            return { url: normaliseFileUrl(m.identifier), licence: m.license || null }
          }
        }
      }
    } catch {
      // try the next query shape
    }
  }
  return null
}

// ── Caching ───────────────────────────────────────────────────────────────────
// We cache the SELECTION (which recording won, its url + grade + smp), never audio
// bytes — xeno-canto's own CDN serves the file straight to the browser. Nothing is
// persisted our side: no table, no column, no migration.
//
// The CDN header is the real win; the in-process memo below only catches repeats
// that land on the same warm container before the edge has an answer — a feed
// rendering several cards of the same species at once is the common case.
//
// A species' best recording only changes when XC's catalogue does, so found answers
// hold for a day. Misses expire sooner: "no recording exists" is the one answer that
// can turn into a real one when someone uploads a clip.
const CACHE_FOUND = 'public, s-maxage=86400, stale-while-revalidate=604800'
const CACHE_EMPTY = 'public, s-maxage=3600'

const MEMO_TTL_MS = 60 * 60 * 1000
const MEMO_MAX = 500
const memo = new Map()

// The keyed flag is part of the key on purpose: the moment XENO_CANTO_API_KEY is set,
// a warm container must not keep serving the GBIF fallback picks it memoised while
// unkeyed. That would read as "the key changed nothing" — the exact failure this whole
// task is trying to avoid.
function memoKey(sci, name, keyed) {
  return `${keyed ? 'xc' : 'gbif'}|${sci.toLowerCase()}|${name.toLowerCase()}`
}

function memoGet(k) {
  const hit = memo.get(k)
  if (!hit) return null
  if (Date.now() - hit.at > MEMO_TTL_MS) { memo.delete(k); return null }
  memo.delete(k); memo.set(k, hit) // re-insert = most recently used
  return hit.value
}

function memoSet(k, value) {
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value) // evict oldest
  memo.set(k, { at: Date.now(), value })
}

function send(res, { status, body }, cache) {
  res.setHeader('X-Magora-Cache', cache)
  res.setHeader('Cache-Control', status === 200 ? CACHE_FOUND : CACHE_EMPTY)
  return res.status(status).json(body)
}

// ── Selection ─────────────────────────────────────────────────────────────────
async function resolve(sci, name, key) {
  let xcError = null

  if (key) {
    for (const rung of ladder(sci, name)) {
      try {
        const best = pickBest(await queryXenoCanto(rung.query, key))
        if (best) {
          return { status: 200, body: { source: 'xeno-canto', floor: rung.floor, recording: best } }
        }
      } catch (e) {
        xcError = e.message
        // 401/403 means the key is bad — no later rung will fare better.
        if (e.status === 401 || e.status === 403) break
      }
    }
  } else {
    xcError = 'XENO_CANTO_API_KEY not configured'
  }

  const fallback = await gbifFallback(sci, name)
  if (fallback) {
    return {
      status: 200,
      body: {
        source: 'gbif',
        degraded: xcError || 'no xeno-canto match',
        recording: { url: fallback.url, quality: null, sampleRate: null, licence: fallback.licence },
      },
    }
  }

  return { status: 404, body: { error: 'no recording found', detail: xcError || undefined } }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const sci = (req.query.sci || '').trim()
  const name = (req.query.name || '').trim()
  if (!sci && !name) return res.status(400).json({ error: 'sci or name required' })

  const key = process.env.XENO_CANTO_API_KEY
  const mk = memoKey(sci, name, !!key)

  const cached = memoGet(mk)
  if (cached) return send(res, cached, 'hit')

  const result = await resolve(sci, name, key)
  memoSet(mk, result)
  return send(res, result, 'miss')
}
