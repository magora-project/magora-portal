import { useState, useCallback } from 'react'

// Node Phenology Report client — fetches the node's report on demand, in the node's own first-person
// voice, at a chosen cadence (daily / seasonal / annual — v1.1). Mirrors usePulseNarrative's
// check-before-generate: /api/report-ondemand builds the grounded ReportPayload, narrates it on the
// report tier (Sonnet), and caches it (node_reports). A `{ report: null }` (a quiet period with
// nothing to author) is a calm empty state, not an error. Place data only.

// Cadence options for the selector (daily first). Labels are the reader-facing framing.
export const REPORT_CADENCES = [
  { id: 'daily', label: 'Today' },
  { id: 'seasonal', label: 'This season' },
  { id: 'annual', label: 'This year' },
]

// Infer cadence from a period_key: 'YYYY-MM-DD' daily, 'YYYY-<season>' seasonal, 'YYYY' annual.
export function cadenceForPeriodKey(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'daily'
  if (/^\d{4}-(winter|spring|summer|autumn)$/.test(key)) return 'seasonal'
  if (/^\d{4}$/.test(key)) return 'annual'
  return null
}

// Start of the current meteorological season block (UTC ms). Blocks are hemisphere-independent
// (only the NAME flips across the equator), matching api/_report/payload.js's season resolution.
function currentSeasonStart(now) {
  const m = now.getUTCMonth()
  const y = now.getUTCFullYear()
  if (m >= 11) return Date.UTC(y, 11, 1)      // DJF
  if (m >= 8) return Date.UTC(y, 8, 1)        // SON
  if (m >= 5) return Date.UTC(y, 5, 1)        // JJA
  if (m >= 2) return Date.UTC(y, 2, 1)        // MAM
  return Date.UTC(y - 1, 11, 1)               // Jan/Feb belong to DJF of season year y
}

// Selector gating mirrors the server (api/_report/generate.js cadenceTenureGate): seasonal needs
// ≥14 days of tenure within the CURRENT season, annual ≥60 days within the CURRENT year — a mature
// node still waits 14 days after a season boundary before "This season" has enough of a record.
export function reportCadencesForTenure(firstHeardAt, now = new Date()) {
  if (!firstHeardAt) return REPORT_CADENCES.filter((item) => item.id === 'daily')
  const first = new Date(firstHeardAt).getTime()
  if (!Number.isFinite(first)) return REPORT_CADENCES.filter((item) => item.id === 'daily')
  const nowMs = now.getTime()
  const daysInSeason = Math.max(0, (nowMs - Math.max(currentSeasonStart(now), first)) / 86400000)
  const daysInYear = Math.max(0, (nowMs - Math.max(Date.UTC(now.getUTCFullYear(), 0, 1), first)) / 86400000)
  return REPORT_CADENCES.filter((item) => item.id === 'daily'
    || (item.id === 'seasonal' && daysInSeason >= 14)
    || (item.id === 'annual' && daysInYear >= 60))
}

export function useNodeReport(nodeId, tenure = null) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error
  const [cadence, setCadence] = useState('daily')
  // NOT memoized: eligibility is time-dependent (season/year boundaries, 14/60-day thresholds),
  // so it re-derives on every render — NodePage's 30s refresh keeps it tracking the server gate.
  const cadences = reportCadencesForTenure(tenure?.first_heard_at || null)
  // The cadence state can outlive its eligibility: navigating between nodes reuses this hook, and a
  // cadence valid on a mature node (seasonal/annual) is ineligible on a young one. Fall back to
  // daily rather than POSTing a hidden stale cadence into the server's 422.
  const activeCadence = cadences.some((item) => item.id === cadence) ? cadence : 'daily'

  // `c` lets selectCadence pass the new id immediately (setCadence is async — avoids a stale read).
  const load = useCallback(async (c = activeCadence) => {
    if (!nodeId) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/report-ondemand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, cadence: c }),
      })
      if (!res.ok) { setState({ status: 'error' }); return }
      const data = await res.json()
      if (!data.report?.narrative) { setState({ status: 'empty' }); return }
      setState({ status: 'ready', text: data.report.narrative, payload: data.report.payload, periodKey: data.report.payload?.period_key })
    } catch {
      setState({ status: 'error' })
    }
  }, [nodeId, activeCadence])

  const selectCadence = useCallback((c) => { setCadence(c); load(c) }, [load])

  // Expose the effective cadence (not raw state) so the selector highlight matches what load posts.
  return { ...state, cadence: activeCadence, cadences, load, selectCadence }
}
