// Shared bits for the Listen feature (phone field recordings).

// Amber/gold — visually distinct from the green node actions.
export const AMBER = {
  base: '#d9952b',
  light: '#f0c14b',
  dark: '#b87a1e',
  ink: '#3a2c0e',
}

export const BUCKET = 'temp-audio'
export const RECORD_SECONDS = 15 // default

// Recording length choices on the Ready screen. `secs: null` = open-ended
// (record until the user stops), capped at MAX_OPEN_SECONDS for safety.
export const DURATIONS = [
  { label: '15s', secs: 15 },
  { label: '30s', secs: 30 },
  { label: '1 min', secs: 60 },
  { label: 'Open', secs: null },
]
export const MAX_OPEN_SECONDS = 300 // 5 min hard cap for open-ended

// mm:ss for the elapsed counter in open-ended mode.
export function formatClock(totalSecs) {
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Ecological metadata options (tap-to-select in the Results step).
export const HABITATS = ['Forest', 'Grassland', 'Wetland', 'Riparian', 'Shrubland', 'Urban', 'Alpine', 'Desert']
export const CANOPY = ['Open', 'Partial', 'Closed']
export const DISTURBANCE = ['None', 'Low', 'Moderate', 'High']

// Pick a MediaRecorder mime the browser actually supports; return the mime + a
// matching file extension the worker can decode (it has ffmpeg + librosa).
export function pickAudioMime() {
  const candidates = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'mp4'],          // Safari/iOS
    ['audio/ogg;codecs=opus', 'ogg'],
  ]
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext }
    }
  }
  return { mime: '', ext: 'webm' } // let the browser choose its default
}

// Reverse-geocode lat/lon to a short human place name via OpenStreetMap Nominatim.
// Best-effort: falls back to rounded coordinates.
export async function reverseGeocode(lat, lon) {
  const coordsLabel = `${lat.toFixed(3)}, ${lon.toFixed(3)}`
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=${lat}&lon=${lon}`,
      { headers: { Accept: 'application/json' } },
    )
    if (!r.ok) return coordsLabel
    const data = await r.json()
    const a = data.address || {}
    const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.county
    const region = a.state || a.region || a.country
    if (place && region) return `${place}, ${region}`
    return data.name || place || region || coordsLabel
  } catch {
    return coordsLabel
  }
}

// Promise wrapper around the geolocation API.
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}
