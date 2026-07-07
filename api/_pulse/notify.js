/* global process */
// Pulse Agent v1 — operator notification.
//
// IMPORTANT: this is an OPERATOR MONITORING side-effect, never a publication in the
// node's voice. Slack is the human dev/ops surface. These messages summarize a batch run
// for the people running Magora; they are not ecological content, not narrative, and are
// never surfaced to participants or a node feed. (posted_to_feed stays false in v1; node
// voice is the Narrative Agent's concern, which does not exist yet.)
//
// Best-effort: a failed or unconfigured webhook never breaks a Pulse run.

/**
 * Post a plain operator summary to Slack if SLACK_WEBHOOK_URL is configured.
 * @param {string} text  a terse ops summary (facts, not prose)
 */
export async function postOperatorAlert(text) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return { ok: false, skipped: 'SLACK_WEBHOOK_URL not set' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Prefix marks this unambiguously as ops telemetry, not a node voice.
      body: JSON.stringify({ text: `[pulse ops] ${text}` }),
    })
    return { ok: res.ok }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** Build the one-line ops summary for a batch run over one node. */
export function summarizeRun(nodeId, cadence, payloads) {
  if (!payloads.length) return `node ${nodeId} (${cadence}): 0 pulses`
  const top = payloads[0]
  const byKind = payloads.reduce((acc, p) => ((acc[p.kind] = (acc[p.kind] || 0) + 1), acc), {})
  const kinds = Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(', ')
  return `node ${nodeId} (${cadence}): ${payloads.length} pulses [${kinds}]; top ${top.kind} score ${top.score}`
}
