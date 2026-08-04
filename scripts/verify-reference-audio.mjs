// Verifies the species reference-audio quality upgrade against the live xeno-canto v3 API.
//
// Run: XENO_CANTO_API_KEY=... node scripts/verify-reference-audio.mjs
//   (PowerShell: $env:XENO_CANTO_API_KEY='...'; node scripts/verify-reference-audio.mjs)
//
// For each probe species it prints, side by side:
//   OLD  — what the card used to play: the first Sound media GBIF happened to return.
//   NEW  — what the ranked selector picks: best grade, then best sample rate.
// plus the grade/sample-rate spread of the candidate set, so the improvement is visible
// rather than asserted. The species span the range deliberately: a very common passerine,
// a moderately recorded one, a non-passerine, and a genuinely sparse species that should
// exercise the fallback ladder (and must still yield audio).

import { pickBest, rankRecordings } from '../api/_audio/xc-select.js'

const KEY = process.env.XENO_CANTO_API_KEY
if (!KEY) {
  console.error('XENO_CANTO_API_KEY is not set — get a key at https://xeno-canto.org/account (free, XC members).')
  process.exit(2)
}

const PROBES = [
  { sci: 'Turdus migratorius', name: 'American Robin',       expect: 'common — huge catalogue, expect a clean A' },
  { sci: 'Setophaga petechia', name: 'Yellow Warbler',       expect: 'moderate' },
  { sci: 'Megascops choliba',  name: 'Tropical Screech-Owl', expect: 'non-passerine' },
  { sci: 'Grallaria ridgelyi', name: 'Jocotoco Antpitta',    expect: 'sparse — exercises the fallback ladder' },
]

async function xc(query) {
  const r = await fetch(`https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(query)}&key=${KEY}`)
  if (!r.ok) throw new Error(`xeno-canto ${r.status}`)
  const d = await r.json()
  return Array.isArray(d?.recordings) ? d.recordings : []
}

// Mirrors the proxy's ladder so this measures what production actually does.
async function newPick(sci, name) {
  const [gen, sp] = sci.split(/\s+/)
  const rungs = [`gen:"${gen}" sp:"${sp}" q_gt:C`, `gen:"${gen}" sp:"${sp}"`, `en:"${name}" q_gt:C`, `en:"${name}"`]
  for (const q of rungs) {
    const recs = await xc(q)
    const best = pickBest(recs)
    if (best) return { best, rung: q, pool: rankRecordings(recs) }
  }
  return null
}

// The previous behaviour, reproduced exactly: GBIF occurrence media, first Sound wins.
async function oldPick(sci, name) {
  for (const q of [`scientificName=${encodeURIComponent(sci)}`, `q=${encodeURIComponent(name)}`]) {
    const r = await fetch(`https://api.gbif.org/v1/occurrence/search?mediaType=Sound&${q}&limit=20`)
    if (!r.ok) continue
    const d = await r.json()
    for (const occ of d?.results || []) {
      for (const m of occ?.media || []) {
        if (m?.type === 'Sound' && m?.identifier) return m.identifier
      }
    }
  }
  return null
}

// GBIF hands back a bare URL with no metadata, so to compare like for like we ask
// xeno-canto what that recording's grade and sample rate actually were.
async function describeByXcId(url, pool) {
  const id = /xeno-canto\.org\/(\d+)/.exec(url || '')?.[1]
  if (!id) return null
  return pool.find((r) => String(r.id) === id) || null
}

let regressions = 0
for (const p of PROBES) {
  console.log(`\n=== ${p.name} (${p.sci}) — ${p.expect}`)
  let result
  try {
    result = await newPick(p.sci, p.name)
  } catch (e) {
    console.log(`  NEW  ERROR: ${e.message}`)
    continue
  }

  const old = await oldPick(p.sci, p.name)

  if (!result) {
    console.log('  NEW  none found')
    if (old) { console.log(`  !! REGRESSION: old path had audio (${old}), new path has none`); regressions++ }
    continue
  }

  const { best, rung, pool } = result
  const spread = pool.reduce((acc, r) => {
    const g = (r.q || 'unrated').toUpperCase()
    acc[g] = (acc[g] || 0) + 1
    return acc
  }, {})

  const oldMeta = await describeByXcId(old, pool)
  const oldDesc = old
    ? oldMeta
      ? `grade ${oldMeta.q || '—'} @ ${oldMeta.smp || '?'} Hz  (${old})`
      : `unknown grade/rate — GBIF exposes neither  (${old})`
    : 'none'

  console.log(`  rung  ${rung}`)
  console.log(`  pool  ${pool.length} playable  ${JSON.stringify(spread)}`)
  console.log(`  OLD   ${oldDesc}`)
  console.log(`  NEW   grade ${best.quality || '—'} @ ${best.sampleRate || '?'} Hz  len ${best.length || '?'}  type ${best.type || '?'}`)
  console.log(`        ${best.url}`)

  if (!best.url) { console.log('  !! REGRESSION: no playable url'); regressions++ }
  if (oldMeta && best.quality && oldMeta.q && best.quality > oldMeta.q) {
    console.log(`  !! WARNING: new grade (${best.quality}) is worse than old (${oldMeta.q})`)
    regressions++
  }
}

console.log(`\n${regressions ? `${regressions} problem(s) found` : 'no regressions — every probe species yields audio'}`)
process.exit(regressions ? 1 : 0)
