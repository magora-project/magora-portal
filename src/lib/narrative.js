import { useState, useCallback } from 'react'

// Narrative Agent client — fetches the node-voice "Pulse" narrative on demand.
//
// Mirrors the node-insight / useSessionInsight check-before-generate pattern: the
// /api/narrative-ondemand endpoint itself runs pulseOnDemand (6h freshness) + the
// narrative render-cache, so the client just POSTs when the panel opens and shows the
// voiced text. A `{ pulse: null }` (nothing to say for this surface) is a quiet empty
// state, not an error.
export function usePulseNarrative(nodeId) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error

  const load = useCallback(async () => {
    if (!nodeId) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/narrative-ondemand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      })
      if (!res.ok) { setState({ status: 'error' }); return }
      const data = await res.json()
      if (!data.pulse || !data.narrative?.text) { setState({ status: 'empty' }); return }
      setState({ status: 'ready', text: data.narrative.text, kind: data.pulse.kind })
    } catch {
      setState({ status: 'error' })
    }
  }, [nodeId])

  return { ...state, load }
}
