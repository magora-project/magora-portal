// Node Phenology Report v1 — on-demand entry point (HTTP). The reader that un-blocks Pulse's
// deferred batch half.
//
// POST { node_id, date?, cadence?, voice? }
//   date    'YYYY-MM-DD' UTC calendar day (default today); cadence 'daily' (only cadence in v1);
//   voice   'node' (only voice in v1; unknown / roster / 'elder' reject).
//
// Flow (check-before-generate, exactly like Narrative v1 — no batch cron in v1):
//   look up node_reports for (node_id, cadence, period_key) -> if a cached row is FRESH
//   (narrated_at >= generated_at, narrative present) return it with NO model call -> else build the
//   ReportPayload (grounded, quarantine-excluded) -> narrate on the report tier (Sonnet) -> cache
//   via set_node_report (service_role) -> return { report }. A quiet day with nothing to author
//   returns { report: null } (empty state), and is not cached.
//
// Place data only — no person data, no user_id, no Slack path. api/_pulse/* is reused READ-ONLY.

import { pgFetch } from './_pulse/db.js'
import { buildDailyReport, resolveDailyWindow } from './_report/payload.js'
import { narrateReport, REPORT_VOICES } from './_report/narrate-report.js'
import { fetchCachedReport, sbRpcService } from './_report/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })

  const cadence = req.body?.cadence ?? 'daily'
  if (cadence !== 'daily') return res.status(400).json({ error: `unsupported cadence in v1: ${cadence}` })

  const voice = req.body?.voice ?? 'node'
  if (!REPORT_VOICES.includes(voice)) {
    return res.status(400).json({ error: `unknown or unavailable report voice: ${voice}` })
  }

  let periodKey
  try {
    periodKey = resolveDailyWindow(req.body?.date).period_key
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  try {
    // Cache-first: a fresh cached row (narrated at or after its payload was built) is returned as-is
    // with no model call.
    const cached = await fetchCachedReport(pgFetch, nodeId, cadence, periodKey)
    if (
      cached?.narrative &&
      cached.narrated_at &&
      new Date(cached.narrated_at).getTime() >= new Date(cached.generated_at).getTime()
    ) {
      return res.status(200).json({
        report: {
          payload: cached.payload,
          narrative: cached.narrative,
          voice: cached.voice,
          model: cached.model,
          cached: true,
        },
      })
    }

    // Miss / stale: build the grounded payload, then narrate on the report tier.
    const payload = await buildDailyReport(nodeId, periodKey)
    const out = await narrateReport(payload, voice)
    if (!out) return res.status(200).json({ report: null }) // quiet day, nothing to author
    if (out.error) {
      console.error('narrateReport error:', out.error)
      return res.status(502).json({ error: 'report generation failed' })
    }

    // Persist (service_role write). Best-effort: a failed write just regenerates next time.
    await sbRpcService('set_node_report', {
      p_node_id: nodeId,
      p_cadence: cadence,
      p_period_key: periodKey,
      p_payload: payload,
      p_narrative: out.text,
      p_voice: out.voice,
      p_model: out.model,
    }).catch((e) => console.warn('set_node_report failed:', e.message))

    return res.status(200).json({
      report: { payload, narrative: out.text, voice: out.voice, model: out.model, cached: false },
    })
  } catch (e) {
    console.error('report-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
