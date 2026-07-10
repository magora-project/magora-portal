import { useState, useCallback } from 'react'
import { listVoices, DEFAULT_VOICE } from '../../api/_narrative/voices'

// Narrative Agent client — fetches the place-voice "Pulse" narrative on demand, in a
// reader-selectable voice (v1.1). The four voices come from the shared server registry
// (voices.js is a pure leaf module — single source of truth, no drift).
//
// Mirrors the node-insight / useSessionInsight check-before-generate pattern: the
// /api/narrative-ondemand endpoint runs pulseOnDemand (6h freshness) + the PER-VOICE render
// cache, so the client just POSTs { node_id, voice } and shows the voiced text. A
// `{ pulse: null }` (nothing to say for this surface) is a quiet empty state, not an error.

// { id, label } for the selector — same order/content as the server roster (node first).
export const VOICES = listVoices().map((v) => ({ id: v.id, label: v.label }))

export function usePulseNarrative(nodeId) {
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | ready | empty | error
  const [voice, setVoice] = useState(DEFAULT_VOICE)

  // `v` lets selectVoice pass the new id immediately (setVoice is async — avoids a stale read).
  const load = useCallback(async (v = voice) => {
    if (!nodeId) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/narrative-ondemand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, voice: v }),
      })
      if (!res.ok) { setState({ status: 'error' }); return }
      const data = await res.json()
      if (!data.pulse || !data.narrative?.text) { setState({ status: 'empty' }); return }
      setState({ status: 'ready', text: data.narrative.text, kind: data.pulse.kind })
    } catch {
      setState({ status: 'error' })
    }
  }, [nodeId, voice])

  const selectVoice = useCallback((v) => { setVoice(v); load(v) }, [load])

  return { ...state, voice, voices: VOICES, load, selectVoice }
}
