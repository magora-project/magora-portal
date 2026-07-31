// Node liveness — the heartbeat model, shared by the detector and the client.
//
// Lives in `shared/` rather than `api/` on purpose. `vite.config.js` proxies ALL `/api/*` to the
// deployed Vercel app during `npm run dev`, so anything the browser imports from `api/` is
// requested over that proxy and comes back as the SPA shell (HTML) instead of a module — which
// breaks the whole app in dev while working fine in prod, where Vite bundles the import at build
// time. Keep browser-reachable shared code out of `api/`.
//
// Pure derivation, no I/O, no imports. Node liveness is derived from aci_logs — the continuous
// per-cycle soundscape log, written every cycle even at zero birds (verified on prod). A dark node
// stops writing aci_logs, so the gap since the last aci_log is the liveness signal.
//
// The expected cadence is PER-NODE, derived from that node's OWN recent aci_logs history (median
// inter-log interval) — never a hardcoded interval, no region/config assumption. This keeps
// detection global-ready: a node cycling every 24s and a node cycling every 5min are each judged
// against their own rhythm.

export const HEARTBEAT_CONFIG = {
  // How many of the node's most recent aci_logs to sample when deriving its cadence.
  cadenceSamples: 30,
  // Minimum samples required to trust a derived cadence. Below this we cannot establish a
  // rhythm, so the node is SKIPPED (not declared offline) — e.g. a freshly-provisioned node
  // with no heartbeat history yet.
  minSamples: 5,
  // Offline threshold multiplier: a node is offline when the gap since its last heartbeat
  // exceeds K × its expected interval. Overridable via NODE_OFFLINE_K (see readK()).
  defaultK: 3,
}

/** Read the offline multiplier K from env, falling back to the config default. */
export function readK(env) {
  const raw = Number(env?.NODE_OFFLINE_K)
  return Number.isFinite(raw) && raw > 0 ? raw : HEARTBEAT_CONFIG.defaultK
}

/** Median of an array of numbers (unsorted input ok). Returns null for an empty array. */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Derive a node's expected inter-log interval (seconds) from recent aci_log timestamps.
 * @param {string[]} recordedAtDesc  aci_log recorded_at values, most-recent-first (as stored).
 * @returns {number|null}  median gap between consecutive logs in seconds, or null if the
 *   history is too short to establish a cadence (fewer than minSamples logs).
 */
export function deriveExpectedIntervalSeconds(recordedAtDesc) {
  if (!Array.isArray(recordedAtDesc) || recordedAtDesc.length < HEARTBEAT_CONFIG.minSamples) {
    return null
  }
  const times = recordedAtDesc.map((t) => new Date(t).getTime()).filter((n) => Number.isFinite(n))
  if (times.length < HEARTBEAT_CONFIG.minSamples) return null
  const gaps = []
  for (let i = 0; i < times.length - 1; i++) {
    // times are DESC, so the earlier index is the later timestamp.
    gaps.push((times[i] - times[i + 1]) / 1000)
  }
  return median(gaps)
}

/**
 * Decide a node's current liveness from its heartbeat.
 * @param {Object} p
 * @param {number} p.gapSeconds        seconds since the node's last aci_log
 * @param {number} p.expectedInterval  the node's derived cadence in seconds
 * @param {number} p.k                 offline multiplier
 * @returns {'online'|'offline'}
 */
export function deriveStatus({ gapSeconds, expectedInterval, k }) {
  return gapSeconds > k * expectedInterval ? 'offline' : 'online'
}
