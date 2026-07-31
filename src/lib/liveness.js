// Public node liveness — the pure derivation behind "is this place listening right now?".
//
// Kept free of the supabase client (and therefore of import.meta.env) so it is testable in
// isolation and reusable by any surface that wants the status: the node page, node cards on the
// network map, the journal, a future Manage view. src/lib/nodeStatus.js wraps it in the hook that
// actually reads the rows.
//
// This is a reader-facing INDICATOR, not telemetry: it answers one Glance-layer question and
// exposes nothing about battery, connectivity, storage, or recording configuration.
//
// Two signals, both shipped by Node Offline Detection v1:
//   * nodes.last_seen_at   — refreshed every detector tick, so it is the FRESH signal.
//   * node_status_events   — written only on an actual transition, so the latest row can be days
//     old while the node is perfectly healthy. It carries the node's own derived cadence
//     (expected_interval_seconds), which is what makes last_seen_at interpretable.
//
// So: re-derive from last_seen_at against the node's own rhythm when we can, fall back to the
// last recorded transition otherwise, and say "unknown" when neither is available — never a
// cheerful default. A node whose heartbeat has gone stale reads as not listening, which is the
// safe direction to be wrong in: it under-claims rather than asserting life that isn't there.

// One source of truth for the offline multiplier: the same K the detector judges nodes by
// (api/_node_status/heartbeat.js). That module is pure math with no imports, so pulling the
// constant in costs nothing and keeps the public label from drifting away from the operational
// definition of "offline".
import { HEARTBEAT_CONFIG } from '../../api/_node_status/heartbeat.js'

/** Relative "last heard" phrasing. Coarse on purpose: a public page, not a monitoring dashboard. */
export function lastHeardPhrase(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return null
  const ms = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(ms)) return null
  const seconds = Math.max(0, (now - ms) / 1000)
  if (seconds < 120) return 'moments ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/**
 * @param {Object} p
 * @param {string|null} [p.lastSeenAt]  nodes.last_seen_at
 * @param {{status: string, at: string, expected_interval_seconds: number|null}|null} [p.latestEvent]
 * @param {number} [p.now]
 * @returns {{state: 'listening'|'quiet'|'unknown', label: string, detail: string|null}}
 */
export function derivePublicStatus({ lastSeenAt, latestEvent, now = Date.now() }) {
  const lastHeard = lastHeardPhrase(lastSeenAt, now)
  const interval = Number(latestEvent?.expected_interval_seconds)
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN

  let state = 'unknown'
  if (Number.isFinite(lastSeenMs) && Number.isFinite(interval) && interval > 0) {
    // The fresh path: judge the node against its OWN rhythm, exactly as the detector does.
    const gapSeconds = (now - lastSeenMs) / 1000
    state = gapSeconds > HEARTBEAT_CONFIG.defaultK * interval ? 'quiet' : 'listening'
  } else if (latestEvent?.status === 'online' || latestEvent?.status === 'offline') {
    // No usable heartbeat (missing/unparseable last_seen_at, or no derived cadence yet) —
    // defer to the last transition the detector actually recorded.
    state = latestEvent.status === 'online' ? 'listening' : 'quiet'
  }

  const label = state === 'listening'
    ? 'Listening now'
    : state === 'quiet' ? 'Not listening right now' : 'Listening status unknown'

  const detail = lastHeard
    ? `Last heard ${lastHeard}`
    : state === 'unknown' ? 'No heartbeat recorded yet' : null

  return { state, label, detail }
}
