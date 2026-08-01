// Narrative Agent v1.1 — on-demand entry point (HTTP). Pulse's first consumer.
//
// POST { node_id, window?, surface?, voice? }  (surface default detection_card — the NodePage
// "Pulse" panel is a single-question container; voice default 'node').
//
// Flow: pulseOnDemand (check-before-generate, 6h TTL) -> take the pulse ASSIGNED TO THE
// REQUESTED SURFACE, read straight off the response as `selected` (never re-rank/re-route;
// routing is Pulse's, D5) -> check the PER-VOICE render cache (pulse_narratives, keyed on
// (pulse_id, voice)) ->
// on miss/stale render via narrate(payload, voice) + cache -> return { pulse, narrative, voice }.
// { pulse: null } (nothing to say / nothing assigned to this surface) -> quiet empty state.
//
// v1.1: check-before-generate is keyed on (pulse, voice) — each voice caches independently, so
// toggling voices reuses cached renders. api/_pulse/* is reused READ-ONLY. Pulse scoring/
// selection is not modified. Place data only — no person data, no Slack path.

import { pulseOnDemand } from './_pulse/core.js'
import { pgFetch, sbRpc } from './_pulse/db.js'
import { narrate } from './_narrative/narrate.js'
import { getVoice, DEFAULT_VOICE } from './_narrative/voices.js'

const enc = encodeURIComponent

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const nodeId = req.body?.node_id
  if (!nodeId) return res.status(400).json({ error: 'node_id required' })
  const surface = req.body?.surface ?? 'detection_card'

  // Resolve the requested voice up front — unknown / unregistered / 'elder' hard-rejects
  // (no silent fallback to node).
  const voice = req.body?.voice ?? DEFAULT_VOICE
  if (!getVoice(voice)) return res.status(400).json({ error: `unknown or unavailable voice: ${voice}` })

  try {
    // Pulse does the generate/cache; we consume the surface assignment only.
    //
    // `selected` is the payload Pulse routed to THIS surface, resolved by pulseOnDemand over the
    // ranked list it already held — so there is no second read of `pulses` here. It carries
    // generated_at, which is what the freshness compare below needs. It is null when nothing was
    // routed, and also for a list-cardinality surface (node_report): a narrative voices ONE pulse,
    // so a ranked list has nothing single to render.
    const { selected } = await pulseOnDemand(nodeId, req.body?.window, surface)
    if (!selected || selected.kind === 'absence') {
      return res.status(200).json({ pulse: null, narrative: null, voice })
    }
    const payload = selected
    const targetId = payload.pulse_id

    // Per-voice cache hit (migration 20260718): serve stored text when it was narrated at or
    // after the pulse was (re)generated. Stale (narrated_at < generated_at) => regenerate.
    const cached = await pgFetch(
      `pulse_narratives?pulse_id=eq.${targetId}&voice=eq.${enc(voice)}&select=narrative,voice,narrated_at`,
    )
    if (cached && new Date(cached.narrated_at).getTime() >= new Date(payload.generated_at).getTime()) {
      return res.status(200).json({ pulse: payload, narrative: { text: cached.narrative, voice }, voice })
    }

    // Render + persist (best-effort write-back; a failed write just re-generates next time).
    const out = await narrate(payload, voice)
    if (!out) return res.status(200).json({ pulse: payload, narrative: null, voice }) // nothing grounded to say
    if (out.error) {
      console.error('narrate error:', out.error)
      return res.status(502).json({ error: 'narrative generation failed' })
    }
    await sbRpc('set_pulse_narrative', {
      p_pulse_id: targetId,
      p_voice: out.voice,
      p_narrative: out.text,
      p_model: out.model,
      p_voices_version: out.voices_version,
    }).catch((e) => console.warn('set_pulse_narrative failed:', e.message))

    return res.status(200).json({ pulse: payload, narrative: out, voice: out.voice })
  } catch (e) {
    console.error('narrative-ondemand error:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
