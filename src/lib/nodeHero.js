import { useState, useEffect } from 'react'

// Node-page hero (NodePage v1, Work Items A/B/F) — the ONE thing this place is noticing right
// now, for the Glance layer.
//
// The renderer below is a PURE, DETERMINISTIC function of the Pulse payload. No model runs here.
// That is the whole point: the Glance headline is the surface most likely to be read and least
// likely to be read carefully, so it must be impossible for it to say anything the structured
// data does not already contain. Pulse decides WHAT is worth showing (ranking, per-surface
// routing); this decides only how to phrase the fields it chose.
//
// Copy discipline (Work Item F) is enforced structurally, not by review:
//   * Only two kinds are renderable, and each has exactly one template. A kind with no template
//     returns null rather than falling back to generic prose.
//   * Every number comes from `evidence`. A missing or non-finite field drops that clause
//     instead of rendering "undefined" or a guessed value.
//   * Comparisons are strictly against THIS NODE'S OWN history (its trailing baseline). There is
//     no vocabulary here for weather, season, temperature, or any cross-variable cause — those
//     need the unbuilt weather slice plus a correlation primitive, so no phrasing may imply them.
//
// The node voice's "must end in a question" contract does not apply here: this is not the node
// speaking. It is a labelled observation, carrying a Direct-observation provenance chip. The
// node's voice lives in the Understand layer (the Pulse narrative and the report), where it is
// chipped as AI interpretation.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * @param {Object|null} pulse  a Pulse payload routed to the node_page_hero surface
 * @returns {{headline: string, detail: string|null, provenance: string}|null}
 */
export function formatHero(pulse) {
  if (!pulse) return null

  if (pulse.kind === 'novel_detection') {
    const species = pulse.subject?.species?.[0]
    if (!species) return null
    const count = num(pulse.evidence?.detection_count_in_window)
    const detail = count && count > 1
      ? `Not recorded at this place before — heard ${count} times since.`
      : 'Not recorded at this place before.'
    return { headline: `First ${species} recorded here`, detail, provenance: 'direct_observation' }
  }

  if (pulse.kind === 'activity_spike') {
    const ratio = num(pulse.evidence?.ratio)
    const windowCount = num(pulse.evidence?.window_count)
    const baselineDays = num(pulse.evidence?.baseline_days)
    // The delta IS the claim, so without a usable ratio there is no honest headline to write.
    if (ratio == null || ratio <= 1) return null
    const pct = Math.round((ratio - 1) * 100)

    const clauses = []
    if (windowCount != null) clauses.push(`${windowCount} detections`)
    clauses.push(baselineDays != null
      ? `${pct}% above this place's ${baselineDays}-day average`
      : `${pct}% above this place's recent average`)

    return {
      headline: 'A busier stretch than usual',
      detail: `${clauses.join(' — ')}.`,
      provenance: 'direct_observation',
    }
  }

  // Any other kind (soundscape_shift, survey_gap_question, the gated absence) has no hero
  // template. Routing already excludes them; returning null means a future routing change
  // cannot silently invent copy for a kind nobody wrote phrasing for.
  return null
}

/**
 * Fetch the node_page_hero pulse. Reads `selected` — the payload Pulse routed to THIS surface —
 * not `pulse`, which is the window's top-ranked payload regardless of surface eligibility. The
 * two differ whenever the top pulse is hero-ineligible (a soundscape shift, a survey gap).
 *
 * Loads on mount rather than behind a button: the Glance layer's job is to answer "what is
 * happening here?" before the visitor asks. The endpoint is cache-first (6h freshness), so this
 * is usually a stored read.
 */
export function useNodePageHero(nodeId) {
  // State carries the node it describes, so a route change to another node reads as `loading`
  // without a synchronous setState in the effect body — no stale hero flashes under the new
  // place's name while its own pulse is still in flight.
  const [state, setState] = useState({ status: 'loading', forNode: null })

  useEffect(() => {
    if (!nodeId) return
    let cancelled = false
    fetch('/api/pulse-ondemand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, surface: 'node_page_hero' }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('hero fetch failed'))))
      .then((data) => {
        if (cancelled) return
        const hero = formatHero(data?.selected)
        setState(hero ? { status: 'ready', forNode: nodeId, ...hero } : { status: 'empty', forNode: nodeId })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', forNode: nodeId }) })
    return () => { cancelled = true }
  }, [nodeId])

  return state.forNode === nodeId ? state : { status: 'loading', forNode: nodeId }
}
