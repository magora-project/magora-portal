/* global process */
// Pulse Agent v1 — batch entry point (HTTP, cron-driven).
//
// For each node (or a single node_id if supplied), generate -> score -> store the daily
// pulse set idempotently, then notify-to-Slack (operator side-effect). Mirrors the
// api/insight-batch.js cron-auth pattern (Authorization: Bearer <CRON_SECRET>).
//
// Window: the previous complete UTC day, so the day's data is settled and the window key
// is stable across the run (batch idempotency is on node_id + window + cadence + kind).

import { pulseBatch } from './_pulse/core.js'
import { pgFetch } from './_pulse/db.js'

function previousUtcDayWindow() {
  const now = new Date()
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return {
    start: new Date(todayStart - 86400000).toISOString(),
    end: new Date(todayStart).toISOString(),
    cadence: 'daily',
  }
}

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const window = previousUtcDayWindow()

    // One node if supplied, else the whole network.
    const single = req.body?.node_id || req.query?.node_id
    const nodeIds = single
      ? [single]
      : (await pgFetch('nodes?select=id&limit=1000', true)).map((n) => n.id)

    const runs = []
    for (const nodeId of nodeIds) {
      // v1.1: pulseBatch returns { pulses, selection }; selection.per_surface (all four
      // surfaces) is response-only. Stored-pulse + Slack behavior unchanged.
      const { pulses, selection } = await pulseBatch(nodeId, window, 'daily')
      runs.push({ node_id: nodeId, pulses: pulses.length, top: pulses[0]?.kind ?? null, selection })
    }

    return res.status(200).json({ ok: true, window, nodes: nodeIds.length, runs })
  } catch (e) {
    console.error('pulse-batch error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
