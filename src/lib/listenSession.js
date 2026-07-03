// Listen Sessions (Task G) — client data layer.
//
// A session is one listener outing that can hold several captures and carries a
// single synthesized insight. This module is the data contract the ListenModal
// (Phase B) and the feed (Phase C) build on. It mirrors the schema in
// supabase/migrations/20260707_listen_sessions.sql — keep the two in sync.
//
// Consent model: the SESSION is the public unit. Captures stay published=false;
// publishing the session is what surfaces it (aggregated) on the feed.

import { supabase, MIN_CONFIDENCE } from './supabase'
import { isHiddenSpecies } from './hiddenSpecies'
import { summarizeGroups } from './inat'

// Merge species across a session's captures: one entry per common name, keeping
// the highest confidence, sorted by confidence. Mirrors the in-view aggregation
// in public_listen_sessions, for building the insight payload and previewing the
// combined list before publish.
export function aggregateSpecies(captures) {
  const best = new Map()
  for (const cap of captures || []) {
    for (const s of cap.species || []) {
      if (!s?.common_name) continue
      const prev = best.get(s.common_name)
      if (!prev || (s.confidence ?? 0) > (prev.confidence ?? 0)) best.set(s.common_name, s)
    }
  }
  return [...best.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}

// The session's public centroid: the average of its captures' coordinates.
export function centroid(points) {
  const pts = (points || []).filter(p => p && p.lat != null && p.lon != null)
  if (!pts.length) return null
  return {
    lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length,
    lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length,
  }
}

// Normalize the modal's raw metadata chips to the column shapes shared by the
// listen_sessions row and the /api/insight payload.
function normalizeMetadata(m) {
  return {
    habitat_type: m?.habitat?.toLowerCase() ?? null,
    canopy_cover: m?.canopy?.toLowerCase() ?? null,
    water_present: m?.water == null ? null : m.water === 'Yes',
    disturbance_level: m?.disturbance?.toLowerCase() ?? null,
    observer_notes: m?.notes?.trim() || null,
  }
}

// Open a session on the first capture of an outing. Returns the id, which each
// capture is stamped with (mobile_detections.session_id). Owner-only RLS.
export async function createSession({ userId, coords }) {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('listen_sessions').insert({
    id,
    user_id: userId,
    lat: coords?.lat ?? null,
    lon: coords?.lon ?? null,
  })
  if (error) throw error
  return id
}

// Publish the outing: set centroid, place metadata, synthesized insight, and end
// time, and flip published=true so it appears (aggregated) on the public feed.
// Captures are left published=false — the session is the public unit.
export async function publishSession(sessionId, { center, metadata, insight }) {
  const { error } = await supabase.from('listen_sessions').update({
    lat: center?.lat ?? null,
    lon: center?.lon ?? null,
    ended_at: new Date().toISOString(),
    ...normalizeMetadata(metadata),
    insight: insight ?? null,
    published: true,
  }).eq('id', sessionId)
  if (error) throw error
}

// Discard the outing: delete its captures, then the session (both owner-only).
export async function discardSession(sessionId) {
  await supabase.from('mobile_detections').delete().eq('session_id', sessionId)
  await supabase.from('listen_sessions').delete().eq('id', sessionId)
}

// Build the /api/insight payload for the WHOLE session: the aggregated community
// heard across every capture, the outing's place metadata + notes, its centroid,
// and the surrounding iNat web. Reuses the existing `mobile` branch, which already
// reads all species as one community — no prompt change needed.
export function buildSessionInsightPayload({ captures, center, metadata, nearby }) {
  const species = aggregateSpecies(captures)
    .filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
  return {
    mobile: true,
    species,
    lat: center?.lat,
    lon: center?.lon,
    detected_at: new Date().toISOString(),
    tz_offset: new Date().getTimezoneOffset(),
    ...normalizeMetadata(metadata),
    nearby: nearby ? {
      total_species: nearby.total_species,
      radius_km: nearby.location?.radius_km,
      groups: summarizeGroups(nearby.groups).map(g => ({ label: g.label, count: g.count })),
      top: nearby.taxa.slice(0, 20).map(t => ({ common: t.common, name: t.name, iconic: t.iconic })),
    } : null,
  }
}
