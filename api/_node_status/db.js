/* global process */
// Node Offline Detection v1 — database layer (Supabase PostgREST).
//
// Deliberately self-contained (a tiny copy of the pgFetch/sbRpc pattern in _pulse/db.js)
// so the node-status substrate stays independent of the pulse schema — the two share nothing
// but the generic PostgREST convention. Reads go on the anon key; the only write is through
// the record_node_status SECURITY DEFINER RPC (base table is not anon-writable).

const SB_URL = () => process.env.VITE_SUPABASE_URL
const SB_KEY = () => process.env.VITE_SUPABASE_ANON_KEY

const authHeaders = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` })

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
