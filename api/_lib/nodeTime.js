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

// Etc/GMT signs are POSIX-inverted: west of Greenwich (negative offset) is Etc/GMT+N.
function solarOffset(lon) {
  if (!Number.isFinite(lon)) return null
  const minutes = Math.round(lon / 15 * 60 / 15) * 15
  const bounded = Math.max(-12 * 60, Math.min(14 * 60, minutes))
  if (bounded === 0) return 'Etc/GMT'
  const sign = bounded < 0 ? '+' : '-'
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

// Validate a 'YYYY-MM-DD' string as a REAL calendar date (not just digit-shaped): 2026-13-01 and
// 2026-02-30 must be rejected, not silently normalized by Date.UTC into a different date.
export function isValidLocalDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function wallMidnightUtc(date, tz) {
  if (!isValidLocalDate(date)) throw new Error(`invalid local date: ${date}`)
  const [year, month, day] = date.split('-').map(Number)
  let guess = Date.UTC(year, month - 1, day)
  for (let i = 0; i < 6; i++) {
    const local = toNodeLocal(new Date(guess), tz)
    const localWall = Date.UTC(...local.date.split('-').map(Number).map((v, index) => index === 1 ? v - 1 : v), local.hour, local.minute)
    const wantedWall = Date.UTC(year, month - 1, day)
    const adjustment = wantedWall - localWall
    guess += adjustment
    if (adjustment === 0) break
  }
  const converged = toNodeLocal(new Date(guess), tz)
  if (converged.date === date && converged.hour === 0 && converged.minute === 0) return guess
  // Nonexistent local midnight: some zones spring forward AT 00:00 (America/Havana 2026-03-08,
  // America/Santiago 2026-09-06), so the fixed-point search above oscillates between 23:00 on the
  // prior date and 01:00 on the requested one. The local day then starts at its first valid
  // instant (e.g. 01:00), which the boundary search finds exactly.
  return firstInstantOfLocalDate(date, tz)
}

// First instant whose local wall-clock date is `date` — local midnight when it exists, or the
// first valid instant of the date (e.g. 01:00) when a 00:00 DST transition skips midnight.
// The local date is monotonic non-decreasing in the UTC instant, so a binary search converges
// regardless of transition shape. Second resolution: IANA transitions fall on whole seconds, so
// the result is the exact first valid instant.
function firstInstantOfLocalDate(date, tz) {
  const [year, month, day] = date.split('-').map(Number)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const localAt = (ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day}`
  }
  // ±26h brackets every IANA offset (UTC-12 … UTC+14) with margin, so `lo` is certainly on the
  // prior local date and `hi` certainly on or after the requested one.
  let lo = Date.UTC(year, month - 1, day) - 26 * HOUR_MS
  let hi = Date.UTC(year, month - 1, day) + 26 * HOUR_MS
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2)
    if (localAt(mid) < date) lo = mid
    else hi = mid
  }
  // Snap to the exact second: IANA transitions fall on whole seconds, and the loop leaves `hi`
  // up to 1s past the boundary. Rounding down to the second and nudging if that second still
  // reads as the prior date lands exactly on the first valid instant.
  const snapped = Math.floor(hi / 1000) * 1000
  return localAt(snapped) < date ? snapped + 1000 : snapped
}

export function nodeDayWindow(date, tz) {
  const start = wallMidnightUtc(date, tz)
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  const end = wallMidnightUtc(next, tz)
  return [new Date(start).toISOString(), new Date(end).toISOString()]
}

// Tenure lookup that distinguishes "no history" from "the lookup failed". pgFetch collapses a
// timeout/5xx to null, which is indistinguishable from a legitimately empty table — and would let
// a transient failure turn a mature node's tenure into a false 422 (or a wrong first-impression
// framing). The primary read therefore throws on non-2xx; the fallback tolerates emptiness.
async function firstRowOrThrow(path) {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`tenure lookup failed: HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data[0] || null : data
}

export async function nodeTenure(nodeId, now = new Date()) {
  let heartbeat = await firstRowOrThrow(`aci_logs?node_id=eq.${encodeURIComponent(nodeId)}&select=recorded_at&order=recorded_at.asc&limit=1`)
  if (!heartbeat?.recorded_at) heartbeat = await pgFetch(`detections?node_id=eq.${encodeURIComponent(nodeId)}&select=detected_at&order=detected_at.asc&limit=1`)
  const first = heartbeat?.recorded_at || heartbeat?.detected_at
  if (!first) return { first_heard_at: null, hours_listening: 0, days_listening: 0 }
  const hours = Math.max(0, (new Date(now).getTime() - new Date(first).getTime()) / HOUR_MS)
  return { first_heard_at: first, hours_listening: hours, days_listening: hours / 24 }
}

// NOAA solar approximation (~±2 min at mid-latitudes). Returns signed minutes between the instant
// and that UTC day's sunrise at (lat, lon) — the same convention as the Pi's minutes_from_sunrise
// (positive = after sunrise) — so node telemetry can be validated server-side before it is trusted.
// null for invalid input or polar day/night (no sunrise that day).
export function minutesFromSunriseAt(lat, lon, instant) {
  const d = new Date(instant)
  if (Number.isNaN(d.getTime()) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const dayOfYear = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + 12 / 24)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma))
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma)
  const latRad = lat * Math.PI / 180
  const cosH = (Math.cos(90.833 * Math.PI / 180) / (Math.cos(latRad) * Math.cos(decl))) - Math.tan(latRad) * Math.tan(decl)
  if (cosH > 1 || cosH < -1) return null
  const hourAngle = Math.acos(cosH) * 180 / Math.PI
  const sunriseUtcMinutes = 720 - 4 * (lon + hourAngle) - eqTime
  const instantUtcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
  let diff = instantUtcMinutes - sunriseUtcMinutes
  if (diff < -720) diff += 1440
  if (diff > 720) diff -= 1440
  return diff
}
