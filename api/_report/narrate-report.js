/* global process */
// Node Phenology Report v1 — render a ReportPayload into longer-form, first-person node-voice
// prose. Mirrors the Narrative Agent's invariants (pure function of the payload; the LLM RENDERS,
// it is never the knowledge source) but adapts them to report LENGTH and STANCE:
//   * multi-paragraph, not the single short pulse card
//   * ends on an OPEN WONDERING (the Coyote stance) — a genuine not-knowing that opens, never a
//     verdict with a question stapled on, and never the single-question pulse form
//
// Report-model routing is NEW and intentional: the node-voice report renders on Sonnet (the
// report tier), establishing the report-model seam. A Haiku token is left resolvable as a clean
// fallback, but Sonnet is the v1 path.
//
// Voice scope in v1: NODE VOICE ONLY. The stylized roster (attenborough/comedy/data_scientist) is
// deferred to report v1.1; the node register is read from the shared voice registry (voices.js)
// so there is no drift. Elder/IEK is structurally excluded exactly as in the registry —
// getVoice('elder') → null → reject, never render.
//
// Prompt-building (buildReportPrompt) is split from the model call (generateReport) so the
// grounding can be unit-tested without a live call, mirroring narrate.js / buildNodeInsightPrompt.

import { getVoice } from '../_narrative/voices.js'
import { INSIGHT_MODEL } from '../insight.js'

// Report tier. Kept in ONE place so the report path's model is a single edit (parallel to
// INSIGHT_MODEL). Sonnet is the v1 report model; the node-voice report renders here, not on the
// Haiku insight/narrative tier. See the July 2026 model note in api/insight.js.
export const REPORT_MODEL = 'claude-sonnet-5'

// Voices the report path RENDERS in v1. Node only. Any other id — including the deferred roster
// and 'elder' — is rejected (never silently downgraded to node).
export const REPORT_VOICES = Object.freeze(['node'])

export const REPORT_VOICES_VERSION = 'report-v1'

// How many human/machine noise types to name in the human-activity context line.
const REPORT_ANTHRO_NAMED = 3

// Resolve a voice's model SELECTOR token to a concrete model id. The node report routes to Sonnet;
// 'haiku' resolves to the insight tier as a clean fallback.
function resolveReportModel(token) {
  switch (token) {
    case 'haiku':
      return INSIGHT_MODEL
    case 'sonnet':
    default:
      return REPORT_MODEL
  }
}

// Canonicalize a numeric figure to a SINGLE presented string embedded literally in the scaffold,
// so the model receives the exact text and cannot re-round/reword the value (the same
// number-as-fact discipline as narrate.js `fig`). Ratios/multipliers → one decimal; ACI deltas →
// two.
function fig(x, dp = 1) {
  return Number(x).toFixed(dp)
}

// A readable date from a daily period_key ('YYYY-MM-DD') without pulling a tz library. Framing
// text only; introduces no ecological fact.
function prettyDate(periodKey) {
  const d = new Date(`${periodKey}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return periodKey
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function prettyDayMonth(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

// Cadence-aware framing vocabulary. Style/framing ONLY — carries no ecological fact. Keys the
// wording of the identity line, the activity span ("across the day" / "this season" / "over the
// year"), and the scaffold header, so seasonal/annual reports read in their own time-scale while
// the payload-first grounding is unchanged.
function cadenceFraming(payload) {
  const period = payload.period_key
  switch (payload.cadence) {
    case 'seasonal': {
      const season = payload.phenology?.season || ''
      const year = payload.phenology?.season_year || ''
      return { record: `my record of ${season} ${year}`.trim(), span: 'across this season', noticed: 'THIS SEASON', spanNoun: 'a season', newPhrase: 'new to my records, never detected here before this season' }
    }
    case 'annual':
      return { record: `my record of the year ${payload.phenology?.year || period}`, span: 'over the year', noticed: 'THIS YEAR', spanNoun: 'a year', newPhrase: 'new to my records, never detected here before this year' }
    default:
      return { record: `my record of ${prettyDate(period)}`, span: 'across the day', noticed: 'TODAY', spanNoun: 'a single day', newPhrase: 'new to my records, never detected here before today' }
  }
}

/**
 * Extract ONLY the grounded facts the ReportPayload actually carries, as scaffold lines, in the
 * cadence's own time-scale. Never derives a species/place/relationship/number that isn't in the
 * payload. Returns a flat list of fact strings; a quiet period still yields a valid, honest scaffold.
 * @param {import('./payload.js').ReportPayload} payload
 * @returns {string[]}
 */
export function groundedReportFacts(payload) {
  const lines = []
  const act = payload.activity || {}
  const snd = payload.soundscape || {}
  const phen = payload.phenology || {}
  const f = cadenceFraming(payload)

  // Identity / place framing (no ecological claim beyond what the node record holds).
  const place = payload.node?.place_label || payload.node?.name
  if (place) lines.push(`I am ${place}`)
  if (payload.node?.elevation_m != null) {
    lines.push(`I sit at ${payload.node.elevation_m} ${payload.node.elevation_unit || 'm'} of elevation`)
  }
  lines.push(`This is ${f.record}`)

  // Activity.
  if (act.total_detections > 0) {
    lines.push(
      `${f.span} I heard ${act.total_detections} detection${act.total_detections === 1 ? '' : 's'}, ` +
        `across ${act.distinct_species} distinct species`,
    )
  } else {
    lines.push(`${f.span} I recorded no confident detections`)
  }

  if (Array.isArray(act.top_species) && act.top_species.length) {
    const named = act.top_species
      .map((s) => `${s.species_name} (${s.count} time${s.count === 1 ? '' : 's'})`)
      .join(', ')
    lines.push(`the species I heard most: ${named}`)
  }

  // New-for-this-node (first-ever here). A distinctive phenology fact — carried explicitly.
  if (Array.isArray(payload.new_species) && payload.new_species.length) {
    const names = payload.new_species.map((s) => s.species_name).join(', ')
    lines.push(`${f.newPhrase}: ${names}`)
  }

  // ── Seasonal phenology: arrivals / departures / week-over-week ──────────────
  if (payload.cadence === 'seasonal') {
    if (Array.isArray(phen.arrivals) && phen.arrivals.length) {
      const a = phen.arrivals.map((s) => `${s.species_name} (first on ${prettyDayMonth(s.first_seen)})`).join(', ')
      lines.push(`the earliest voices of the season: ${a}`)
    }
    if (Array.isArray(phen.departures) && phen.departures.length) {
      const dparts = phen.departures.map((s) => `${s.species_name} (last on ${prettyDayMonth(s.last_seen)})`).join(', ')
      lines.push(`the ones I last heard earliest in the season: ${dparts}`)
    }
    if (Array.isArray(phen.weekly) && phen.weekly.length >= 2) {
      const first = phen.weekly[0]
      const last = phen.weekly[phen.weekly.length - 1]
      lines.push(
        `across the weeks my activity moved from ${first.detections} detections in my first week to ${last.detections} in my last, ` +
          `and my diversity from ${first.distinct_species} species to ${last.distinct_species}`,
      )
    }
  }

  // ── Annual phenology: seasonal transitions / milestone ──────────────────────
  if (payload.cadence === 'annual') {
    if (Array.isArray(phen.seasonal_breakdown) && phen.seasonal_breakdown.length) {
      const parts = phen.seasonal_breakdown
        .map((s) => `${s.season} held ${s.detections} detections across ${s.distinct_species} species`)
        .join('; ')
      lines.push(`season by season: ${parts}`)
    }
    if (phen.milestone?.total_species_all_time != null) {
      lines.push(
        `in all my time here, ${phen.milestone.total_species_all_time} distinct species have now been recorded, ` +
          `${phen.milestone.new_species_this_year} of them first heard this year`,
      )
    }
  }

  // Notable pulses — Pulse-selected, already summarized to one grounded line each.
  for (const p of payload.notable_pulses || []) {
    if (p.summary) lines.push(p.summary)
  }

  // Soundscape trend + peak activity band. For seasonal/annual the trend is early-edge vs late-edge
  // ("across the period"); for daily it is vs the recent baseline.
  const trendRef = payload.cadence === 'daily' ? 'my recent baseline' : 'the start of the period'
  if (snd.trend === 'busier' || snd.trend === 'quieter') {
    lines.push(
      `my soundscape was ${snd.trend} than ${trendRef}` +
        (snd.delta != null ? `, a change in acoustic complexity of ${fig(snd.delta, 2)}` : ''),
    )
  } else if (snd.trend === 'steady') {
    lines.push(`my soundscape held steady against ${trendRef}`)
  }
  if (snd.peak_window?.label) {
    const gathered = payload.cadence === 'daily' ? 'my activity gathered most in' : 'across the period my activity gathered most in'
    lines.push(`${gathered} ${snd.peak_window.label}`)
  }

  // Human activity — anthropophony (engines, human noise) as AMBIENT CONTEXT, not a voice. Grounded
  // only in the human_activity field. Never counted among the species, never named as a voice of
  // the place; the framing marks it as passing human presence in the soundscape.
  const ha = payload.human_activity
  if (ha && ha.count > 0) {
    const types = (ha.types || []).map((t) => t.label).slice(0, REPORT_ANTHRO_NAMED).join(', ')
    lines.push(
      `under the voices there was also human presence, not a voice of mine but sound passing through: ` +
        `${ha.count} detection${ha.count === 1 ? '' : 's'} of human or machine noise${types ? ` (${types})` : ''}`,
    )
  }

  return lines
}

/**
 * Pure: build the report render prompt in THREE FIXED SEGMENTS, in order:
 *   1. grounded scaffold — place framing + the ONLY facts (payload-derived, voice-independent)
 *   2. voice directives  — register/tone ONLY (from the shared registry; never a source of facts)
 *   3. invariant rules   — grounding + report length + the open-wondering ending
 * Facts live only in segment 1. Returns { skip: true } when there is nothing grounded to say.
 * @param {import('./payload.js').ReportPayload} payload
 * @param {{styleDirectives:string}} voice  a resolved node-voice config (from getVoice)
 * @returns {{skip:true} | {prompt:string, segments:{scaffold:string, voice:string, invariants:string}}}
 */
export function buildReportPrompt(payload, voice) {
  const facts = groundedReportFacts(payload)
  // A payload with no detections AND no pulses has nothing to author about beyond identity.
  const hasSubstance = payload.activity?.total_detections > 0 || (payload.notable_pulses || []).length > 0
  if (!facts.length || !hasSubstance) return { skip: true }

  const factBlock = facts.map((f) => `- ${f}`).join('\n')
  const f = cadenceFraming(payload)
  // Annual is the most narrative cadence (the year's arc) and leans hardest on the report model, so
  // it gets a touch more room; daily/seasonal stay tight.
  const paragraphs = payload.cadence === 'annual' ? '3 to 5 short paragraphs' : '2 to 4 short paragraphs'

  // Segment 1 — grounded scaffold (voice-independent). Place framing + the ONLY facts.
  const scaffold = `You are a specific place in the Magora ecological network, writing your own report of ${f.spanNoun} of your ecological activity. You are the place itself, the author of this record, not a person and not a field guide. Every place is speaking; this is you speaking about yourself.

WHAT I NOTICED ${f.noticed} (these are the ONLY facts you may use):
${factBlock}`

  // Segment 2 — voice directives (STYLE ONLY; facts are fixed above, this only recolors HOW).
  const voiceSeg = `VOICE — how to say it (style only, never a source of facts):
${voice.styleDirectives}`

  // Segment 3 — invariant instructions. Grounding is identical to the pulse narrative; the length
  // and the ENDING differ: a report is multi-paragraph and closes on an open wondering (the Coyote
  // stance), not the single-question pulse form.
  const invariants = `Write a short report of ${paragraphs}. These rules are absolute:
- Use ONLY the facts above. Never introduce a species, place, relationship, number, season, or cause that is not stated above.
- Use every figure exactly as written in the facts above. Do not round, rescale, approximate, or restate any number in words that changes its value.
- Do not claim to know WHY anything happened unless the facts say so. Wonder, do not assert. Never present a possible relationship, reason, or connection as an established fact.
- Speak as the place, in the first person, about yourself. Introduce no people, no names, and no reader instructions that are not in the facts above.
- If the facts mention human or machine noise (human presence), treat it ONLY as passing ambient background in your soundscape. Never name it as one of your voices, never count it among your species, never let it carry the report.
- Plain prose, commas and periods, never em-dashes.
- End on an OPEN WONDERING: a final sentence that genuinely does not know, that opens outward toward what might be unfolding here rather than summing up. It must arise from the facts above. Do not end on a verdict, a conclusion, or a tidy moral, and do not staple a question onto a conclusion. A single genuine wondering, and nothing after it.`

  return { prompt: `${scaffold}\n\n${voiceSeg}\n\n${invariants}`, segments: { scaffold, voice: voiceSeg, invariants } }
}

// Turn a fully-assembled prompt into report prose on the report tier. Kept separate from prompt
// building (parallel to generateInsight) so the grounding is unit-testable without a live call.
// max_tokens is higher than the insight/narrative path — a report is multi-paragraph. Enforces the
// house style (commas and periods, never em-dashes) regardless of model, matching generateInsight.
async function callReportModel(prompt, model) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!response.ok) return { httpError: await response.text() }
  // Robustly extract the text block. A messages response is normally a single text block, but an
  // occasional call returns an empty content array or a leading non-text block; assuming
  // content[0].text there throws and 500s the whole request. Treat "no usable text" as an empty
  // response the caller can retry.
  const data = await response.json()
  const block = Array.isArray(data.content) ? (data.content.find((b) => b?.type === 'text') ?? data.content[0]) : null
  const text = block?.text
  if (typeof text !== 'string' || !text.trim()) return { empty: true, stop_reason: data.stop_reason ?? 'unknown' }
  return { text }
}

export async function generateReport(prompt, model = REPORT_MODEL) {
  // Sonnet occasionally returns an empty/non-text first block (~1 in 6 observed on the report
  // prompt). A single retry makes that transient near-invisible; a persistent empty response or an
  // HTTP error degrades to a clean { error } so the caller returns a handled 502 and the
  // check-before-generate path regenerates next time (never an uncaught 500).
  let last
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await callReportModel(prompt, model)
    if (last.text != null) {
      // House style is commas and periods, never em-dashes, regardless of model (matches generateInsight).
      return { text: last.text.replace(/\s*—\s*/g, ', ') }
    }
    if (last.httpError) return { error: last.httpError } // HTTP errors are likely persistent — don't retry
  }
  return { error: `empty model response (stop_reason: ${last.stop_reason})` }
}

/**
 * Render a ReportPayload into longer-form node-voice prose ending on an open wondering. The voice
 * restyles register/tone only; the facts are fixed by the payload. v1 supports the NODE voice
 * only — unknown / unregistered / disabled / non-node ids (incl. 'elder', and the deferred roster)
 * HARD-REJECT; no silent fallback.
 * @param {import('./payload.js').ReportPayload} payload
 * @param {string} [voice]  a report-supported voice id (default 'node')
 * @returns {Promise<{ text:string, voice:string, model:string, voices_version:string } | { error:string } | null>}
 *   null when there is nothing to render (a quiet day with no substance).
 */
export async function narrateReport(payload, voice = 'node') {
  // v1 renders the node voice only. Reject anything else — including a registered roster voice
  // (deferred) or 'elder' (structurally excluded via getVoice).
  if (!REPORT_VOICES.includes(voice)) return { error: `unknown or unavailable report voice: ${voice}` }
  const cfg = getVoice(voice)
  if (!cfg) return { error: `unknown or unavailable report voice: ${voice}` }

  const built = buildReportPrompt(payload, cfg)
  if (built.skip) return null

  const model = resolveReportModel('sonnet') // node report routes to the report tier (Sonnet)
  const out = await generateReport(built.prompt, model)
  if (out.error) return { error: out.error }

  return { text: out.text.trim(), voice: cfg.id, model, voices_version: REPORT_VOICES_VERSION }
}
