// Task-F eval harness: compare INSIGHT_MODEL candidates (Sonnet 4.6 vs Haiku 4.5)
// on the EXACT production insight prompt, so the keep/switch decision is judged on
// real output, not a guess.
//
// It reuses the real prompt builders from api/insight.js (no prompt duplication,
// zero drift), fetches recent real detections from Supabase, builds each prompt
// ONCE, then generates it with every candidate model. Output is a side-by-side
// markdown file for you to score by hand.
//
// Run:  node scripts/eval-insight-models.mjs
// Env (auto-loaded from .env.local then .env; real shell env wins):
//   ANTHROPIC_API_KEY        required
//   VITE_SUPABASE_URL        required
//   VITE_SUPABASE_ANON_KEY   required
//   EBIRD_API_KEY            optional (adds regional context, same as prod)
//   EVAL_N                   samples per type (default 12)
//   EVAL_MODELS              comma-separated model ids (default sonnet-4-6,haiku-4-5)
//
// Needs Node 18+ (global fetch).

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMobileInsightPrompt, buildNodeInsightPrompt, generateInsight } from '../api/insight.js'
import { isHiddenSpecies } from '../src/lib/hiddenSpecies.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MIN_CONFIDENCE = 0.30 // mirrors src/lib/supabase.js

// --- env loading (real shell env wins; .env.local overrides .env) ------------
function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
// loadEnvFile only sets keys not already present, so precedence is
// shell env > .env.local (loaded first) > .env (loaded second).
loadEnvFile(join(ROOT, '.env.local'))
loadEnvFile(join(ROOT, '.env'))

// --- config ------------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const N = Number(process.env.EVAL_N || 12)
const MODELS = (process.env.EVAL_MODELS || 'claude-sonnet-4-6,claude-haiku-4-5-20251001')
  .split(',').map(s => s.trim()).filter(Boolean)

const missing = []
if (typeof fetch === 'undefined') { console.error('Need Node 18+ (global fetch).'); process.exit(1) }
if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY')
if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
if (!ANON) missing.push('VITE_SUPABASE_ANON_KEY')
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}. Set them in .env.local or the shell.`)
  process.exit(1)
}

function label(model) {
  if (/haiku/i.test(model)) return 'Haiku 4.5'
  if (/sonnet-4-6/i.test(model)) return 'Sonnet 4.6'
  if (/sonnet-5/i.test(model)) return 'Sonnet 5'
  if (/opus/i.test(model)) return 'Opus'
  return model
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  })
  if (!res.ok) throw new Error(`Supabase ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

function quote(text) {
  return String(text ?? '').trim().split('\n').map(l => `> ${l}`).join('\n')
}

// --- gather samples ----------------------------------------------------------
async function mobileSamples() {
  const rows = await sbGet(
    `public_mobile_detections?select=id,species,lat,lon,detected_at,habitat_type,canopy_cover,water_present,disturbance_level` +
    `&order=detected_at.desc&limit=${N * 4}`,
  )
  const out = []
  for (const m of rows) {
    const conf = (m.species || []).filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
    if (!conf.length) continue // feed path needs confident species
    out.push({
      row: m,
      species: conf,
      // Payload mirrors the feed-regeneration path in src/lib/useEcosystemInsight.js
      // (no nearby/notes — those are private and hidden from the public view).
      body: {
        mobile: true, detection_id: m.id, species: conf,
        lat: m.lat, lon: m.lon, detected_at: m.detected_at,
        habitat_type: m.habitat_type, canopy_cover: m.canopy_cover,
        water_present: m.water_present, disturbance_level: m.disturbance_level,
      },
    })
    if (out.length >= N) break
  }
  return out
}

async function nodeSamples() {
  const rows = await sbGet(
    `detections?select=id,species_name,raw_label,confidence,is_dawn_chorus` +
    `&confidence=gte.${MIN_CONFIDENCE}&order=detected_at.desc&limit=${N * 4}`,
  )
  const out = []
  for (const d of rows) {
    const name = d.species_name || d.raw_label
    if (!name || isHiddenSpecies(name)) continue
    out.push({
      row: d,
      // Payload mirrors NodePage.jsx / MapPage.jsx — the endpoint enriches from detection_id.
      body: {
        detection_id: d.id,
        species_name: d.species_name || d.raw_label,
        scientific_name: d.raw_label?.split('_')[1] || '',
        confidence: d.confidence,
        location: '',
        is_dawn_chorus: d.is_dawn_chorus,
      },
    })
    if (out.length >= N) break
  }
  return out
}

// --- run ---------------------------------------------------------------------
async function generateAll(prompt) {
  const results = {}
  for (const model of MODELS) {
    const out = await generateInsight(prompt, model)
    results[model] = out.error ? `⚠️ ERROR: ${out.error}` : out.text
    await sleep(250) // gentle on the API
  }
  return results
}

async function main() {
  console.log(`Models: ${MODELS.join(', ')}`)
  console.log(`Fetching up to ${N} mobile Listens + ${N} node detections…`)
  const [mobiles, nodes] = await Promise.all([mobileSamples(), nodeSamples()])
  console.log(`Got ${mobiles.length} mobile + ${nodes.length} node. Generating ${(mobiles.length + nodes.length) * MODELS.length} insights…`)

  const lines = []
  const now = new Date()
  lines.push(`# Insight model eval — ${now.toISOString().slice(0, 16).replace('T', ' ')}`)
  lines.push('')
  lines.push('Comparing `INSIGHT_MODEL` candidates on the **exact** production prompt (`api/insight.js`).')
  lines.push(`Each prompt is built once and generated with every model, so differences are the model, not the input.`)
  lines.push('')
  lines.push(`- Models: ${MODELS.map(m => `\`${m}\` (${label(m)})`).join(' · ')}`)
  lines.push(`- Samples: ${mobiles.length} mobile Listens + ${nodes.length} node detections`)
  lines.push('')
  lines.push('## How to score (Task F)')
  lines.push('For each item, judge the candidate against Sonnet on: **(1)** voice/tone (field curiosity, never a field-guide entry), **(2)** ecological accuracy (no invented facts), **(3)** IEK-first framing survives (whole-ecosystem, non-bird web woven in). Mark a winner or "tie" per item and tally at the bottom.')
  lines.push('')
  lines.push('**Decision rule:** Haiku holds up on all three → flip `INSIGHT_MODEL` to Haiku. Haiku wobbles on the framing → keep Sonnet and lean on Tasks G/H/I for savings.')
  lines.push('')

  const scoreLine = '**Score:** voice ▢  accuracy ▢  framing ▢  →  winner: ______'

  lines.push('---')
  lines.push('')
  lines.push('## Mobile Listens')
  lines.push('')
  let i = 0
  for (const s of mobiles) {
    i++
    process.stdout.write(`  mobile ${i}/${mobiles.length}\r`)
    const built = await buildMobileInsightPrompt(s.body)
    const heard = s.species.slice(0, 6).map(x => `${x.common_name} (${Math.round(x.confidence * 100)}%)`).join(', ')
    const meta = [
      s.row.habitat_type && `habitat=${s.row.habitat_type}`,
      s.row.canopy_cover && `canopy=${s.row.canopy_cover}`,
      s.row.water_present != null && `water=${s.row.water_present ? 'yes' : 'no'}`,
      s.row.disturbance_level && s.row.disturbance_level !== 'none' && `disturbance=${s.row.disturbance_level}`,
    ].filter(Boolean).join(', ') || '—'
    lines.push(`### M${i} · ${(s.row.detected_at || '').slice(0, 16).replace('T', ' ')} · (${s.row.lat}, ${s.row.lon})`)
    lines.push(`**Heard:** ${heard}`)
    lines.push(`**Context sent:** ${meta}`)
    lines.push('')
    if (built.error) {
      lines.push(`_prompt build skipped: ${built.error}_`, '')
      continue
    }
    const results = await generateAll(built.prompt)
    for (const model of MODELS) {
      lines.push(`**${label(model)}:**`, quote(results[model]), '')
    }
    lines.push(scoreLine, '', '---', '')
    await sleep(1100) // Nominatim politeness (mobile builder reverse-geocodes)
  }

  lines.push('## Node detections')
  lines.push('')
  i = 0
  for (const s of nodes) {
    i++
    process.stdout.write(`  node ${i}/${nodes.length}\r`)
    const built = await buildNodeInsightPrompt(s.body)
    lines.push(`### N${i} · ${s.row.species_name || s.row.raw_label} (${Math.round((s.row.confidence || 0) * 100)}%) · detection \`${s.row.id}\``)
    lines.push('')
    if (built.error) {
      lines.push(`_prompt build skipped: ${built.error}_`, '')
      continue
    }
    const results = await generateAll(built.prompt)
    for (const model of MODELS) {
      lines.push(`**${label(model)}:**`, quote(results[model]), '')
    }
    lines.push(scoreLine, '', '---', '')
    await sleep(300)
  }

  lines.push('## Tally')
  lines.push('')
  lines.push('| | Sonnet wins | Haiku wins | Tie |')
  lines.push('|---|---|---|---|')
  lines.push('| Voice | | | |')
  lines.push('| Accuracy | | | |')
  lines.push('| Framing | | | |')
  lines.push('| **Overall winner** | | | |')
  lines.push('')
  lines.push('**Decision:** ______   (then flip `INSIGHT_MODEL` in `api/insight.js`, or keep Sonnet)')
  lines.push('')

  const outPath = join(HERE, `insight-eval-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`)
  writeFileSync(outPath, lines.join('\n'))
  console.log(`\nWrote ${outPath}`)
}

main().catch(err => { console.error('\nEval failed:', err); process.exit(1) })
