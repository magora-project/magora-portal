import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

// Buckets a signed-in user may upload to (always into their own {uid}/ folder).
const ALLOWED_BUCKETS = new Set(["listener-avatars", "temp-audio"])
const MAX_BYTES = 25 * 1024 * 1024

// Workaround for a Storage service (v1.60.10) that can't validate the project's
// JWT-signing-key tokens (they carry a `kid` header old Storage doesn't parse),
// so direct client uploads fail RLS. Here we validate the user's token via GoTrue
// (which handles the kid) and upload with the service role, scoped to the user's
// own folder. Delete this + revert clients to direct uploads once Storage is
// upgraded to a version that supports signing keys.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "Missing Authorization token" }, 401)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Validate the session server-side (GoTrue understands the kid'd token).
  const { data: { user }, error: authError } = await admin.auth.getUser(jwt)
  if (authError || !user) return json({ error: "Invalid or expired session" }, 401)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400)
  }

  const file = form.get("file")
  const bucket = String(form.get("bucket") ?? "")
  const filename = String(form.get("filename") ?? "")

  if (!(file instanceof File)) return json({ error: "Missing file" }, 400)
  if (!ALLOWED_BUCKETS.has(bucket)) return json({ error: "Bucket not allowed" }, 400)
  // No path traversal: a plain filename only. The folder is always the user's uid.
  if (!filename || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return json({ error: "Invalid filename" }, 400)
  }
  if (file.size > MAX_BYTES) return json({ error: "File too large" }, 400)

  const path = `${user.id}/${filename}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error: upErr } = await admin.storage.from(bucket).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  })
  if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500)

  return json({ path })
})
