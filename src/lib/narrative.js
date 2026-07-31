import { useState, useCallback } from 'react'

// Narrative Agent client — fetches the place-voice "Pulse" narrative on demand, in the node's own
// voice (the place's own words). The reader-facing voice picker was removed (2026-07-28): the
// interactive NodePage narrative always renders in the `node` voice. The voice registry
// (api/_narrative/voices.js) and the per-voice pulse_narratives cache are RETAINED as substrate —
// the report-model voices reuse that machinery — this client just hard-selects `node`.
//
// Mirrors the node-insight / useSessionInsight check-before-generate pattern: /api/narrative-ondemand
// runs pulseOnDemand (6h freshness) + the per-voice render cache (keyed (pulse_id, 'node')), so the
// client POSTs { node_id, voice: 'node' } and shows the text. `{ pulse: null }` (nothing to say) is a
// quiet empty state, not an error.

const NODE_VOICE = 'node'

export function usePulseNarrative(nodeId) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error

  const load = useCallback(async () => {
    if (!nodeId) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/narrative-ondemand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, voice: NODE_VOICE }),
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
