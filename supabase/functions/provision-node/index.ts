import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-provision-secret",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  // --- auth gate ---
  const secret = req.headers.get("x-provision-secret")
  if (!secret || secret !== Deno.env.get("PROVISION_SECRET")) {
    return json({ error: "Unauthorized" }, 401)
  }

  // --- parse body ---
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const { name, hardware_type, lat, lon, elevation_m, habitat_type, species_whitelist } = body as {
    name: string
    hardware_type: string
    lat: number
    lon: number
    elevation_m?: number
    habitat_type: string
    species_whitelist?: string[]
  }

  if (!name || !hardware_type || lat == null || lon == null || !habitat_type) {
    return json({ error: "Missing required fields: name, hardware_type, lat, lon, habitat_type" }, 400)
  }

  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // --- step 1: create auth user ---
  // email is synthetic; node needs no real inbox
  const emailSlug = crypto.randomUUID()
  const email = `node-${emailSlug}@magora.internal`
  const password =
    crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip email verification flow
  })

  if (authError || !authData.user) {
    return json({ error: `Auth user creation failed: ${authError?.message}` }, 500)
  }

  const userId = authData.user.id

  // --- step 2: create nodes row (id = auth user UUID, per Option B) ---
  const { error: nodeError } = await admin.from("nodes").insert({
    id: userId,
    name,
    hardware_type,
    location: `POINT(${lon} ${lat})`,
    elevation_m: elevation_m ?? null,
    habitat_type,
    is_active: true,
    species_whitelist: species_whitelist && species_whitelist.length > 0 ? species_whitelist : null,
  })

  if (nodeError) {
    // Roll back: delete the auth user so we don't leave orphans
    await admin.auth.admin.deleteUser(userId)
    return json({ error: `Node insert failed: ${nodeError.message}` }, 500)
  }

  // --- return credentials to wizard ---
  return json({ node_id: userId, email, password })
})
