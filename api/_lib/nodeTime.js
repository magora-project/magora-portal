import tzLookup from 'tz-lookup'
import { pgFetch } from '../_pulse/db.js'

const HOUR_MS = 3600000

function locationCoordinates(location) {
  if (Array.isArray(location?.coordinates)) return { lon: Number(location.coordinates[0]), lat: Number(location.coordinates[1]) }
  if (typeof location !== 'string') return null
  try {
    const bytes = location.match(/.{2}/g)?.map((b) => parseInt(b, 16))
    if (!bytes?.length) return null
    const view = new DataView(new Uint8Array(bytes).buffer)
    const littleEndian = bytes[0] === 1
    const hasSrid = (view.getUint32(1, littleEndian) & 0x20000000) !== 0
    const offset = hasSrid ? 9 : 5
    return { lon: view.getFloat64(offset, littleEndian), lat: view.getFloat64(offset + 8, littleEndian) }
  } catch { return null }
}

function solarOffset(lon) {
  if (!Number.isFinite(lon)) return null
  const minutes = Math.round(lon / 15 * 60 / 15) * 15
  const bounded = Math.max(-12 * 60, Math.min(14 * 60, minutes))
  const sign = bounded < 0 ? '-' : '+'
  const absolute = Math.abs(bounded)
  return `Etc/GMT${sign}${Math.round(absolute / 60)}`
}

export function nodeTimeZone(node) {
  const coords = locationCoordinates(node?.location)
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null
  try {
    const zone = tzLookup(coords.lat, coords.lon)
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date())
    return zone
  } catch (error) {
    console.warn('nodeTimeZone lookup failed; using solar offset:', error?.message || error)
    return solarOffset(coords.lon)
  }
}

export function toNodeLocal(utc, tz) {
  const instant = new Date(utc)
  if (Number.isNaN(instant.getTime())) throw new Error(`invalid UTC date: ${utc}`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) }
}

function wallMidnightUtc(date, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid local date: ${date}`)
  const [year, month, day] = date.split('-').map(Number)
  let guess = Date.UTC(year, month - 1, day)
  for (let i = 0; i < 4; i++) {
    const local = toNodeLocal(new Date(guess), tz)
    const localWall = Date.UTC(...local.date.split('-').map(Number).map((v, index) => index === 1 ? v - 1 : v), local.hour, local.minute)
    const wantedWall = Date.UTC(year, month - 1, day)
    const adjustment = wantedWall - localWall
    guess += adjustment
    if (adjustment === 0) break
  }
  return guess
}

export function nodeDayWindow(date, tz) {
  const start = wallMidnightUtc(date, tz)
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  const end = wallMidnightUtc(next, tz)
  return [new Date(start).toISOString(), new Date(end).toISOString()]
}

export async function nodeTenure(nodeId, now = new Date()) {
  let heartbeat = await pgFetch(`aci_logs?node_id=eq.${encodeURIComponent(nodeId)}&select=recorded_at&order=recorded_at.asc&limit=1`)
  if (!heartbeat?.recorded_at) heartbeat = await pgFetch(`detections?node_id=eq.${encodeURIComponent(nodeId)}&select=detected_at&order=detected_at.asc&limit=1`)
  const first = heartbeat?.recorded_at || heartbeat?.detected_at
  if (!first) return { first_heard_at: null, hours_listening: 0, days_listening: 0 }
  const hours = Math.max(0, (new Date(now).getTime() - new Date(first).getTime()) / HOUR_MS)
  return { first_heard_at: first, hours_listening: hours, days_listening: hours / 24 }
}
