// Pulse Agent v1 — interactive entry point (HTTP).
//
// POST { node_id, window? }  where window is optional { start, end, cadence }.
// Check-before-generate: returns the top-ranked stored pulse for the resolved window if
// it is fresh (within PULSE_ONDEMAND_TTL, 6h), else generates -> scores -> stores and
// returns the top pulse. Returns { pulse: null } when there is nothing to say.
//
// This is a read/generate surface (no cron secret); it only writes place-derived pulses
// through the SECURITY DEFINER upsert RPC, never person data.

import { pulseOnDemand } from './_pulse/core.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })

  try {
    const pulse = await pulseOnDemand(nodeId, req.body?.window)
    return res.status(200).json({ pulse })
  } catch (e) {
    console.error('pulse-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
