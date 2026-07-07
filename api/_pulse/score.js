// Pulse Agent v1 — scoring. Pure and mode-agnostic: the same function ranks candidates
// for the on-demand and batch entry points. Weights come from the config surface
// (public.pulse_weights), never inlined here; every component sub-score is preserved on
// the payload and the weights_version is stamped, so stored payloads can be re-ranked
// later by adding a new weights_version row — no code change, no regeneration.

/**
 * Aggregate score = Σ weight_i · component_i over the components the weights_version
 * defines for this kind. Components with no configured weight are ignored in the sum but
 * still recorded (retro-tuning). Returns payload drafts ranked by score desc; node_id,
 * window, generated_at and pulse_id are attached at store time.
 *
 * @param {import('./payload.js').Candidate[]} candidates
 * @param {Record<string, Record<string, number>>} weightsByKind  kind -> { component: weight }
 * @param {string} weightsVersion
 */
export function scorePulses(candidates, weightsByKind, weightsVersion) {
  const scored = candidates.map((c) => {
    const weights = weightsByKind[c.kind] || {}
    let score = 0
    for (const [component, w] of Object.entries(weights)) {
      score += w * (c.components[component] ?? 0)
    }
    return {
      kind: c.kind,
      score: round(score),
      components: roundAll(c.components),
      weights_version: weightsVersion,
      subject: c.subject || {},
      ...(c.survey_gap ? { survey_gap: c.survey_gap } : {}),
      evidence: c.evidence || {},
    }
  })
  return scored.sort((a, b) => b.score - a.score)
}

const round = (n) => Math.round(n * 1000) / 1000
function roundAll(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === 'number' ? round(v) : v
  return out
}
