/* global process */
// Task H: batch pre-generate node-detection insights at 50% off via the Anthropic
// Message Batches API. Runs on a Vercel Cron schedule (see vercel.json). Each run:
//   1. drains any ended batches we recognize (custom_id `det_<uuid>`) and writes the
//      insights back (idempotent), and
//   2. claims a fresh set of detections needing an insight and submits a new batch.
//
// Reuses buildNodeInsightPrompt from api/insight.js, so batch insights are built from
// the exact same prompt as the interactive path (no duplication/drift). DB writes go
// through SECURITY DEFINER RPCs, so this runs on the anon key — no service role needed.

import { buildNodeInsightPrompt, INSIGHT_MODEL } from './insight.js'

const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches'
const MAX_PER_RUN = 20              // detections submitted per run
// The cron runs daily (Hobby plan), and each run drains the batch the *previous*
// run submitted (~24h earlier), so this window must comfortably exceed the cron
// interval. 3 days also catches a slow batch (Anthropic allows up to 24h). Re-
// draining an already-written batch is a no-op (set_node_detection_insight only
// writes when null), so a generous window is safe.
const RECENT_MS = 3 * 24 * 3600 * 1000

const anthropicHeaders = () => ({
  'content-type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
})

async function sbRpc(name, args) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.json()
}

// Phase 1: write back insights from any recently-ended batches. Idempotent
// (set_node_detection_insight only writes when null), so reprocessing a batch is safe.
async function drainEndedBatches() {
  const list = await fetch(`${BATCHES_URL}?limit=20`, { headers: anthropicHeaders() })
  if (!list.ok) return { drained: 0 }
  const { data } = await list.json()
  let written = 0
  for (const b of data || []) {
    if (b.processing_status !== 'ended' || !b.results_url) continue
    if (Date.now() - new Date(b.created_at).getTime() > RECENT_MS) continue // already handled on an earlier run
    const rres = await fetch(b.results_url, { headers: anthropicHeaders() })
    if (!rres.ok) continue
    for (const line of (await rres.text()).split('\n')) {
      if (!line.trim()) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (!row.custom_id?.startsWith('det_') || row.result?.type !== 'succeeded') continue
      const insight = row.result.message?.content?.[0]?.text
      if (!insight) continue
      await sbRpc('set_node_detection_insight', { detection_id: row.custom_id.slice(4), insight_text: insight })
      written++
    }
  }
  return { drained: written }
}

// Phase 2: claim detections needing an insight, build their prompts, submit one batch.
async function submitNewBatch() {
  const ids = await sbRpc('claim_node_insights', { max_rows: MAX_PER_RUN })
  if (!Array.isArray(ids) || ids.length === 0) return { submitted: 0 }
  const requests = []
  for (const id of ids) {
    const built = await buildNodeInsightPrompt({ detection_id: id })
    if (built?.prompt) {
      requests.push({
        custom_id: `det_${id}`, // must match ^[a-zA-Z0-9_-]{1,64}$ — underscore, not colon
        params: { model: INSIGHT_MODEL, max_tokens: 450, messages: [{ role: 'user', content: built.prompt }] },
      })
    }
  }
  if (requests.length === 0) return { submitted: 0 }
  const res = await fetch(BATCHES_URL, { method: 'POST', headers: anthropicHeaders(), body: JSON.stringify({ requests }) })
  if (!res.ok) throw new Error(`batch create: ${res.status} ${await res.text()}`)
  return { submitted: requests.length, batch_id: (await res.json()).id }
}

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const drained = await drainEndedBatches()
    const submitted = await submitNewBatch()
    return res.status(200).json({ ok: true, ...drained, ...submitted })
  } catch (e) {
    console.error('insight-batch error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
