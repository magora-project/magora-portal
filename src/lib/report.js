import { useState, useCallback } from 'react'

// Node Phenology Report client — fetches the node's "Today at this place" report on demand, in the
// node's own first-person voice (v1). Mirrors the usePulseNarrative check-before-generate pattern:
// the /api/report-ondemand endpoint builds the grounded ReportPayload, narrates it on the report
// tier (Sonnet), and caches it (node_reports), so the client just POSTs { node_id } and shows the
// prose. A `{ report: null }` (a quiet day with nothing to author) is a calm empty state, not an
// error. Place data only — no person data.

// The daily period key (UTC calendar day) — matches resolveDailyWindow on the server, and is the
// permalink key (/node/:id/report/:date).
export function todayPeriodKey() {
  return new Date().toISOString().slice(0, 10)
}

export function useNodeReport(nodeId) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error

  const load = useCallback(async () => {
    if (!nodeId) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/report-ondemand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      })
      if (!res.ok) { setState({ status: 'error' }); return }
      const data = await res.json()
      if (!data.report?.narrative) { setState({ status: 'empty' }); return }
      setState({ status: 'ready', text: data.report.narrative, payload: data.report.payload })
    } catch {
      setState({ status: 'error' })
    }
  }, [nodeId])

  return { ...state, load, periodKey: todayPeriodKey() }
}
