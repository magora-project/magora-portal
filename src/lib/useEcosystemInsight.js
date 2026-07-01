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
