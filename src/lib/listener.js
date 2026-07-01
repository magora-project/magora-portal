import { supabase } from './supabase'
import { uploadViaFunction } from './storageUpload'

// Handles are lowercase, URL-safe, and can't collide with app routes. Kept here
// (not in a page) so both the /journal/:handle claim form and the sign-in handle
// prompt validate against the same rules.
export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'journal', 'me', 'support', 'help', 'www', 'mail',
  'node', 'species', 'dashboard', 'register', 'about', 'donate', 'listen',
])

export function validateHandle(value) {
  if (!value) return 'Choose a handle for your field journal.'
  if (!/^[a-z0-9_]{3,24}$/.test(value)) {
    return 'Use 3–24 lowercase letters, numbers, or underscores.'
  }
  if (RESERVED_HANDLES.has(value)) {
    return 'That handle is reserved. Pick another one.'
  }
  return null
}

// Upload limits for listener avatars. Kept small — these are public-read and
// rendered at ~90px, so there's no reason to accept large originals.
const AVATAR_MAX_BYTES = 3 * 1024 * 1024 // 3 MB
const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export async function getListenerByUser(userId) {
  const { data, error } = await supabase.from('listeners').select('*').eq('id', userId).maybeSingle()
  return error ? null : data
}

export async function getListenerByHandle(handle) {
  const { data, error } = await supabase.from('listeners').select('*').eq('handle', handle).maybeSingle()
  return error ? null : data
}

export async function createListener(profile) {
  // Insert defaults to return=minimal in supabase-js v2, so we must .select()
  // to get the row back — otherwise .single() resolves with no row and errors.
  const { data, error } = await supabase.from('listeners').insert(profile).select().single()
  if (error) throw error
  return data
}

export async function updateListener(userId, patch) {
  const { data, error } = await supabase.from('listeners').update(patch).eq('id', userId).select().single()
  if (error) throw error
  return data
}

// userId is kept for call-site compatibility but the target folder is derived
// server-side from the validated session (see uploadViaFunction).
export async function uploadListenerAvatar(userId, file) {
  if (!file) return null
  const ext = AVATAR_TYPES[file.type]
  if (!ext) {
    throw new Error('Avatar must be a PNG, JPEG, or WebP image.')
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('Avatar is too large. Please use an image under 3 MB.')
  }
  return uploadViaFunction({ bucket: 'listener-avatars', filename: `avatar.${ext}`, file })
}

export function getListenerAvatarUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from('listener-avatars').getPublicUrl(path)
  return data?.publicUrl || null
}
