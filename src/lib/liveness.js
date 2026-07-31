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
// THE HEARTBEAT IS aci_logs, NOT nodes.last_seen_at. This distinction is the whole correctness
// story here, and getting it wrong is not a subtle failure:
//
//   * aci_logs        — written by the node every cycle (~22-24s on current hardware). This is the
//     LIVE signal, readable directly by any client, and it is what the detector itself judges.
//   * last_seen_at    — a SNAPSHOT of that heartbeat, refreshed only when the detector cron runs,
//     which is DAILY (vercel.json: node-status-check, "0 9 * * *"). For ~23 hours out of every 24
//     it is hours stale on a perfectly healthy node.
//   * node_status_events — written only on an actual transition, so the latest row can be days old
//     while the node is fine. Useful as a fallback state, not as a freshness signal.
//
// So last_seen_at must NEVER be compared against the node's per-cycle cadence: that conflates "the
// node is dark" with "the cron hasn't run since this morning", and would label every healthy node
// as not listening for most of the day. Judge the live aci_logs against the node's own rhythm
// instead, and fall back to the daily snapshot only when no heartbeats are in hand — where the
// honest claim is about the last CHECK, bounded by the detector's cadence rather than the node's.
//
// When there is nothing usable, say "unknown" — never a cheerful default. A node whose heartbeat
// has genuinely gone stale reads as not listening, the safe direction to be wrong in: it
// under-claims rather than asserting life that isn't there.

// One source of truth for the heartbeat model: the same K, the same cadence derivation, and the
// same online/offline rule the detector judges nodes by. It lives in `shared/` — NOT `api/` —
// because vite.config.js proxies all `/api/*` to the deployed app in dev, so importing it from
// there returns HTML and breaks the app locally while working fine in prod.
import {
  HEARTBEAT_CONFIG, deriveExpectedIntervalSeconds, deriveStatus,
} from '../../shared/heartbeat.js'

/**
 * How stale the daily snapshot may be before it stops supporting any claim. The detector runs once
 * a day, so a snapshot up to ~2 runs old is still evidence of the last check; beyond that we know
 * nothing current. Bounded by the DETECTOR's cadence, never the node's.
 */
const SNAPSHOT_MAX_AGE_SECONDS = 2 * 86400

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
 * @param {string[]} [p.heartbeatsDesc]  aci_logs recorded_at values, most-recent-first (the LIVE
 *   signal — pass the rows the page already fetched; no extra query needed)
 * @param {string|null} [p.lastSeenAt]  nodes.last_seen_at (daily snapshot — fallback only)
 * @param {{status: string, at: string, expected_interval_seconds: number|null}|null} [p.latestEvent]
 * @param {number} [p.now]
 * @returns {{state: 'listening'|'quiet'|'unknown', label: string, detail: string|null}}
 */
export function derivePublicStatus({ heartbeatsDesc, lastSeenAt, latestEvent, now = Date.now() }) {
  const beats = Array.isArray(heartbeatsDesc) ? heartbeatsDesc.filter(Boolean) : []
  const latestBeatMs = beats.length ? new Date(beats[0]).getTime() : NaN

  // ── Primary: the live heartbeat, judged by the detector's own model ──────────────────────
  // Cadence comes from these same rows, so a node cycling every 24s and one cycling every 5min
  // are each judged against their own rhythm — no hardcoded interval, no cron dependency.
  if (Number.isFinite(latestBeatMs)) {
    const interval = deriveExpectedIntervalSeconds(beats)
      // A node's own recorded cadence is the next-best estimate when we hold too few samples.
      ?? (Number.isFinite(Number(latestEvent?.expected_interval_seconds))
        ? Number(latestEvent.expected_interval_seconds)
        : null)
    if (interval != null && interval > 0) {
      const state = deriveStatus({
        gapSeconds: (now - latestBeatMs) / 1000,
        expectedInterval: interval,
        k: HEARTBEAT_CONFIG.defaultK,
      }) === 'online' ? 'listening' : 'quiet'
      return decorate(state, lastHeardPhrase(beats[0], now))
    }
  }

  // ── Fallback: the daily snapshot. We can only speak to the last CHECK, so staleness is
  // bounded by the DETECTOR's cadence — never by the node's per-cycle rhythm. ───────────────
  const snapshotMs = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN
  const snapshotFresh = Number.isFinite(snapshotMs) && (now - snapshotMs) / 1000 <= SNAPSHOT_MAX_AGE_SECONDS
  const lastHeard = lastHeardPhrase(
    Number.isFinite(latestBeatMs) ? beats[0] : lastSeenAt, now,
  )

  if (latestEvent?.status === 'offline') return decorate('quiet', lastHeard)
  if (latestEvent?.status === 'online' && snapshotFresh) return decorate('listening', lastHeard)
  if (snapshotFresh) return decorate('listening', lastHeard)
  return decorate('unknown', lastHeard)
}

function decorate(state, lastHeard) {
  const label = state === 'listening'
    ? 'Listening now'
    : state === 'quiet' ? 'Not listening right now' : 'Listening status unknown'
  const detail = lastHeard
    ? `Last heard ${lastHeard}`
    : state === 'unknown' ? 'No heartbeat recorded yet' : null
  return { state, label, detail }
}
