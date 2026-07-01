import { useState } from 'react'
import { supabase, MIN_CONFIDENCE } from './supabase'
import { isHiddenSpecies } from './hiddenSpecies'

// Shared state + generation for the mobile "What's the ecosystem saying?" insight,
// used by both the live feed (MapPage) and the field journal (JournalPage) so the
// generate-once / write-back / open-in-modal behavior stays identical in both.
//
// Pairs with <EcosystemInsightModal>: the page spreads `insights` and
// `openMobileInsight` onto its MobileDetectionCards, and renders the modal with
// `openInsight` / `closeInsight` / `requestInsight`.
export function useEcosystemInsight() {
  const [insights, setInsights] = useState({})
  const [openInsight, setOpenInsight] = useState(null)

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

  // Open the modal for a Listen, generating on demand only if it isn't already
  // stored on the row or generated this session (and not already in flight).
  function openMobileInsight(m) {
    setOpenInsight(m)
    const already = m.insight || insights[m.id]?.text
    if (!already && !insights[m.id]?.loading) requestInsight(m)
  }

  return {
    insights,
    openInsight,
    openMobileInsight,
    requestInsight,
    closeInsight: () => setOpenInsight(null),
  }
}
