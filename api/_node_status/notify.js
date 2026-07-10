/* global process */
// Node Offline Detection v1 — operator notification.
//
// IMPORTANT: node-offline is an OPERATOR MONITORING side-effect — the human dev/ops surface.
// It is NEVER a publication in the node's voice, never ecological content, never posted to a
// node feed (the ecological-agent -> Slack rule). These messages tell the people running
// Magora that a node went dark / came back; participants never see them.
//
// Same webhook + best-effort semantics as Pulse's notify.js (SLACK_WEBHOOK_URL); the distinct
// `[node ops]` prefix keeps liveness alerts attributable and separate from `[pulse ops]`.
// A failed or unconfigured webhook never breaks a detector run.

/**
 * Post a plain operator alert to Slack if SLACK_WEBHOOK_URL is configured.
 * @param {string} text  a terse ops fact (not prose)
 */
export async function postOperatorAlert(text) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return { ok: false, skipped: 'SLACK_WEBHOOK_URL not set' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `[node ops] ${text}` }),
    })
    return { ok: res.ok }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * One-line transition alert. Fired ONCE per transition (the detector dedups upstream).
 * @param {Object} p
 * @param {string} p.nodeName  human node name (falls back to id)
 * @param {'online'|'offline'} p.status
 * @param {number} p.gapSeconds
 * @param {number} p.expectedInterval  node's derived cadence (seconds)
 * @param {boolean} p.wasBaseline  first-ever observation rather than a true transition
 */
export function summarizeTransition({ nodeName, status, gapSeconds, expectedInterval, wasBaseline }) {
  const mins = (gapSeconds / 60).toFixed(1)
  const cad = expectedInterval ? `${Math.round(expectedInterval)}s cadence` : 'cadence n/a'
  const verb = status === 'offline' ? 'went DARK' : 'is back ONLINE'
  const base = wasBaseline ? ' (first observation)' : ''
  return `${nodeName} ${verb}${base}: gap ${mins}min, ${cad}`
}
