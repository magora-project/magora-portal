import { supabase } from './supabase'

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

export async function uploadListenerAvatar(userId, file) {
  if (!file) return null
  const ext = AVATAR_TYPES[file.type]
  if (!ext) {
    throw new Error('Avatar must be a PNG, JPEG, or WebP image.')
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('Avatar is too large. Please use an image under 3 MB.')
  }
  const path = `${userId}/avatar.${ext}`
  const { error } = await supabase.storage.from('listener-avatars').upload(path, file, {
    upsert: true,
    contentType: file.type,
  })
  if (error) throw error
  return path
}

export function getListenerAvatarUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from('listener-avatars').getPublicUrl(path)
  return data?.publicUrl || null
}
