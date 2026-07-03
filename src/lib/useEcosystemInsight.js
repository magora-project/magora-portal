import { useState } from 'react'
import { supabase, MIN_CONFIDENCE } from './supabase'
import { isHiddenSpecies } from './hiddenSpecies'

// Shared state + generation for the mobile "What's the ecosystem saying?" insight,
// used by both the live feed (MapPage) and the field journal (JournalPage) so the
// generate-once / write-back behavior stays identical in both. The card owns its
// own collapsed/expanded UI; this hook just holds per-Listen generation state
// (`insights[id]` → { loading | text | error }) and generates on demand.
export function useEcosystemInsight() {
  const [insights, setInsights] = useState({})

  async function requestInsight(m) {
    setInsights(prev => ({ ...prev, [m.id]: { loading: true } }))
    try {
      const conf = (m.species || []).filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile: true, detection_id: m.id, species: conf,
          lat: m.lat, lon: m.lon, detected_at: m.detected_at,
          // Prefer the recorder's stored offset; else the viewer's (same tz in the common
          // case). Falls back server-side to the longitude estimate if neither is present.
          tz_offset: m.tz_offset ?? new Date().getTimezoneOffset(),
          habitat_type: m.habitat_type, canopy_cover: m.canopy_cover,
          water_present: m.water_present, disturbance_level: m.disturbance_level,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsights(prev => ({ ...prev, [m.id]: { text: data.insight } }))
      // Cache on the row so it generates exactly once: the RPC is SECURITY DEFINER
      // and only writes when insight IS NULL, so this is safe with the anon key and
      // idempotent under concurrent first-viewers. Best-effort — a failed write-back
      // just regenerates next time.
      supabase.rpc('set_detection_insight', { detection_id: m.id, insight_text: data.insight })
        .then(({ error }) => { if (error) console.warn('set_detection_insight failed:', error) })
    } catch {
      setInsights(prev => ({ ...prev, [m.id]: { error: true } }))
    }
  }

  return { insights, requestInsight }
}

// Session variant: the ecosystem insight for a whole Listen session (a
// public_listen_sessions row). Same generate-once / write-back behavior as above,
// but keyed on the session and cached via set_session_insight. The session's
// `species` is already aggregated across its captures by the view.
export function useSessionInsight() {
  const [insights, setInsights] = useState({})

  async function requestInsight(s) {
    setInsights(prev => ({ ...prev, [s.id]: { loading: true } }))
    try {
      const conf = (s.species || []).filter(x => x.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(x.common_name))
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile: true, detection_id: s.id, species: conf,
          lat: s.lat, lon: s.lon, detected_at: s.started_at,
          tz_offset: new Date().getTimezoneOffset(),
          habitat_type: s.habitat_type, canopy_cover: s.canopy_cover,
          water_present: s.water_present, disturbance_level: s.disturbance_level,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsights(prev => ({ ...prev, [s.id]: { text: data.insight } }))
      supabase.rpc('set_session_insight', { session_id: s.id, insight_text: data.insight })
        .then(({ error }) => { if (error) console.warn('set_session_insight failed:', error) })
    } catch {
      setInsights(prev => ({ ...prev, [s.id]: { error: true } }))
    }
  }

  return { insights, requestInsight }
}
