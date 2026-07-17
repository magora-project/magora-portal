// Node Phenology Report — canonical ReportPayload contract + cadence aggregation builders.
//
// This directory is underscore-prefixed (api/_report/) so Vercel does NOT treat these modules
// as routable serverless functions — only api/report-ondemand.js and api/report-cron.js are
// endpoints; they import the shared builders from here.
//
// A Node Phenology Report gives a node a periodic FIRST-PERSON narrative of its own ecological
// activity ("every place is speaking / the node is the author"). Like Pulse's payload, the
// ReportPayload is voice-agnostic and DB-grounded: this builder decides WHAT the report may say
// (facts only, from the DB); api/_report/narrate-report.js decides only HOW it is said. The
// payload is the SOLE knowledge source — narration invents nothing not present here.
//
// Reuse, don't fork: reads go through the same PostgREST layer as Pulse (api/_pulse/db.js) and
// honor the SAME range-gate quarantine exclusion (RANGE_OK). Notable pulses are Pulse-SELECTED
// via the shared node_report surface affordance (assignSurfaces) and are NEVER re-ranked here.
//
// CADENCES (v1.1): daily | seasonal | annual — all on the SAME contract, cache, and RPC. The
// store is jsonb + free-text cadence/period_key, so the seasonal/annual builders add fields with
// NO migration. Seasonal/annual are node-internal phenology only (no external baseline in v1.1).

import { pgFetch, rowToPayload } from '../_pulse/db.js'
import { nodeCoords, aciMean, hasPriorDetection } from '../_pulse/sources.js'
import { assignSurfaces } from '../_pulse/select.js'
import { PULSE_CONFIG } from '../_pulse/payload.js'
import { classifyLabel, isVoice } from './labels.js'

const enc = encodeURIComponent

// Range gate (20260720): a quarantined detection (a penguin, a Rook at Casa Colibri) must never
// enter a report — exclude it from EVERY detections read. Null-safe → fail-open, matching the
// gate's own convention and the identical constant in api/_pulse/sources.js and api/insight.js.
const RANGE_OK = 'or=(range_status.is.null,range_status.neq.quarantined)'

// Detection confidence floor, matching MIN_CONFIDENCE on the read-side (src/lib/supabase.js).
const MIN_CONFIDENCE = 0.3

// How many species / pulses / arrivals the payload carries into the narrative. The scaffold
// summarizes; these caps keep the grounded prompt bounded.
const REPORT_TOP_SPECIES = 6
const REPORT_MAX_PULSES = 4
const REPORT_MAX_MOVEMENTS = 6 // arrivals / departures shown per seasonal report
const REPORT_ANTHRO_TYPES = 4 // human/machine noise types surfaced in the human_activity context

/**
 * @typedef {"daily"|"seasonal"|"annual"|string} ReportCadence
 */

/**
 * @typedef {Object} ReportWindow
 * @property {string} start   ISO timestamp (inclusive)
 * @property {string} end     ISO timestamp (exclusive)
 * @property {ReportCadence} cadence
 * @property {string} period_key   the cache/permalink key (daily 'YYYY-MM-DD', seasonal 'YYYY-<season>', annual 'YYYY')
 */

/**
 * The canonical, voice-agnostic Node Phenology Report payload. Every field is DB-grounded; the
 * narrator may use ONLY what is here. Stored as `node_reports.payload` (jsonb). The `phenology`
 * block is cadence-shaped (daily: week_of_year; seasonal: weekly/arrivals/departures/season;
 * annual: seasonal_breakdown/milestone/year) — additive, no migration.
 * @typedef {Object} ReportPayload
 * @property {string} node_id
 * @property {ReportCadence} cadence
 * @property {string} period_key
 * @property {ReportWindow} window
 * @property {string} generated_at
 * @property {{ id:string, name:string|null, place_label:string|null, elevation_m:number|null, elevation_unit:string|null, lat:number|null, lon:number|null }} node
 * @property {{ total_detections:number, distinct_species:number, top_species:object[] }} activity
 * @property {{ species_name:string, first_seen:string }[]} new_species
 * @property {object[]} notable_pulses
 * @property {object} soundscape
 * @property {{ count:number, distinct_types:number, types:{label:string,count:number}[] }} human_activity  anthropophony context — never a voice
 * @property {object} phenology
 * @property {{ has_detections:boolean, has_aci:boolean, degraded:boolean }} coverage
 */

/** All cadences the contract implements. */
export const REPORT_CADENCES = /** @type {ReportCadence[]} */ (['daily', 'seasonal', 'annual'])

// ── Meteorological, hemisphere-aware seasons ─────────────────────────────────
// Seasons are the 3-month meteorological blocks (DJF/MAM/JJA/SON). The BLOCK is hemisphere-
// independent; only the NAME flips across the equator. `season year` is keyed by the Jan/Feb year
// (so DJF spanning Dec Y-1 → Feb Y is season year Y). Node latitude decides the hemisphere.
const N_NAMES = { DJF: 'winter', MAM: 'spring', JJA: 'summer', SON: 'autumn' }
const S_NAMES = { DJF: 'summer', MAM: 'autumn', JJA: 'winter', SON: 'spring' }
const NAME_TO_BLOCK_N = { winter: 'DJF', spring: 'MAM', summer: 'JJA', autumn: 'SON' }
const NAME_TO_BLOCK_S = { summer: 'DJF', autumn: 'MAM', winter: 'JJA', spring: 'SON' }
const SEASON_NAMES = new Set(['winter', 'spring', 'summer', 'autumn'])

function seasonName(block, lat) {
  return ((lat ?? 0) < 0 ? S_NAMES : N_NAMES)[block]
}

// The meteorological block containing a date, plus its season year.
function seasonalBlock(d) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() // 0=Jan
  if (m === 11) return { block: 'DJF', seasonYear: y + 1 } // Dec → winter of next year
  if (m <= 1) return { block: 'DJF', seasonYear: y } // Jan/Feb
  if (m <= 4) return { block: 'MAM', seasonYear: y }
  if (m <= 7) return { block: 'JJA', seasonYear: y }
  return { block: 'SON', seasonYear: y }
}

// [start, end) UTC for a block + season year.
function blockWindow(block, seasonYear) {
  const y = seasonYear
  switch (block) {
    case 'DJF': return [Date.UTC(y - 1, 11, 1), Date.UTC(y, 2, 1)]
    case 'MAM': return [Date.UTC(y, 2, 1), Date.UTC(y, 5, 1)]
    case 'JJA': return [Date.UTC(y, 5, 1), Date.UTC(y, 8, 1)]
    default: return [Date.UTC(y, 8, 1), Date.UTC(y, 11, 1)] // SON
  }
}

// ── Window resolution (one resolver per cadence) ─────────────────────────────
/**
 * Daily window from a date (UTC calendar day). period_key = the date. Default = today (UTC).
 * @param {string} [date] 'YYYY-MM-DD'
 */
export function resolveDailyWindow(date) {
  const period_key = date || new Date().toISOString().slice(0, 10)
  const dayStart = new Date(`${period_key}T00:00:00.000Z`)
  if (Number.isNaN(dayStart.getTime())) throw new Error(`invalid report date: ${date}`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  return { start: dayStart.toISOString(), end: dayEnd.toISOString(), cadence: 'daily', period_key }
}

/**
 * Seasonal window. Accepts either a period_key ('YYYY-<season>') or a reference date; needs the
 * node latitude to name/resolve the season by hemisphere. period_key = 'YYYY-<season>'.
 * @param {string} [dateOrKey]
 * @param {number|null} lat
 */
export function resolveSeasonalWindow(dateOrKey, lat) {
  let block, seasonYear, name
  const keyMatch = typeof dateOrKey === 'string' && /^(\d{4})-(winter|spring|summer|autumn)$/.exec(dateOrKey)
  if (keyMatch) {
    seasonYear = Number(keyMatch[1])
    name = keyMatch[2]
    block = ((lat ?? 0) < 0 ? NAME_TO_BLOCK_S : NAME_TO_BLOCK_N)[name]
  } else {
    const ref = dateOrKey ? new Date(`${dateOrKey}T00:00:00.000Z`) : new Date()
    if (Number.isNaN(ref.getTime())) throw new Error(`invalid seasonal key/date: ${dateOrKey}`)
    ;({ block, seasonYear } = seasonalBlock(ref))
    name = seasonName(block, lat)
  }
  const [s, e] = blockWindow(block, seasonYear)
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString(), cadence: 'seasonal', period_key: `${seasonYear}-${name}` }
}

/**
 * Annual window. Accepts a period_key ('YYYY') or a reference date. period_key = 'YYYY'.
 * @param {string} [dateOrKey]
 */
export function resolveAnnualWindow(dateOrKey) {
  let year
  if (typeof dateOrKey === 'string' && /^\d{4}$/.test(dateOrKey)) year = Number(dateOrKey)
  else if (dateOrKey) {
    const d = new Date(`${dateOrKey}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) throw new Error(`invalid annual key/date: ${dateOrKey}`)
    year = d.getUTCFullYear()
  } else year = new Date().getUTCFullYear()
  return { start: new Date(Date.UTC(year, 0, 1)).toISOString(), end: new Date(Date.UTC(year + 1, 0, 1)).toISOString(), cadence: 'annual', period_key: String(year) }
}

/**
 * Resolve the cache/permalink period_key for a cadence from a period_key-or-date. Pure (needs lat
 * for seasonal). Lets the endpoint/cron cache-check BEFORE building.
 * @param {ReportCadence} cadence
 * @param {string} [dateOrKey]
 * @param {number|null} [lat]
 */
export function resolvePeriodKey(cadence, dateOrKey, lat) {
  switch (cadence) {
    case 'daily': return resolveDailyWindow(dateOrKey).period_key
    case 'seasonal': return resolveSeasonalWindow(dateOrKey, lat).period_key
    case 'annual': return resolveAnnualWindow(dateOrKey).period_key
    default: throw new Error(`unsupported cadence: ${cadence}`)
  }
}

// ISO week-of-year (1..53).
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
}

// Monday (UTC) that starts the ISO week of a date, as 'YYYY-MM-DD'. Sortable week bucket key that
// stays correct across a year boundary (unlike the raw week number, which wraps 52→1).
function weekStartKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() - (day - 1))
  return t.toISOString().slice(0, 10)
}

// ── Raw detection read (paginated grounded aggregation source) ───────────────
// PostgREST enforces a server-side db-max-rows cap (1000) that silently truncates a GET regardless
// of `limit`. Because "numbers are facts", we page via limit+offset until a short page returns, so
// the aggregation sees EVERY non-quarantined detection in the window — daily OR season/year-long.
const REPORT_PAGE_SIZE = 1000
const REPORT_MAX_PAGES = 400 // 400k detections/window ceiling — beyond any real annual window

async function detectionRows(nodeId, window) {
  const all = []
  for (let page = 0; page < REPORT_MAX_PAGES; page++) {
    const batch = await pgFetch(
      `detections?node_id=eq.${nodeId}` +
        `&detected_at=gte.${enc(window.start)}&detected_at=lt.${enc(window.end)}` +
        `&confidence=gte.${MIN_CONFIDENCE}&${RANGE_OK}` +
        `&select=species_name,confidence,detected_at&order=detected_at.asc` +
        `&limit=${REPORT_PAGE_SIZE}&offset=${page * REPORT_PAGE_SIZE}`,
      true,
    )
    all.push(...batch)
    if (batch.length < REPORT_PAGE_SIZE) break
  }
  return all
}

// Classify every distinct label in the window into bird | biophony | anthropophony (labels.js).
// One batched species-taxonomy read (in.()), chunked to stay under URL limits; labels with no
// species row are classified from the name alone (curated anthropophony set, else biophony).
async function classifyWindowSpecies(names) {
  const uniq = [...new Set(names)]
  const byName = new Map()
  const CHUNK = 100
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const inList = uniq.slice(i, i + CHUNK).map((n) => `"${String(n).replace(/["\\]/g, '')}"`).join(',')
    const spRows = await pgFetch(
      `species?common_name=in.(${enc(inList)})&select=common_name,scientific_name,ebird_code,taxon_class,order_name,family`,
      true,
    )
    for (const r of spRows) byName.set(r.common_name, r)
  }
  const map = new Map()
  for (const n of uniq) map.set(n, classifyLabel(byName.get(n) || { common_name: n }))
  return map
}

// Aggregate anthropophony rows into the human-activity context: total count + distinct noise types.
// Never a species tally, never a voice — the report weaves this into soundscape context.
function aggregateAnthro(rows) {
  const byType = new Map()
  for (const r of rows) {
    if (!r.species_name) continue
    byType.set(r.species_name, (byType.get(r.species_name) || 0) + 1)
  }
  const types = [...byType.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  const count = types.reduce((s, t) => s + t.count, 0)
  return { count, distinct_types: types.length, types: types.slice(0, REPORT_ANTHRO_TYPES) }
}

// Aggregate raw rows into per-species stats + totals + hour-of-day histogram.
function aggregate(rows) {
  const bySpecies = new Map()
  const hourCounts = new Array(24).fill(0)
  let total = 0
  for (const r of rows) {
    if (!r.species_name) continue
    total += 1
    const cur = bySpecies.get(r.species_name)
    if (!cur) {
      bySpecies.set(r.species_name, {
        species_name: r.species_name,
        first_seen: r.detected_at,
        last_seen: r.detected_at,
        count: 1,
        confidence_max: r.confidence ?? 0,
      })
    } else {
      cur.count += 1
      cur.last_seen = r.detected_at
      if ((r.confidence ?? 0) > cur.confidence_max) cur.confidence_max = r.confidence ?? 0
    }
    const h = new Date(r.detected_at).getUTCHours()
    if (h >= 0 && h < 24) hourCounts[h] += 1
  }
  return { bySpecies, hourCounts, total }
}

// Hour label from a 0..23 UTC bucket.
function hourLabel(h) {
  if (h >= 21 || h < 4) return 'the night'
  if (h < 7) return 'the pre-dawn and early morning'
  if (h < 10) return 'the morning'
  if (h < 12) return 'the late morning'
  if (h < 14) return 'midday'
  if (h < 17) return 'the afternoon'
  if (h < 19) return 'the early evening'
  return 'dusk'
}

// Peak 3-hour band from the hour histogram. For daily, a concrete span on the day (start/end ISO);
// for seasonal/annual, a recurring time-of-day pattern (label + count only, start/end null).
function peakBand(hourCounts, dayStart) {
  let bestStart = 0
  let bestSum = -1
  for (let h = 0; h < 24; h++) {
    const sum = hourCounts[h] + hourCounts[(h + 1) % 24] + hourCounts[(h + 2) % 24]
    if (sum > bestSum) { bestSum = sum; bestStart = h }
  }
  if (bestSum <= 0) return null
  if (dayStart) {
    const startMs = dayStart.getTime() + bestStart * 3600000
    return { start: new Date(startMs).toISOString(), end: new Date(startMs + 3 * 3600000).toISOString(), label: hourLabel(bestStart), count: bestSum }
  }
  return { start: null, end: null, label: hourLabel(bestStart), count: bestSum }
}

// One-line, payload-derived summary of a notable pulse.
function pulseSummary(p) {
  const species = Array.isArray(p.subject?.species) && p.subject.species.length ? p.subject.species[0] : null
  const ev = p.evidence || {}
  switch (p.kind) {
    case 'novel_detection':
      return species ? `${species} was detected here for the first time in my records` : `a species new to my records was detected here`
    case 'activity_spike':
      return ev.ratio != null ? `bird activity rose to ${Number(ev.ratio).toFixed(1)} times my recent baseline` : `bird activity rose above my recent baseline`
    case 'soundscape_shift':
      return `my soundscape ${ev.direction === 'down' ? 'grew quieter' : 'grew busier'} than my recent baseline`
    case 'survey_gap_question':
      return p.survey_gap?.question_focus || `there is something here I do not yet have a clear read on`
    default:
      return `something worth noting happened here`
  }
}

// Notable pulses (Pulse-selected, NOT re-ranked). Any pulses whose window falls inside the report
// window, in Pulse's OWN score order, routed through the shared node_report surface affordance.
// For seasonal/annual this READS the daily pulses accumulated across the period — pulseBatch is
// never run on a long window (its scoring is daily-grained).
async function notablePulses(nodeId, window) {
  const rows = await pgFetch(
    `pulses?node_id=eq.${nodeId}` +
      `&window_start=gte.${enc(window.start)}&window_start=lt.${enc(window.end)}` +
      `&select=*&order=score.desc`,
    true,
  )
  if (!rows.length) return []
  const ranked = rows.map(rowToPayload)
  const { per_surface } = assignSurfaces(ranked, ['node_report'])
  const chosenIds = (per_surface.node_report || []).slice(0, REPORT_MAX_PULSES)
  const byId = new Map(ranked.map((p) => [p.pulse_id, p]))
  return chosenIds.map((idv) => {
    const p = byId.get(idv)
    return { pulse_id: p.pulse_id, kind: p.kind, subject: p.subject, evidence: p.evidence, score: p.score, summary: pulseSummary(p) }
  })
}

// Distinct species ever recorded on the node before `before` (paginated, cap-safe). For annual
// milestones ("Nth species recorded here").
async function distinctSpeciesBefore(nodeId, before) {
  const set = new Set()
  for (let page = 0; page < REPORT_MAX_PAGES; page++) {
    const batch = await pgFetch(
      `detections?node_id=eq.${nodeId}&detected_at=lt.${enc(before)}&confidence=gte.${MIN_CONFIDENCE}&${RANGE_OK}` +
        `&select=species_name&order=detected_at.asc&limit=${REPORT_PAGE_SIZE}&offset=${page * REPORT_PAGE_SIZE}`,
      true,
    )
    for (const r of batch) if (r.species_name) set.add(r.species_name)
    if (batch.length < REPORT_PAGE_SIZE) break
  }
  return set
}

// Soundscape trend across a long window: mean ACI over the LATE edge vs the EARLY edge (each a
// bounded ≤1000-log read, so cap-safe and unbiased — a single season/year mean would be truncated
// to its first 1000 logs). This is the honest "did the soundscape shift across the period" signal.
async function edgeTrend(nodeId, window, edgeDays) {
  const start = new Date(window.start)
  const end = new Date(window.end)
  const earlyEnd = new Date(start.getTime() + edgeDays * 86400000).toISOString()
  const lateStart = new Date(end.getTime() - edgeDays * 86400000).toISOString()
  const [early, late] = await Promise.all([
    aciMean(nodeId, window.start, earlyEnd),
    aciMean(nodeId, lateStart, window.end),
  ])
  const delta = early.mean != null && late.mean != null ? late.mean - early.mean : null
  let trend = null
  if (delta != null) trend = Math.abs(delta) < PULSE_CONFIG.aciMinDelta ? 'steady' : delta > 0 ? 'busier' : 'quieter'
  return { mean_aci: late.mean, baseline_mean_aci: early.mean, delta, trend, sample_count: late.sampleCount, edge_days: edgeDays }
}

// Shared gather: the DB-grounded facts every cadence needs. new_species = first-ever on THIS node.
async function gatherCommon(nodeId, window) {
  const [{ node, lat, lon }, rawRows, pulses] = await Promise.all([
    nodeCoords(nodeId),
    detectionRows(nodeId, window),
    notablePulses(nodeId, window),
  ])

  // Label quality: partition the window's detections. bird + biophony are the place's VOICES and
  // feed the species aggregation + tallies; anthropophony (human/machine noise) is pulled out and
  // becomes ambient human-activity context — never a voice, never counted as a species. Insect /
  // amphibian / mammal biophony (katydids, frogs, a coyote) stays a voice. Applies to every cadence
  // (this is the shared builder).
  const cls = await classifyWindowSpecies(rawRows.map((r) => r.species_name).filter(Boolean))
  const rows = rawRows.filter((r) => isVoice(cls.get(r.species_name)))
  const anthroRows = rawRows.filter((r) => cls.get(r.species_name) === 'anthropophony')
  const human_activity = aggregateAnthro(anthroRows)

  const { bySpecies, hourCounts, total } = aggregate(rows)
  const species = [...bySpecies.values()].sort((a, b) => b.count - a.count)
  const newFlags = await Promise.all(species.map((s) => hasPriorDetection(nodeId, s.species_name, window.start)))
  const new_species = species.filter((_, i) => !newFlags[i]).map((s) => ({ species_name: s.species_name, first_seen: s.first_seen }))
  return { node, lat, lon, rows, bySpecies, species, hourCounts, total, pulses, new_species, human_activity }
}

// Common node identity + activity + coverage assembly, shared across cadences.
function assemble({ nodeId, window, node, lat, lon, species, total, new_species, pulses, soundscape, phenology, aciSampleCount, human_activity }) {
  return {
    node_id: nodeId,
    cadence: window.cadence,
    period_key: window.period_key,
    window,
    generated_at: new Date().toISOString(),
    node: {
      id: node?.id ?? nodeId,
      name: node?.name ?? null,
      place_label: node?.name ?? null,
      elevation_m: node?.elevation_m ?? null,
      elevation_unit: node?.elevation_unit ?? null,
      lat,
      lon,
    },
    activity: {
      total_detections: total,
      distinct_species: species.length,
      top_species: species.slice(0, REPORT_TOP_SPECIES),
    },
    new_species,
    notable_pulses: pulses,
    soundscape,
    // Anthropogenic sound (engines, human noise) reframed as context — never a species voice.
    human_activity: human_activity || { count: 0, distinct_types: 0, types: [] },
    phenology,
    coverage: {
      has_detections: total > 0,
      has_aci: aciSampleCount > 0,
      degraded: total === 0,
    },
  }
}

// ── Daily builder (v1 semantics preserved exactly) ──────────────────────────
/**
 * @param {string} nodeId
 * @param {string} [date] 'YYYY-MM-DD'
 * @returns {Promise<ReportPayload>}
 */
export async function buildDailyReport(nodeId, date) {
  const window = resolveDailyWindow(date)
  const dayStart = new Date(window.start)
  const baselineStart = new Date(dayStart.getTime() - PULSE_CONFIG.aciBaselineDays * 86400000).toISOString()

  const common = await gatherCommon(nodeId, window)
  const [windowAci, baselineAci] = await Promise.all([
    aciMean(nodeId, window.start, window.end),
    aciMean(nodeId, baselineStart, window.start),
  ])

  const delta = windowAci.mean != null && baselineAci.mean != null ? windowAci.mean - baselineAci.mean : null
  let trend = null
  if (delta != null) trend = Math.abs(delta) < PULSE_CONFIG.aciMinDelta ? 'steady' : delta > 0 ? 'busier' : 'quieter'

  const firstDates = common.species.map((s) => s.first_seen).filter(Boolean).sort()
  const lastDates = common.species.map((s) => s.last_seen).filter(Boolean).sort()

  return assemble({
    nodeId, window, node: common.node, lat: common.lat, lon: common.lon,
    species: common.species, total: common.total, new_species: common.new_species, pulses: common.pulses,
    aciSampleCount: windowAci.sampleCount,
    human_activity: common.human_activity,
    soundscape: {
      mean_aci: windowAci.mean,
      baseline_mean_aci: baselineAci.mean,
      delta, trend,
      sample_count: windowAci.sampleCount,
      peak_window: peakBand(common.hourCounts, dayStart),
    },
    phenology: {
      period_key: window.period_key,
      week_of_year: isoWeek(dayStart),
      first_detection_date: firstDates[0] ?? null,
      last_detection_date: lastDates[lastDates.length - 1] ?? null,
      new_species_count: common.new_species.length,
    },
  })
}

// ── Seasonal builder ────────────────────────────────────────────────────────
/**
 * Seasonal report: per-species first/last-of-season arrivals & departures, week-over-week
 * activity/diversity, and the seasonal ACI trend (early edge vs late edge). Node-internal only.
 * @param {string} nodeId
 * @param {string} [dateOrKey] 'YYYY-<season>' or a date within the season
 * @returns {Promise<ReportPayload>}
 */
export async function buildSeasonalReport(nodeId, dateOrKey) {
  const { lat: latPeek } = await nodeCoords(nodeId)
  const window = resolveSeasonalWindow(dateOrKey, latPeek)
  const common = await gatherCommon(nodeId, window)
  const soundscape = await edgeTrend(nodeId, window, 14)

  // Arrivals: earliest first-of-season detections. Departures: earliest to fall silent (last-seen
  // ascending). Both are pure timestamp sorts over the grounded per-species first/last.
  const arrivals = [...common.bySpecies.values()]
    .sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen))
    .slice(0, REPORT_MAX_MOVEMENTS)
    .map((s) => ({ species_name: s.species_name, first_seen: s.first_seen }))
  const departures = [...common.bySpecies.values()]
    .sort((a, b) => new Date(a.last_seen) - new Date(b.last_seen))
    .slice(0, REPORT_MAX_MOVEMENTS)
    .map((s) => ({ species_name: s.species_name, last_seen: s.last_seen }))

  // Week-over-week series across the season (detections + distinct species per ISO week).
  const byWeek = new Map()
  for (const r of common.rows) {
    if (!r.species_name) continue
    const wk = weekStartKey(new Date(r.detected_at))
    let e = byWeek.get(wk)
    if (!e) { e = { week_start: wk, detections: 0, species: new Set() }; byWeek.set(wk, e) }
    e.detections += 1
    e.species.add(r.species_name)
  }
  const weekly = [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map((e) => ({ week_start: e.week_start, detections: e.detections, distinct_species: e.species.size }))

  const firstDates = common.species.map((s) => s.first_seen).filter(Boolean).sort()
  const lastDates = common.species.map((s) => s.last_seen).filter(Boolean).sort()
  const [year, name] = window.period_key.split('-')

  return assemble({
    nodeId, window, node: common.node, lat: common.lat, lon: common.lon,
    species: common.species, total: common.total, new_species: common.new_species, pulses: common.pulses,
    aciSampleCount: soundscape.sample_count,
    human_activity: common.human_activity,
    soundscape: { ...soundscape, peak_window: peakBand(common.hourCounts, null) },
    phenology: {
      period_key: window.period_key,
      season: name,
      season_year: Number(year),
      arrivals,
      departures,
      weekly,
      first_detection_date: firstDates[0] ?? null,
      last_detection_date: lastDates[lastDates.length - 1] ?? null,
      new_species_count: common.new_species.length,
    },
  })
}

// ── Annual builder ──────────────────────────────────────────────────────────
/**
 * Annual report: the year's arc — totals, per-species first/last dates (top_species), seasonal
 * transitions (detections + diversity per meteorological season), and milestones (cumulative
 * species recorded here). Node-internal only.
 * @param {string} nodeId
 * @param {string} [dateOrKey] 'YYYY' or a date within the year
 * @returns {Promise<ReportPayload>}
 */
export async function buildAnnualReport(nodeId, dateOrKey) {
  const window = resolveAnnualWindow(dateOrKey)
  const common = await gatherCommon(nodeId, window)
  const [soundscape, priorSpecies] = await Promise.all([
    edgeTrend(nodeId, window, 30),
    distinctSpeciesBefore(nodeId, window.start),
  ])

  // Seasonal breakdown: detections + distinct species per season block within the year.
  const byBlock = new Map()
  for (const r of common.rows) {
    if (!r.species_name) continue
    const { block } = seasonalBlock(new Date(r.detected_at))
    let e = byBlock.get(block)
    if (!e) { e = { block, detections: 0, species: new Set() }; byBlock.set(block, e) }
    e.detections += 1
    e.species.add(r.species_name)
  }
  const BLOCK_ORDER = ['DJF', 'MAM', 'JJA', 'SON']
  const seasonal_breakdown = BLOCK_ORDER.filter((b) => byBlock.has(b)).map((b) => {
    const e = byBlock.get(b)
    return { season: seasonName(b, common.lat), detections: e.detections, distinct_species: e.species.size }
  })

  // Milestone: how many distinct species have EVER been recorded here, and how many of them arrived
  // this year (grounded, cumulative — "the Nth species recorded here").
  const allTime = new Set(priorSpecies)
  for (const s of common.species) allTime.add(s.species_name)
  const milestone = { total_species_all_time: allTime.size, new_species_this_year: common.new_species.length }

  const firstDates = common.species.map((s) => s.first_seen).filter(Boolean).sort()
  const lastDates = common.species.map((s) => s.last_seen).filter(Boolean).sort()

  return assemble({
    nodeId, window, node: common.node, lat: common.lat, lon: common.lon,
    species: common.species, total: common.total, new_species: common.new_species, pulses: common.pulses,
    aciSampleCount: soundscape.sample_count,
    human_activity: common.human_activity,
    soundscape: { ...soundscape, peak_window: peakBand(common.hourCounts, null) },
    phenology: {
      period_key: window.period_key,
      year: Number(window.period_key),
      seasonal_breakdown,
      milestone,
      first_detection_date: firstDates[0] ?? null,
      last_detection_date: lastDates[lastDates.length - 1] ?? null,
      new_species_count: common.new_species.length,
    },
  })
}

/**
 * Cadence dispatcher. Builds the ReportPayload for a node + cadence + period_key-or-date.
 * @param {string} nodeId
 * @param {ReportCadence} cadence
 * @param {string} [dateOrKey]
 * @returns {Promise<ReportPayload>}
 */
export function buildReport(nodeId, cadence, dateOrKey) {
  switch (cadence) {
    case 'daily': return buildDailyReport(nodeId, dateOrKey)
    case 'seasonal': return buildSeasonalReport(nodeId, dateOrKey)
    case 'annual': return buildAnnualReport(nodeId, dateOrKey)
    default: throw new Error(`unsupported cadence: ${cadence}`)
  }
}

// Exported for the season selector / validation on surfaces.
export { SEASON_NAMES }
