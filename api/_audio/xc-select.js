// Xeno-canto reference-recording selection — pure, no network.
//
// The species card's "what this species sounds like" affordance used to take the FIRST
// recording an aggregator returned, which is why playback sounded poor: xeno-canto's
// back catalogue is full of 22 kHz mono MP3s and grade C/D field clips, and first-match
// hits them as often as not. This module ranks the candidate set instead.
//
// Ordering is a strict tuple, not a weighted score — grade is never traded away for
// sample rate, and the soft signals (length, type) only break ties among equals:
//   1. quality grade   A > B > C > D > E > unrated
//   2. sample rate     highest wins (bucketed — 44.1k and 48k are not meaningfully
//                      different to a listener, but 22k vs 44.1k very much is)
//   3. length sanity   prefer clips long enough to contain the bird, short enough
//                      not to be mostly wind before it
//   4. vocalisation    song/call preferred over alarm/flight/wing noise
//
// Callers apply the fallback ladder by re-querying with a lower floor (see pickBest).

// A (best) → E, per xeno-canto's grading. Unrated sorts last but stays eligible:
// seldom-recorded species are often entirely unrated, and no audio is worse than
// unrated audio.
const GRADE_RANK = { A: 0, B: 1, C: 2, D: 3, E: 4 }
const UNRATED_RANK = 5

export function gradeRank(q) {
  const g = typeof q === 'string' ? q.trim().toUpperCase() : ''
  return g in GRADE_RANK ? GRADE_RANK[g] : UNRATED_RANK
}

// Bucketed so near-identical rates don't shuffle the order on noise. Unknown `smp`
// sorts below every known rate but above nothing — legacy records omit the field.
export function sampleRateRank(smp) {
  const hz = Number(smp)
  if (!Number.isFinite(hz) || hz <= 0) return 4 // unknown
  if (hz >= 44100) return 0                     // 44.1k / 48k — full quality
  if (hz >= 32000) return 1
  if (hz >= 22050) return 2
  return 3                                      // 16k and below — audibly poor
}

// xeno-canto reports length as "m:ss" or "h:mm:ss"; older records sometimes use
// plain seconds. Returns seconds, or null when unparseable.
export function lengthSeconds(length) {
  if (typeof length === 'number' && Number.isFinite(length)) return length
  if (typeof length !== 'string') return null
  const parts = length.trim().split(':')
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null
  const nums = parts.map(Number)
  if (nums.length === 1) return nums[0]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  return null
}

// A tie-breaker, deliberately not a filter: a 4-minute grade-A recording still beats
// a 20-second grade-B one. 5–90s is the band where a reference clip is usually the
// bird and little else.
export function lengthRank(length) {
  const s = lengthSeconds(length)
  if (s == null) return 1        // unknown — don't punish, don't prefer
  if (s >= 5 && s <= 90) return 0
  if (s > 90 && s <= 180) return 2
  if (s >= 3 && s < 5) return 3
  return 4                       // < 3s (clipped) or > 3min (mostly ambience)
}

// `type` is free text ("song", "call, alarm call", "flight call", "wing beats").
// Song and call are what a reference card wants; mechanical sounds are a last resort.
export function typeRank(type) {
  const t = typeof type === 'string' ? type.toLowerCase() : ''
  if (!t) return 2
  if (t.includes('song')) return 0
  if (t.includes('call')) return 1
  return 3
}

// Strict lexicographic comparison over the four ranks.
export function compareRecordings(a, b) {
  return (
    gradeRank(a?.q) - gradeRank(b?.q) ||
    sampleRateRank(a?.smp) - sampleRateRank(b?.smp) ||
    lengthRank(a?.length) - lengthRank(b?.length) ||
    typeRank(a?.type) - typeRank(b?.type)
  )
}

// Only recordings we can actually play. xeno-canto returns protocol-relative and
// occasionally empty `file` values.
export function playable(r) {
  return !!(r && typeof r.file === 'string' && r.file.trim())
}

export function normaliseFileUrl(file) {
  const f = String(file).trim()
  if (f.startsWith('//')) return `https:${f}`
  if (f.startsWith('http://')) return `https://${f.slice(7)}`
  return f
}

export function rankRecordings(recordings) {
  return (Array.isArray(recordings) ? recordings : []).filter(playable).sort(compareRecordings)
}

// The whole selection in one call: rank, take the winner, and report why it won so
// the caller can log/attribute it.
export function pickBest(recordings) {
  const ranked = rankRecordings(recordings)
  const best = ranked[0]
  if (!best) return null
  return {
    url: normaliseFileUrl(best.file),
    id: best.id ?? null,
    quality: best.q ?? null,
    sampleRate: Number(best.smp) || null,
    length: best.length ?? null,
    type: best.type ?? null,
    recordist: best.rec ?? null,
    licence: best.lic ?? null,
    page: best.url ? normaliseFileUrl(best.url) : null,
    candidates: ranked.length,
  }
}
