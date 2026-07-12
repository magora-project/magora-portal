/* global process */
// Node Offline Detection v1 — database layer (Supabase PostgREST).
//
// Deliberately self-contained (a tiny copy of the pgFetch/sbRpc pattern in _pulse/db.js)
// so the node-status substrate stays independent of the pulse schema — the two share nothing
// but the generic PostgREST convention. Reads go on the anon key; the only write is through
// the record_node_status SECURITY DEFINER RPC.
//
// record_node_status is granted to service_role ONLY as of migration 20260721 (hardened from
// anon to close the unauthenticated write path into node_status_events, matching
// apply_species_trait / replace_range_cell). So the WRITE path authenticates with the service
// role key — server-side only, already provisioned in this environment for the allowlist
// builder (SUPABASE_SERVICE_ROLE_KEY). Reads stay on the anon key (read RLS is unchanged).

const SB_URL = () => process.env.VITE_SUPABASE_URL
const SB_KEY = () => process.env.VITE_SUPABASE_ANON_KEY
const SB_SERVICE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY

const authHeaders = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` })
const serviceHeaders = () => ({ apikey: SB_SERVICE_KEY(), Authorization: `Bearer ${SB_SERVICE_KEY()}` })

/**
 * GET against PostgREST. Returns an array (or [] on failure) when asArray, else the first
 * row (or null). Never throws — a source that can't be read degrades to empty.
 * @param {string} path  e.g. `aci_logs?node_id=eq.${id}&select=recorded_at`
 */
export async function pgFetch(path, asArray = false) {
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { headers: authHeaders() })
    if (!res.ok) return asArray ? [] : null
    const data = await res.json()
    if (asArray) return Array.isArray(data) ? data : []
    return Array.isArray(data) ? data[0] || null : data
  } catch {
    return asArray ? [] : null
  }
}

/**
 * POST to the record_node_status SECURITY DEFINER RPC. Authenticates as service_role (the only
 * role granted execute as of 20260721). Throws on non-2xx (callers decide how to handle).
 */
export async function sbRpc(name, args) {
  if (!SB_SERVICE_KEY()) {
    throw new Error(`rpc ${name}: SUPABASE_SERVICE_ROLE_KEY required (record_node_status is service_role-only)`)
  }
  const res = await fetch(`${SB_URL()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...serviceHeaders() },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.json()
}
