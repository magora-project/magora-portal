// Node Phenology Report — on-demand entry point (HTTP). The reader that un-blocks Pulse's batch half.
//
// POST { node_id, cadence?, date?, voice? }
//   cadence  'daily' (default) | 'seasonal' | 'annual'
//   date     period_key OR a reference date within the period (daily 'YYYY-MM-DD', seasonal
//            'YYYY-<season>' or a date, annual 'YYYY' or a date); defaults to the current period.
//   voice    'node' (only voice in v1.1; unknown / roster / 'elder' reject).
//
// Flow: the shared check-before-generate path (api/_report/generate.js) — resolve period_key, hit
// the node_reports cache with NO model call when fresh, else build the grounded ReportPayload,
// narrate on Sonnet, cache via set_node_report (service_role). A quiet period returns
// { report: null }. Place data only — no person data, no Slack path. api/_pulse/* reused READ-ONLY.

import { REPORT_VOICES } from './_report/narrate-report.js'
import { REPORT_CADENCES } from './_report/payload.js'
import { generateReportForNode } from './_report/generate.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })

  const cadence = req.body?.cadence ?? 'daily'
  if (!REPORT_CADENCES.includes(cadence)) {
    return res.status(400).json({ error: `unsupported cadence: ${cadence}` })
  }

  const voice = req.body?.voice ?? 'node'
  if (!REPORT_VOICES.includes(voice)) {
    return res.status(400).json({ error: `unknown or unavailable report voice: ${voice}` })
  }

  try {
    const { report, error } = await generateReportForNode(nodeId, cadence, req.body?.date, voice)
    if (error) {
      console.error('report generation error:', error)
      return res.status(502).json({ error: 'report generation failed' })
    }
    return res.status(200).json({ report: report ?? null })
  } catch (e) {
    // A bad period_key/date surfaces as a thrown Error from the resolvers — treat as a 400.
    if (/invalid .*(date|key)/i.test(e.message)) return res.status(400).json({ error: e.message })
    console.error('report-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
