/* global process */
// Node Phenology Report v1.1 — batch scheduler. The moment Pulse's deferred batch half finally has
// a scheduled reader.
//
// GET /api/report-cron?cadence=daily|seasonal|annual  (Vercel cron; cadence per cron entry)
//   daily    — nightly: for each node, run pulseBatch for the just-completed day, THEN build+cache
//              the daily report.
//   seasonal — at meteorological season boundaries: build+cache the just-ended season's report.
//   annual   — at year end: build+cache last year's report.
//
// TWO LOAD-BEARING RULES (code-surfaced in v1):
//   1. pulseBatch runs at the DAILY grain ONLY. Its scoring is tuned for short windows (e.g.
//      activity_spike's 14-day baseline); a season/year window would produce meaningless pulses.
//      Seasonal/annual reports READ the daily pulses already accumulated (notablePulses' window
//      overlap) — pulseBatch is NEVER called with a seasonal/annual window here.
//   2. The per-node pulse operator alert is SUPPRESSED (pulseBatch opts.suppressAlert). This run
//      emits ONE `[report ops]` digest instead — one Slack post/night regardless of node count.
//      The report content itself never touches Slack (a report is a node publication).
//
// Idempotent end-to-end on (node_id, cadence, period_key): a re-run hits the cache (no model call)
// and upserts pulses in place. Place data only — no person data.

import { pgFetch } from './_pulse/db.js'
import { pulseBatch } from './_pulse/core.js'
import { resolveDailyWindow } from './_report/payload.js'
import { generateReportForNode } from './_report/generate.js'

// Reference to the JUST-COMPLETED period for the given cadence (the cron fires AFTER the period
// ends). daily → yesterday; seasonal → a date safely inside the season that just closed; annual →
// last year. generateReportForNode resolves these into the concrete period_key.
export function completedPeriodRef(cadence, now = new Date()) {
  switch (cadence) {
    case 'seasonal':
      // ~20 days back lands well inside the season that ended at the boundary the cron fired on.
      return new Date(now.getTime() - 20 * 86400000).toISOString().slice(0, 10)
    case 'annual':
      return String(now.getUTCFullYear() - 1)
    default: // daily
      return new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  }
}

// Single best-effort ops digest for the whole run. `[report ops]` marks it as operator telemetry,
// distinct from Pulse's `[pulse ops]` and from any node voice. No-op until SLACK_WEBHOOK_URL is set.
async function postReportOps(text) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return { ok: false, skipped: 'SLACK_WEBHOOK_URL not set' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `[report ops] ${text}` }),
    })
    return { ok: res.ok }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export default async function handler(req, res) {
  // Optional shared-secret gate (Vercel sends `authorization: Bearer $CRON_SECRET` when set).
  const secret = process.env.CRON_SECRET
  if (secret && req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const cadence = req.query?.cadence ?? 'daily'
  if (!['daily', 'seasonal', 'annual'].includes(cadence)) {
    return res.status(400).json({ error: `unsupported cadence: ${cadence}` })
  }
  const ref = completedPeriodRef(cadence)

  // Only ACTIVE nodes author. A node that has stopped listening must not keep writing first-person
  // reports about days it did not witness: those publish to public permalinks that unfurl share
  // cards, so a decommissioned node narrating "the day passed through me" is a truthfulness problem
  // on a public surface — and it would hand a future absence layer a run of zero-detection days at
  // a listening post that was not, in fact, listening. Its existing reports stay published; the
  // place's record is retained. It simply stops adding new ones.
  //
  // This also gates the daily pulseBatch below, since that runs inside the same loop.
  //
  // The skip is reported in the summary AND the ops digest on purpose: the failure mode of gating
  // on a flag is a LIVE node wrongly marked inactive going quietly unreported. Naming the skipped
  // nodes every run makes that visible instead of silent.
  const allNodes = await pgFetch('nodes?select=id,name,is_active&limit=1000', true)
  const nodes = allNodes.filter((n) => n.is_active)
  const skipped = allNodes.filter((n) => !n.is_active)
  const summary = {
    cadence, ref,
    nodes: nodes.length,
    skippedInactive: skipped.map((n) => n.name || n.id),
    generated: 0, cached: 0, quiet: 0, errors: 0, periodKeys: new Set(),
  }

  for (const node of nodes) {
    try {
      // Daily cron: refresh the day's pulses first (suppressed alert), then build the report over
      // them. Seasonal/annual: READ the accumulated daily pulses — never run pulseBatch on a long
      // window.
      if (cadence === 'daily') {
        const w = resolveDailyWindow(ref)
        await pulseBatch(node.id, { start: w.start, end: w.end }, 'daily', { suppressAlert: true })
      }

      const { report, error, periodKey, cached } = await generateReportForNode(node.id, cadence, ref)
      summary.periodKeys.add(periodKey)
      if (error) summary.errors += 1
      else if (!report) summary.quiet += 1
      else if (cached) summary.cached += 1
      else summary.generated += 1
    } catch (e) {
      summary.errors += 1
      console.warn(`report-cron ${cadence} node ${node.id} failed:`, e.message)
    }
  }

  const periodKeys = [...summary.periodKeys]
  const digest =
    `${cadence} ${periodKeys.join(',') || ref}: ${summary.nodes} nodes, ` +
    `${summary.generated} generated, ${summary.cached} cached, ${summary.quiet} quiet, ${summary.errors} errors` +
    (skipped.length ? ` · skipped ${skipped.length} inactive (${summary.skippedInactive.join(', ')})` : '')
  await postReportOps(digest) // exactly one digest per run

  return res.status(200).json({ ...summary, periodKeys, digest })
}
