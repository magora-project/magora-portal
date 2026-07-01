import { supabase } from './supabase'

// Uploads a file through the storage-upload Edge Function instead of directly to
// Storage. Needed because this project's Storage service (v1.60.10) can't validate
// the JWT-signing-key access tokens (they carry a `kid` header it doesn't parse),
// so direct client uploads fail RLS. The function validates the session server-side
// and writes with the service role, scoped to the user's own {uid}/ folder.
// Returns the stored path ("{uid}/{filename}").
//
// TODO: once Storage is upgraded to a version that supports signing keys, delete
// this and go back to supabase.storage.from(bucket).upload(...) directly.
export async function uploadViaFunction({ bucket, filename, file }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session has expired. Please sign in again.')

  const form = new FormData()
  form.append('file', file)
  form.append('bucket', bucket)
  form.append('filename', filename)

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Upload failed')
  return data.path
}
