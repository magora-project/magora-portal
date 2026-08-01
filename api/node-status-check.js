/* global process */
// Node Offline Detection v1 — the detector (HTTP, cron-driven).
//
// Per node: derive the node's OWN expected heartbeat cadence from its recent aci_logs, compare
// the gap since its last aci_log to K × that cadence, and on a STATE CHANGE record a transition
// (node_status_events) + fire one Slack operator alert. Alerts fire once per transition
// (online->offline, offline->online) — never repeatedly while a node stays offline — because the
// dedup lives in the record_node_status RPC (atomic against overlapping runs).
//
// Heartbeat = aci_logs, the continuous per-cycle soundscape log (verified on prod:
// detection-independent). Cadence is per-node/derived, never hardcoded — so nodes on different
// cycle intervals are each judged against their own rhythm. Mirrors the insight-batch /
// pulse-batch cron-auth pattern (Authorization: Bearer <CRON_SECRET>).
//
// SCOPE: place/ops data only (no person data, node_follows never referenced). The Slack alert
// is an operator side-effect — never a node publication / feed post. This maintains the
// coverage-continuity substrate the gated `absence` pulse needs; it does NOT un-gate absence.

import { pgFetch, sbRpc } from './_node_status/db.js'
import {
  HEARTBEAT_CONFIG,
  readK,
  deriveExpectedIntervalSeconds,
  deriveStatus,
} from './_node_status/heartbeat.js'
import { postOperatorAlert, summarizeTransition } from './_node_status/notify.js'

const enc = encodeURIComponent

/** Assess one node against its own heartbeat cadence, record any transition, alert on change. */
async function checkNode(node, nowMs, k) {
  const logs = await pgFetch(
    `aci_logs?node_id=eq.${node.id}` +
      `&select=recorded_at&order=recorded_at.desc&limit=${HEARTBEAT_CONFIG.cadenceSamples}`,
    true,
  )

  // No / too-little heartbeat history → cannot derive a cadence, so we cannot distinguish
  // "offline" from "never deployed". Skip rather than false-alarm (global-ready: no hardcoded
  // fallback interval).
  //
  // This skip is purely data-driven — there is no per-node exclusion list, and a node enrols
  // itself the moment it has HEARTBEAT_CONFIG.minSamples logs. (An older comment here named Casa
  // Colibri as the node that lands in this branch; that stopped being true — as of 2026-07-31 it
  // has ~26k aci_logs, 5 recorded status events, and is assessed like any other node.)
  const expectedInterval = deriveExpectedIntervalSeconds(logs.map((r) => r.recorded_at))
  if (expectedInterval == null || !logs.length) {
    return { node_id: node.id, name: node.name, skipped: 'insufficient_heartbeat_history' }
  }

  const lastSeenAt = logs[0].recorded_at
  const gapSeconds = (nowMs - new Date(lastSeenAt).getTime()) / 1000
  const status = deriveStatus({ gapSeconds, expectedInterval, k })

  // Atomic in the DB: refreshes last_seen_at every tick, inserts an event ONLY on a real
  // change (or first-ever observation), returns whether it recorded so we know to alert.
  const rec = await sbRpc('record_node_status', {
    p_node_id: node.id,
    p_status: status,
    p_at: new Date(nowMs).toISOString(),
    p_gap_seconds: Math.round(gapSeconds),
    p_expected_interval_seconds: Math.round(expectedInterval),
    p_last_seen_at: lastSeenAt,
  })

  // Alert on a recorded transition. Suppress only the ONLINE baseline (a node first observed
  // already-up is not actionable); an OFFLINE baseline (dark before the detector existed) is
  // still surfaced once so ops learn about it.
  let alerted = false
  if (rec.recorded && !(rec.was_baseline && status === 'online')) {
    await postOperatorAlert(
      summarizeTransition({
        nodeName: node.name || node.id,
        status,
        gapSeconds,
        expectedInterval,
        wasBaseline: rec.was_baseline,
      }),
    )
    alerted = true
  }

  return {
    node_id: node.id,
    name: node.name,
    status,
    gap_seconds: Math.round(gapSeconds),
    expected_interval_seconds: Math.round(expectedInterval),
    last_seen_at: lastSeenAt,
    transition: rec.recorded,
    baseline: rec.was_baseline,
    alerted,
  }
}

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const nowMs = Date.now()
    const k = readK(process.env)

    // One node if supplied (fixture/testing), else the whole network.
    const single = req.body?.node_id || req.query?.node_id
    const nodes = single
      ? await pgFetch(`nodes?id=eq.${enc(single)}&select=id,name`, true)
      : await pgFetch('nodes?select=id,name&limit=1000', true)

    const results = []
    for (const node of nodes) results.push(await checkNode(node, nowMs, k))

    const transitions = results.filter((r) => r.transition).length
    return res.status(200).json({ ok: true, k, checked: nodes.length, transitions, results })
  } catch (e) {
    console.error('node-status-check error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
