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

export function useNodeReport(nodeId) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error
  const [cadence, setCadence] = useState('daily')

  // `c` lets selectCadence pass the new id immediately (setCadence is async — avoids a stale read).
  const load = useCallback(async (c = cadence) => {
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
  }, [nodeId, cadence])

  const selectCadence = useCallback((c) => { setCadence(c); load(c) }, [load])

  return { ...state, cadence, cadences: REPORT_CADENCES, load, selectCadence }
}
