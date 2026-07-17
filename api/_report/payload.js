// Node Phenology Report v1 — canonical ReportPayload contract + daily aggregation builder.
//
// This directory is underscore-prefixed (api/_report/) so Vercel does NOT treat these modules
// as routable serverless functions — only api/report-ondemand.js is an endpoint; it imports the
// shared builder from here.
//
// A Node Phenology Report gives a node a periodic FIRST-PERSON narrative of its own ecological
// activity ("every place is speaking / the node is the author"). Like Pulse's payload, the
// ReportPayload is voice-agnostic and DB-grounded: this builder decides WHAT the report may say
// (facts only, from the DB); api/_report/narrate-report.js decides only HOW it is said. The
// payload is the SOLE knowledge source — narration invents nothing not present here.
//
// Reuse, don't fork: reads go through the same PostgREST layer as Pulse (api/_pulse/db.js) and
// honor the SAME range-gate quarantine exclusion (RANGE_OK). Notable pulses are Pulse-SELECTED
// via the shared node_report surface affordance (assignSurfaces) and are NEVER re-ranked here —
// selection/ranking is Pulse's job.
//
// Cadence-parameterized from day one: the contract, the builder signature, and the cache are
// keyed on `cadence` so the seasonal/annual builders (v1.1) drop in without a payload migration.
// Daily is the only cadence IMPLEMENTED in v1.

import { pgFetch, rowToPayload } from '../_pulse/db.js'
import { nodeCoords, aciMean, hasPriorDetection } from '../_pulse/sources.js'
import { assignSurfaces } from '../_pulse/select.js'
import { PULSE_CONFIG } from '../_pulse/payload.js'

const enc = encodeURIComponent

// Range gate (20260720): a quarantined detection (a penguin, a Rook at Casa Colibri) must never
// enter a report — exclude it from EVERY detections read. Null-safe → fail-open, matching the
// gate's own convention and the identical constant in api/_pulse/sources.js and api/insight.js:
// unchecked / plausible / null all pass; only range_status = 'quarantined' is withheld.
const RANGE_OK = 'or=(range_status.is.null,range_status.neq.quarantined)'

// Detection confidence floor, matching MIN_CONFIDENCE on the read-side (src/lib/supabase.js).
// A report speaks the same detections the NodePage shows, so it honors the same floor.
const MIN_CONFIDENCE = 0.3

// How many species / pulses the payload carries into the narrative. The scaffold summarizes,
// it does not enumerate everything; these caps keep the grounded prompt bounded.
const REPORT_TOP_SPECIES = 6
const REPORT_MAX_PULSES = 4

/**
 * @typedef {"daily"|"seasonal"|"annual"|string} ReportCadence
 *   window/aggregation profile. v1 implements "daily" only; seasonal/annual land in v1.1 on
 *   this same contract.
 */

/**
 * @typedef {Object} ReportWindow
 * @property {string} start   ISO timestamp (inclusive)
 * @property {string} end     ISO timestamp (exclusive)
 * @property {ReportCadence} cadence
 * @property {string} period_key   the cache/permalink key for this window (daily: 'YYYY-MM-DD')
 */

/**
 * The canonical, voice-agnostic Node Phenology Report payload. Every field is DB-grounded; the
 * narrator may use ONLY what is here. Stored as `node_reports.payload` (jsonb).
 * @typedef {Object} ReportPayload
 * @property {string} node_id
 * @property {ReportCadence} cadence
 * @property {string} period_key
 * @property {ReportWindow} window
 * @property {string} generated_at                ISO; freshness is compared against narrated_at
 * @property {{ id:string, name:string|null, place_label:string|null, elevation_m:number|null, elevation_unit:string|null, lat:number|null, lon:number|null }} node
 * @property {{ total_detections:number, distinct_species:number, top_species:{species_name:string,count:number,first_seen:string,last_seen:string,confidence_max:number}[] }} activity
 * @property {{ species_name:string, first_seen:string }[]} new_species   first-ever on THIS node
 * @property {{ pulse_id:string, kind:string, subject:object, evidence:object, score:number, summary:string }[]} notable_pulses  Pulse-selected (node_report surface), not re-ranked
 * @property {{ mean_aci:number|null, baseline_mean_aci:number|null, delta:number|null, trend:("busier"|"quieter"|"steady"|null), sample_count:number, peak_window:{ start:string, end:string, label:string, count:number }|null }} soundscape
 * @property {{ period_key:string, week_of_year:number, first_detection_date:string|null, last_detection_date:string|null, new_species_count:number }} phenology
 * @property {{ has_detections:boolean, has_aci:boolean, degraded:boolean }} coverage
 */

/** All cadences the contract anticipates. Only 'daily' is implemented in v1. */
export const REPORT_CADENCES = /** @type {ReportCadence[]} */ (['daily', 'seasonal', 'annual'])

// ── Window resolution ────────────────────────────────────────────────────────
/**
 * Resolve the daily report window from a date (UTC calendar day). A dated permalink
 * (/node/:id/report/:date) and a stable cache key both require a DATE-keyed window, so the daily
 * cadence uses the UTC calendar day rather than a rolling last-24h boundary. Default = today (UTC).
 * @param {string} [date]  'YYYY-MM-DD'; defaults to the current UTC date
 * @returns {ReportWindow}
 */
export function resolveDailyWindow(date) {
  const period_key = date || new Date().toISOString().slice(0, 10)
  const dayStart = new Date(`${period_key}T00:00:00.000Z`)
  if (Number.isNaN(dayStart.getTime())) throw new Error(`invalid report date: ${date}`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  return { start: dayStart.toISOString(), end: dayEnd.toISOString(), cadence: 'daily', period_key }
}

// ISO week-of-year (1..53) — a phenology anchor the seasonal/annual builders can aggregate on.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
}

// ── Raw detection read (grounded aggregation source) ─────────────────────────
// One logical read over the window feeds total/distinct/species/first-last/peak-hour. RANGE_OK
// excludes quarantined rows; the confidence floor matches the NodePage read-side.
//
// PAGINATED: PostgREST enforces a server-side db-max-rows cap (1000 on this project) that silently
// truncates a GET regardless of the `limit` param — a busy day (birdnode11 sees >1000/day) would
// otherwise undercount total_detections and drop the day's tail species. Because "numbers are
// facts" here, we page via limit+offset until a short page returns, so the aggregation sees EVERY
// non-quarantined detection in the window. This also unblocks v1.1, whose seasonal/annual windows
// aggregate far more than one page. Bounded by REPORT_MAX_PAGES as a runaway guard.
const REPORT_PAGE_SIZE = 1000
const REPORT_MAX_PAGES = 60 // 60k detections/window ceiling — well beyond any real daily/seasonal day

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
    if (batch.length < REPORT_PAGE_SIZE) break // short page => last page
  }
  return all
}

// Aggregate raw rows into per-species stats + totals, and bucket by UTC hour for peak activity.
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

// Hour label from a 0..23 UTC bucket. Coarse windows, kept plain (the narrator restyles).
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

// Peak 3-hour activity window from the hour histogram, as an absolute time span within the day.
function peakWindow(hourCounts, dayStart) {
  let bestStart = 0
  let bestSum = -1
  for (let h = 0; h < 24; h++) {
    const sum = hourCounts[h] + hourCounts[(h + 1) % 24] + hourCounts[(h + 2) % 24]
    if (sum > bestSum) { bestSum = sum; bestStart = h }
  }
  if (bestSum <= 0) return null
  const startMs = dayStart.getTime() + bestStart * 3600000
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 3 * 3600000).toISOString(),
    label: hourLabel(bestStart),
    count: bestSum,
  }
}

// A one-line, payload-derived summary of a notable pulse — the ONLY thing the narrator learns
// about it. Built from confirmed payload fields only (never re-derives a species/stat).
function pulseSummary(p) {
  const species = Array.isArray(p.subject?.species) && p.subject.species.length ? p.subject.species[0] : null
  const ev = p.evidence || {}
  switch (p.kind) {
    case 'novel_detection':
      return species ? `${species} was detected here for the first time in my records` : `a species new to my records was detected here`
    case 'activity_spike':
      return ev.ratio != null
        ? `bird activity rose to ${Number(ev.ratio).toFixed(1)} times my recent baseline`
        : `bird activity rose above my recent baseline`
    case 'soundscape_shift':
      return `my soundscape ${ev.direction === 'down' ? 'grew quieter' : 'grew busier'} than my recent baseline`
    case 'survey_gap_question':
      return p.survey_gap?.question_focus || `there is something here I do not yet have a clear read on`
    default:
      return `something worth noting happened here`
  }
}

// ── Notable pulses (Pulse-selected, NOT re-ranked) ───────────────────────────
// Any pulses whose window falls inside the report window, ranked by Pulse's OWN stored score,
// routed through the shared node_report surface affordance (assignSurfaces). We consume Pulse's
// selection/order — we never recompute a score.
async function notablePulses(nodeId, window) {
  const rows = await pgFetch(
    `pulses?node_id=eq.${nodeId}` +
      `&window_start=gte.${enc(window.start)}&window_start=lt.${enc(window.end)}` +
      `&select=*&order=score.desc`,
    true,
  )
  if (!rows.length) return []
  const ranked = rows.map(rowToPayload) // already score-desc from the query; Pulse's ranking
  const { per_surface } = assignSurfaces(ranked, ['node_report'])
  const chosenIds = (per_surface.node_report || []).slice(0, REPORT_MAX_PULSES)
  const byId = new Map(ranked.map((p) => [p.pulse_id, p]))
  return chosenIds.map((idv) => {
    const p = byId.get(idv)
    return { pulse_id: p.pulse_id, kind: p.kind, subject: p.subject, evidence: p.evidence, score: p.score, summary: pulseSummary(p) }
  })
}

/**
 * Build the daily ReportPayload for a node + date. Every field is DB-grounded; quarantined rows
 * are excluded via RANGE_OK. Degrades fail-open (empty activity / null soundscape) rather than
 * throwing, matching Pulse's coverage semantics — a node with no data yields a valid, quiet
 * payload rather than an error.
 * @param {string} nodeId
 * @param {string} [date]  'YYYY-MM-DD' (UTC calendar day); defaults to today
 * @returns {Promise<ReportPayload>}
 */
export async function buildDailyReport(nodeId, date) {
  const window = resolveDailyWindow(date)
  const dayStart = new Date(window.start)

  const baselineStart = new Date(dayStart.getTime() - PULSE_CONFIG.aciBaselineDays * 86400000).toISOString()

  // NOTE (v1.1 watch-item): aciMean (reused from _pulse/sources.js) is subject to the same
  // db-max-rows cap — its mean/sample_count reflect at most 1000 ACI logs. For a single day that is
  // representative (ACI is reported as a trend/direction, never a hard counted fact). A SEASONAL /
  // ANNUAL window spans far more than 1000 logs, so v1.1 needs a paginated or SQL-aggregate ACI read
  // to avoid an early-window-biased mean. Left as-is for the daily cadence.
  const [{ node, lat, lon }, rows, windowAci, baselineAci, pulses] = await Promise.all([
    nodeCoords(nodeId),
    detectionRows(nodeId, window),
    aciMean(nodeId, window.start, window.end),
    aciMean(nodeId, baselineStart, window.start),
    notablePulses(nodeId, window),
  ])

  const { bySpecies, hourCounts, total } = aggregate(rows)
  const species = [...bySpecies.values()].sort((a, b) => b.count - a.count)

  // New-for-this-node: a window species with NO detection ever before the window start. One
  // prior-check per distinct species (reuses hasPriorDetection; RANGE_OK-safe). Bounded by the
  // day's distinct-species count.
  const newFlags = await Promise.all(
    species.map((s) => hasPriorDetection(nodeId, s.species_name, window.start)),
  )
  const new_species = species
    .filter((_, i) => !newFlags[i])
    .map((s) => ({ species_name: s.species_name, first_seen: s.first_seen }))

  // Soundscape trend from mean-ACI delta vs the trailing baseline, using Pulse's noise floor.
  const delta =
    windowAci.mean != null && baselineAci.mean != null ? windowAci.mean - baselineAci.mean : null
  let trend = null
  if (delta != null) {
    if (Math.abs(delta) < PULSE_CONFIG.aciMinDelta) trend = 'steady'
    else trend = delta > 0 ? 'busier' : 'quieter'
  }

  const peak = peakWindow(hourCounts, dayStart)

  const firstDates = species.map((s) => s.first_seen).filter(Boolean).sort()
  const lastDates = species.map((s) => s.last_seen).filter(Boolean).sort()

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
    soundscape: {
      mean_aci: windowAci.mean,
      baseline_mean_aci: baselineAci.mean,
      delta,
      trend,
      sample_count: windowAci.sampleCount,
      peak_window: peak,
    },
    phenology: {
      period_key: window.period_key,
      week_of_year: isoWeek(dayStart),
      first_detection_date: firstDates[0] ?? null,
      last_detection_date: lastDates[lastDates.length - 1] ?? null,
      new_species_count: new_species.length,
    },
    coverage: {
      has_detections: total > 0,
      has_aci: windowAci.sampleCount > 0,
      degraded: total === 0,
    },
  }
}
