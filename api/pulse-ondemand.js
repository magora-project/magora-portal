// Pulse Agent v1 — interactive entry point (HTTP). v1.1: optional surface routing.
//
// POST { node_id, window?, surface? }  where window is optional { start, end, cadence }
// and surface is one of detection_card | listen_result | journal_entry | node_report
// (default detection_card). Cache-first (6h PULSE_ONDEMAND_TTL); returns the top-ranked
// pulse plus a response-only `selection.per_surface` scoped to the requested surface.
// Returns { pulse: null, selection } when there is nothing to say. Callers that ignore
// `selection` still get `pulse` (the same top-1 as before).
//
// Read/generate surface (no cron secret); writes place-derived pulses only, through the
// SECURITY DEFINER upsert RPC. `selection` is response-only — no DB write.

import { pulseOnDemand } from './_pulse/core.js'
import { SURFACES, DEFAULT_SURFACE } from './_pulse/payload.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })

  const surface = req.body?.surface ?? DEFAULT_SURFACE
  if (!SURFACES.includes(surface)) {
    return res.status(400).json({ error: `invalid surface '${surface}'; expected one of ${SURFACES.join(', ')}` })
  }

  try {
    const { pulse, selection } = await pulseOnDemand(nodeId, req.body?.window, surface)
    return res.status(200).json({ pulse, selection })
  } catch (e) {
    console.error('pulse-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
