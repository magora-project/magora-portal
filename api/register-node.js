// Server-side provisioning wrapper — the ONLY path the portal uses to register a node.
//
// WHY THIS EXISTS (security remediation, 2026-08-01):
// The RegisterNode wizard used to call the provision-node Edge Function directly from the
// browser, sending the shared gate secret as `import.meta.env.VITE_PROVISION_SECRET`. The
// `VITE_` prefix is Vite's opt-in marker for "inline this into the client bundle" — so the
// secret shipped in plaintext inside /assets/index-*.js and was downloadable by anyone who
// ever loaded the portal. provision-node is deployed with gateway JWT verification OFF
// (see supabase/config.toml), so that secret was the only gate on an endpoint that creates
// auth.users rows and nodes rows without limit. Same class as the 20260725 RLS finding: the
// protection's NAME implied a gate the mechanism didn't provide.
//
// Two distinct holes are closed here:
//   1. THE SECRET IS SERVER-SIDE. PROVISION_SECRET (no VITE_ prefix — never add one) is read
//      from the Vercel environment and never leaves this function. Mirrors CRON_SECRET.
//   2. OWNERSHIP IS DERIVED, NOT DECLARED. provision-node only checks that `owner_id` is
//      present, and the wizard used to supply it from client state. With the leaked secret,
//      anyone could mint nodes owned by SOMEONE ELSE'S account — planting rows on a stranger's
//      field journal and handing them RLS-scoped write authority (nodes.owner_id → auth.users,
//      migration 20260705). Here owner_id comes from the verified caller's token and any
//      body-supplied owner_id is ignored outright.
//
// Deliberately does NOT use SUPABASE_SERVICE_ROLE_KEY: it needs no privileged read, and that
// var is Production-only, so depending on it would break Preview deploys. The anon key is
// sufficient — `nodes` carries a public read policy.

const RATE_WINDOW_DAYS = 7
const RATE_LIMIT = 5 // nodes per account per window

async function verifyCaller(url, anonKey, req) {
  const jwt = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: 'Sign in to register a node', status: 401 }

  // Validate the session against GoTrue rather than decoding locally — GoTrue understands this
  // project's kid'd JWT-signing-key tokens (the same reason storage-upload validates this way).
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
  })
  if (!r.ok) return { error: 'Invalid or expired session', status: 401 }

  const user = await r.json()
  if (!user?.id) return { error: 'Invalid or expired session', status: 401 }
  return { userId: user.id }
}

// Rate limit off the existing record rather than a new counter table: a node's own row IS the
// evidence it was provisioned. No migration, and it cannot drift out of sync with reality.
async function recentNodeCount(url, anonKey, ownerId) {
  const since = new Date(Date.now() - RATE_WINDOW_DAYS * 86400_000).toISOString()
  const r = await fetch(
    `${url}/rest/v1/nodes?owner_id=eq.${ownerId}&created_at=gte.${since}&select=id`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
  )
  if (!r.ok) return null // fail open on a read hiccup; the gate above is the real control
  const rows = await r.json()
  return Array.isArray(rows) ? rows.length : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const provisionSecret = process.env.PROVISION_SECRET
  if (!url || !anonKey || !provisionSecret) {
    console.error('register-node: missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY or PROVISION_SECRET')
    return res.status(500).json({ error: 'Registration is not configured' })
  }

  const caller = await verifyCaller(url, anonKey, req)
  if (caller.error) return res.status(caller.status).json({ error: caller.error })

  const recent = await recentNodeCount(url, anonKey, caller.userId)
  if (recent !== null && recent >= RATE_LIMIT) {
    return res.status(429).json({
      error: `Registration limit reached (${RATE_LIMIT} nodes in ${RATE_WINDOW_DAYS} days). Get in touch if you're building more.`,
    })
  }

  const { name, hardware_type, lat, lon, elevation_m, elevation_unit, habitat_type, species_whitelist } =
    req.body ?? {}

  if (!name || !hardware_type || lat == null || lon == null || !habitat_type) {
    return res.status(400).json({ error: 'Missing required fields: name, hardware_type, lat, lon, habitat_type' })
  }

  const upstream = await fetch(`${url}/functions/v1/provision-node`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-provision-secret': provisionSecret,
    },
    body: JSON.stringify({
      name,
      hardware_type,
      lat,
      lon,
      elevation_m,
      elevation_unit,
      habitat_type,
      species_whitelist,
      // Authoritative: the verified caller. Any owner_id in the request body is ignored.
      owner_id: caller.userId,
    }),
  })

  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    // Log upstream detail server-side; return the message without echoing internals.
    console.error('register-node: provision-node failed', upstream.status, data?.error)
    return res.status(upstream.status === 401 ? 500 : upstream.status).json({
      error: upstream.status === 401 ? 'Registration is not configured' : (data?.error || 'Provisioning failed'),
    })
  }

  // Node credentials (node_id / email / password) pass straight through to the wizard, which
  // shows them once and writes them into magora-config.json. Never logged.
  return res.status(200).json(data)
}
