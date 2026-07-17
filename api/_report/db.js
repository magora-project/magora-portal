/* global process */
// Node Phenology Report v1 — database layer.
//
// Reads (the report cache lookup) go on the anon key — node_reports is public-read place data.
// The ONLY write is set_node_report, a SECURITY DEFINER RPC granted to service_role ONLY (migration
// 20260723 — hardened from the start, parallel to record_node_status 20260721). So the WRITE path
// authenticates with the service role key (SUPABASE_SERVICE_ROLE_KEY — server-side only, already
// provisioned for the allowlist builder / node-status detector). Reads reuse api/_pulse/db.js.

const SB_URL = () => process.env.VITE_SUPABASE_URL
const SB_SERVICE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY

const serviceHeaders = () => ({ apikey: SB_SERVICE_KEY(), Authorization: `Bearer ${SB_SERVICE_KEY()}` })

/**
 * POST to the set_node_report SECURITY DEFINER RPC as service_role (the only role granted execute
 * as of 20260723). Throws on non-2xx (callers decide how to handle).
 */
export async function sbRpcService(name, args) {
  if (!SB_SERVICE_KEY()) {
    throw new Error(`rpc ${name}: SUPABASE_SERVICE_ROLE_KEY required (${name} is service_role-only)`)
  }
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...serviceHeaders() },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.text() // set_node_report returns void
}

/**
 * The cached report row for (node_id, cadence, period_key), or null. Anon read (public RLS).
 * @returns {Promise<{payload:object, narrative:string|null, voice:string|null, model:string|null, generated_at:string, narrated_at:string|null}|null>}
 */
export async function fetchCachedReport(pgFetch, nodeId, cadence, periodKey) {
  const enc = encodeURIComponent
  return pgFetch(
    `node_reports?node_id=eq.${nodeId}&cadence=eq.${enc(cadence)}&period_key=eq.${enc(periodKey)}` +
      `&select=payload,narrative,voice,model,generated_at,narrated_at`,
  )
}
