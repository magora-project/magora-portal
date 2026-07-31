import { supabase } from './supabase'
import { uploadViaFunction } from './storageUpload'

// Node banner photo — the owner-set photograph at the top of a node's page.
//
// Storage holds a PATH ("{owner_uid}/{filename}"); the public URL is derived here at render time,
// so the stored row survives a bucket move or a switch to signed URLs.
//
// Uploads route through the storage-upload Edge Function rather than going to Storage directly —
// see storageUpload.js for why (this project's Storage version can't validate the kid'd JWTs).
// The function pins the folder to the caller's uid, so the path is not client-controlled.

const BUCKET = 'node-banners'

// Comfortably under the function's 25MB ceiling: a banner is displayed ~430px wide, so anything
// larger is bytes a visitor downloads and never sees. Checked client-side to fail fast with a
// useful message; the function enforces its own limit regardless.
export const MAX_BANNER_BYTES = 8 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/avif'

/** Public URL for a stored banner path, or null when the node has no photo. */
export function getNodeBannerUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

/**
 * Upload a new banner for a node and record it on the node row.
 *
 * The filename is keyed on the NODE, not the upload, for two reasons: a steward with several nodes
 * would otherwise collide in their single {uid}/ folder, and re-uploading overwrites in place
 * instead of accumulating orphaned files nothing points at.
 *
 * @param {string} nodeId
 * @param {File} file
 * @returns {Promise<string>} the stored path
 */
export async function uploadNodeBanner(nodeId, file) {
  if (!file) throw new Error('No file selected.')
  if (file.size > MAX_BANNER_BYTES) {
    throw new Error(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — please pick one under ${MAX_BANNER_BYTES / 1024 / 1024}MB.`)
  }
  if (!file.type?.startsWith('image/')) {
    throw new Error('That file needs to be an image.')
  }

  // Cache-bust: the public URL is stable per path, so a re-upload to the same key would keep
  // serving the old photo from the CDN/browser cache. A version suffix makes each save a new URL.
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const filename = `node-${nodeId}-${Date.now()}.${ext}`

  const path = await uploadViaFunction({ bucket: BUCKET, filename, file })

  // Owner check lives in the RPC (auth.uid() = nodes.owner_id); nodes has no client UPDATE policy.
  const { error } = await supabase.rpc('set_node_banner', { p_node_id: nodeId, p_path: path })
  if (error) throw new Error(error.message || 'Could not save the photo.')
  return path
}

/** Clear a node's banner, falling back to the habitat placeholder. */
export async function clearNodeBanner(nodeId) {
  const { error } = await supabase.rpc('set_node_banner', { p_node_id: nodeId, p_path: null })
  if (error) throw new Error(error.message || 'Could not remove the photo.')
}
