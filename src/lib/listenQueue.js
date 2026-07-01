import { openDB } from 'idb'
import { supabase } from './supabase'
import { BUCKET } from './listen'
import { uploadViaFunction } from './storageUpload'

const DB_NAME = 'magora-listen-queue'
const STORE_NAME = 'pending-listens'
const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
  },
})

const subscribers = new Set()

async function broadcast() {
  const items = await getQueuedListens()
  for (const fn of subscribers) {
    try {
      fn(items)
    } catch {
      // ignore subscriber failures
    }
  }
}

export async function getQueuedListens() {
  return (await dbPromise).getAll(STORE_NAME)
}

export function subscribeQueuedListens(callback) {
  subscribers.add(callback)
  getQueuedListens().then(items => {
    if (subscribers.has(callback)) callback(items)
  })
  return () => subscribers.delete(callback)
}

export async function addQueuedListen(listen) {
  const item = {
    ...listen,
    queued_at: listen.queued_at || new Date().toISOString(),
    status: listen.status || 'queued',
    error_message: null,
  }
  await (await dbPromise).put(STORE_NAME, item)
  await broadcast()
  return item
}

export async function updateQueuedListen(id, patch) {
  const db = await dbPromise
  const item = await db.get(STORE_NAME, id)
  if (!item) return null
  const updated = { ...item, ...patch }
  await db.put(STORE_NAME, updated)
  await broadcast()
  return updated
}

export async function deleteQueuedListen(id) {
  await (await dbPromise).delete(STORE_NAME, id)
  await broadcast()
}

export async function syncQueuedListen(item) {
  await updateQueuedListen(item.id, { status: 'syncing', error_message: null })

  // Via the storage-upload function (see uploadViaFunction) — direct Storage
  // uploads fail token validation on this project's Storage version. Returns the
  // stored "{uid}/{filename}" path.
  let path
  try {
    path = await uploadViaFunction({
      bucket: BUCKET,
      filename: `${item.id}.${item.audio_ext}`,
      file: item.audio_blob,
    })
  } catch (e) {
    await updateQueuedListen(item.id, { status: 'error', error_message: e.message })
    throw e
  }

  const insert = await supabase.from('mobile_detections').insert({
    id: item.id,
    user_id: item.user_id,
    lat: item.lat,
    lon: item.lon,
    status: 'pending',
    audio_path: path,
    device_info: item.device_info,
    detected_at: item.detected_at,
    habitat_type: item.habitat_type ?? null,
    canopy_cover: item.canopy_cover ?? null,
    water_present: item.water_present ?? null,
    disturbance_level: item.disturbance_level ?? null,
    observer_notes: item.observer_notes ?? null,
    synced_at: new Date().toISOString(),
    published: false,
  })

  if (insert.error) {
    await updateQueuedListen(item.id, { status: 'error', error_message: insert.error.message })
    throw insert.error
  }

  await deleteQueuedListen(item.id)
  return insert.data?.[0] ?? null
}

export async function flushQueuedListens() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const items = await getQueuedListens()
  for (const item of items) {
    try {
      await syncQueuedListen(item)
    } catch (error) {
      console.warn('Queued listen sync failed:', error)
    }
  }
}

export function initListenQueue() {
  if (typeof window === 'undefined') return () => {}
  const handleOnline = () => {
    flushQueuedListens().catch(err => console.warn('Flush queue failed:', err))
  }

  window.addEventListener('online', handleOnline)
  if (navigator.onLine) {
    handleOnline()
  }

  return () => {
    window.removeEventListener('online', handleOnline)
  }
}
