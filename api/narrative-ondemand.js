// Narrative Agent v1 — on-demand entry point (HTTP). Pulse's first consumer.
//
// POST { node_id, window?, surface? }  (surface default detection_card — the NodePage
// "Pulse" panel is a single-question container).
//
// Flow: call the existing pulseOnDemand (check-before-generate, 6h TTL) -> take the pulse
// ASSIGNED TO THE REQUESTED SURFACE from selection.per_surface (never re-rank/re-route;
// routing is Pulse's, D5) -> render it via narrate() in the node's voice -> cache the
// voiced text on the pulse row -> return { pulse, narrative }. { pulse: null } (nothing to
// say, or nothing assigned to this surface) -> no narrative (panel shows a quiet state).
//
// api/_pulse/* is reused READ-ONLY (pulseOnDemand, pgFetch, rowToPayload, sbRpc). Pulse
// scoring/selection is not modified. Place data only — no person data, no Slack path.

import { pulseOnDemand } from './_pulse/core.js'
import { pgFetch, rowToPayload, sbRpc } from './_pulse/db.js'
import { narrate } from './_narrative/narrate.js'

const VOICE = 'node' // v1 single voice

// Invalidation (migration 20260713): regenerate when never narrated, the pulse was
// re-generated after its last narration, or the stored voice differs from the request.
function needsRender(row, voice) {
  return (
    !row.narrated_at ||
    new Date(row.narrated_at).getTime() < new Date(row.generated_at).getTime() ||
    row.narrative_voice !== voice
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })
  const surface = req.body?.surface ?? 'detection_card'

  try {
    // Pulse does the generate/cache; we consume the surface assignment only.
    const { selection } = await pulseOnDemand(nodeId, req.body?.window, surface)
    const targetId = selection?.per_surface?.[surface] ?? null
    if (!targetId) return res.status(200).json({ pulse: null, narrative: null })

    // Fetch the assigned pulse row (select=* to get the narrative cache fields rowToPayload drops).
    const row = await pgFetch(`pulses?id=eq.${targetId}&select=*`)
    if (!row || row.kind === 'absence') return res.status(200).json({ pulse: null, narrative: null })

    const payload = rowToPayload(row)

    // Cache hit: serve stored voiced text, no Claude call.
    if (row.narrative && !needsRender(row, VOICE)) {
      return res.status(200).json({ pulse: payload, narrative: { text: row.narrative, voice: row.narrative_voice } })
    }

    // Render + persist (best-effort write-back; a failed write just re-generates next time).
    const out = await narrate(payload, VOICE)
    if (!out) return res.status(200).json({ pulse: payload, narrative: null }) // nothing grounded to say
    if (out.error) {
      console.error('narrate error:', out.error)
      return res.status(502).json({ error: 'narrative generation failed' })
    }
    await sbRpc('set_pulse_narrative', { p_pulse_id: targetId, p_narrative: out.text, p_voice: out.voice })
      .catch((e) => console.warn('set_pulse_narrative failed:', e.message))

    return res.status(200).json({ pulse: payload, narrative: out })
  } catch (e) {
    console.error('narrative-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
