/* global process */
// Pulse Agent v1 — database layer (Supabase PostgREST).
//
// Reads go directly against PostgREST on the anon key; the only write is through the
// upsert_pulse SECURITY DEFINER RPC (base table is not anon-writable). Mirrors the
// dbFetch / sbRpc helpers already used by api/insight.js and api/insight-batch.js.

const SB_URL = () => process.env.VITE_SUPABASE_URL
const SB_KEY = () => process.env.VITE_SUPABASE_ANON_KEY

const authHeaders = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` })

/**
 * GET against PostgREST. Returns an array (or [] on failure) when asArray, else the
 * first row (or null). Never throws — a source that can't be read degrades to empty.
 * @param {string} path  e.g. `detections?node_id=eq.${id}&select=*`
 */
export async function pgFetch(path, asArray = false) {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { headers: authHeaders() })
    if (!res.ok) return asArray ? [] : null
    const data = await res.json()
    if (asArray) return Array.isArray(data) ? data : []
    return Array.isArray(data) ? (data[0] || null) : data
  } catch {
    return asArray ? [] : null
  }
}

/** Exact count via PostgREST's count header (HEAD request, no rows transferred). */
export async function pgCount(path) {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: { ...authHeaders(), Prefer: 'count=exact', Range: '0-0' },
    })
    // content-range looks like "0-0/1234" or "*/1234"
    const cr = res.headers.get('content-range')
    if (!cr) return 0
    const total = cr.split('/')[1]
    return total === '*' ? 0 : Number(total) || 0
  } catch {
    return 0
  }
}

/** POST to a SECURITY DEFINER RPC. Throws on non-2xx (callers decide how to handle). */
export async function sbRpc(name, args) {
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Load the weight maps for a weights_version from the config surface, keyed by kind.
 * Weights are never inlined in code — this is the single source at scoring time.
 * @returns {Promise<Record<string, Record<string, number>>>}  kind -> { component: weight }
 */
export async function loadWeights(weightsVersion) {
  const rows = await pgFetch(
    `pulse_weights?weights_version=eq.${encodeURIComponent(weightsVersion)}&select=kind,weights`,
    true,
  )
  const byKind = {}
  for (const r of rows) byKind[r.kind] = r.weights || {}
  return byKind
}

/**
 * Freshness lookup for pulseOnDemand (§6): the top-ranked stored pulse for exactly this
 * (node_id, window, cadence) generated within ttlMs, or null.
 * @returns {Promise<import('./payload.js').PulsePayload | null>}
 */
export async function findFreshPulse(nodeId, window, ttlMs) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString()
  const row = await pgFetch(
    `pulses?node_id=eq.${nodeId}` +
      `&window_start=eq.${encodeURIComponent(window.start)}` +
      `&window_end=eq.${encodeURIComponent(window.end)}` +
      `&cadence=eq.${encodeURIComponent(window.cadence)}` +
      `&generated_at=gte.${encodeURIComponent(cutoff)}` +
      `&select=*&order=score.desc&limit=1`,
  )
  return row ? rowToPayload(row) : null
}

/**
 * All stored pulses for exactly this (node_id, window, cadence), ranked by score desc.
 * pulseOnDemand runs surface selection over the whole window's ranked set (findFreshPulse
 * only decides freshness on the top row). Read-only; returns [] if none.
 * @returns {Promise<import('./payload.js').PulsePayload[]>}
 */
export async function fetchPulsesForWindow(nodeId, window) {
  const rows = await pgFetch(
    `pulses?node_id=eq.${nodeId}` +
      `&window_start=eq.${encodeURIComponent(window.start)}` +
      `&window_end=eq.${encodeURIComponent(window.end)}` +
      `&cadence=eq.${encodeURIComponent(window.cadence)}` +
      `&select=*&order=score.desc`,
    true,
  )
  return rows.map(rowToPayload)
}

/**
 * Persist one scored payload via the idempotent upsert RPC. Returns the stored payload.
 * @param {string} nodeId
 * @param {import('./payload.js').Window} window
 * @param {import('./payload.js').PulsePayload} payload
 */
export async function storePulse(nodeId, window, payload) {
  // upsert_pulse is declared `returns public.pulses` (a single composite row), so
  // PostgREST returns a JSON object, not an array — do not destructure it as one.
  const row = await sbRpc('upsert_pulse', {
    p_node_id: nodeId,
    p_kind: payload.kind,
    p_window_start: window.start,
    p_window_end: window.end,
    p_cadence: window.cadence,
    p_score: payload.score,
    p_components: payload.components,
    p_weights_version: payload.weights_version,
    p_subject: payload.subject,
    p_survey_gap: payload.survey_gap ?? null,
    p_evidence: payload.evidence,
    p_subject_key: subjectKey(payload.subject),
  })
  return rowToPayload(Array.isArray(row) ? row[0] : row)
}

/**
 * Deterministic idempotency discriminator so multiple same-kind pulses (distinct
 * species / metrics / habitat fields) coexist in one window instead of overwriting each
 * other. Metric-based kinds key on the metric; species-based kinds key on the species.
 */
export function subjectKey(subject) {
  return subject?.metric ?? subject?.species?.[0] ?? ''
}

/** Map a stored pulses row into the canonical PulsePayload shape. */
export function rowToPayload(r) {
  return {
    pulse_id: r.id,
    node_id: r.node_id,
    kind: r.kind,
    window: { start: r.window_start, end: r.window_end, cadence: r.cadence },
    generated_at: r.generated_at,
    score: Number(r.score),
    components: r.components || {},
    weights_version: r.weights_version,
    subject: r.subject || {},
    ...(r.survey_gap ? { survey_gap: r.survey_gap } : {}),
    evidence: r.evidence || {},
    posted_to_feed: r.posted_to_feed,
  }
}
