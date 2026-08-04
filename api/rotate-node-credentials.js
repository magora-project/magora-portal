// Rotate one node's Supabase credentials and hand back a fresh magora-config.json.
//
// WHY THIS EXISTS: D3 deferred credential-at-rest hardening, which was the right call — the blast
// radius is small (a node credential can INSERT detections/aci_logs for its own node and nothing
// else; no UPDATE, no DELETE, no reach into another place's record). But until this existed there
// was no way to rotate a single node's credential short of hand-editing Supabase. Deferring a risk
// you cannot respond to is different from deferring one you can. This is the incident-response
// floor, not the hardening: per-boot short-lived tokens and a narrow ingest RPC stay on the D3
// roadmap.
//
// WHEN TO USE IT: an SD card is lost or stolen, a node is decommissioned and its hardware passed
// on, a config file gets posted somewhere public, or a builder simply asks for a fresh one.
//
// OPERATOR-ONLY (v1). Gated on CRON_SECRET, the same shared-secret pattern the cron endpoints use
// (api/insight-batch.js, api/node-status-check.js). Steward self-serve rotation is a later nicety
// and would need its own owner-check against nodes.owner_id — deliberately NOT wired up here,
// because this endpoint returns a working credential and the smallest audience is the right one to
// start with.
//
// Uses the GoTrue ADMIN API rather than touching auth.users directly — the same reasoning as the
// orphan cleanup: the admin API clears the auth-internal rows (identities, sessions) that a raw
// SQL edit leaves behind. Updating the password also invalidates existing refresh tokens, so the
// old credential stops working rather than lingering until it expires.

function json(res, status, body) {
  return res.status(status).json(body)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return json(res, 401, { error: 'Unauthorized' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) {
    console.error('rotate-node-credentials: missing VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY')
    return json(res, 500, { error: 'Rotation is not configured' })
  }

  const { node_id: nodeId } = req.body ?? {}
  if (!nodeId) return json(res, 400, { error: 'node_id required' })

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  // The node's auth user IS the node: provision-node sets nodes.id = the auth user's id. Look the
  // node up first so we fail on a typo'd uuid rather than on a confusing GoTrue 404, and so the
  // response can name the place being rotated.
  const nodeRes = await fetch(`${url}/rest/v1/nodes?id=eq.${nodeId}&select=id,name,owner_id`, { headers: svc })
  const nodes = await nodeRes.json().catch(() => [])
  if (!nodeRes.ok || !Array.isArray(nodes) || nodes.length === 0) {
    return json(res, 404, { error: 'No such node' })
  }
  const node = nodes[0]

  // 64 hex chars, matching what provision-node mints.
  const password = [crypto.randomUUID(), crypto.randomUUID()].join('').replace(/-/g, '')

  const updateRes = await fetch(`${url}/auth/v1/admin/users/${nodeId}`, {
    method: 'PUT',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!updateRes.ok) {
    const detail = await updateRes.text()
    console.error('rotate-node-credentials: GoTrue update failed', updateRes.status, detail)
    return json(res, 502, { error: 'Could not rotate the node credential' })
  }

  const user = await updateRes.json().catch(() => ({}))

  // Confirm the new credential actually works before telling the operator it's rotated — otherwise
  // a subtly-wrong response would hand back a config that bricks the node on next boot.
  const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  })
  if (!signIn.ok) {
    console.error('rotate-node-credentials: new credential failed verification', signIn.status)
    return json(res, 500, { error: 'Rotated, but the new credential failed verification — investigate before re-flashing' })
  }

  // The config fragment the node needs. Wi-Fi and location are deliberately absent: this endpoint
  // does not know them, and the operator merges these fields into the node's existing
  // magora-config.json rather than regenerating one from scratch.
  return json(res, 200, {
    rotated: true,
    node: { id: node.id, name: node.name },
    config_fragment: {
      node_id: node.id,
      node_email: user.email,
      node_password: password,
      supabase_url: url,
      supabase_anon_key: anonKey,
    },
    next_steps: [
      'Merge config_fragment into the node\'s magora-config.json (keep its wifi_* and lat/lon).',
      'Copy the file to the bootfs partition and reboot the node.',
      'The previous password no longer works — the node cannot post until it is re-flashed.',
    ],
  })
}
