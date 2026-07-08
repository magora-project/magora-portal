// Narrative Agent v1 — render a PulsePayload into short node-voice prose ending on one
// question. Pulse decides WHAT is worth saying; Narrative decides only HOW it is said.
// Factual content is fixed by the payload — the LLM renders, it is never the knowledge
// source. Same payload -> same facts; only wording/style varies.
//
// Prompt-building is split from the Claude call (mirrors buildNodeInsightPrompt /
// generateInsight in api/insight.js) so the grounding can be unit-tested without a live
// call. Haiku-rendered; generateInsight already strips em-dashes to house style.

import { generateInsight, INSIGHT_MODEL } from '../insight.js'

// Extract ONLY the grounded facts the payload actually carries, per kind. Never derives a
// species/place/relationship that isn't in the payload. `absence` returns null (gated).
function groundedFacts(payload) {
  const subj = payload.subject || {}
  const ev = payload.evidence || {}
  const species = Array.isArray(subj.species) && subj.species.length ? subj.species[0] : null

  switch (payload.kind) {
    case 'novel_detection':
      return {
        lines: [
          species ? `${species} was detected here for the first time in my records` : `a species new to my records was detected here`,
          ev.first_seen ? `first heard around ${ev.first_seen}` : null,
          ev.conservation_status && String(ev.conservation_status).toUpperCase() !== 'LC'
            ? `it carries a conservation status of ${ev.conservation_status}` : null,
        ].filter(Boolean),
      }
    case 'activity_spike':
      return {
        lines: [
          `bird activity here has risen above my recent baseline`,
          ev.ratio ? `roughly ${ev.ratio} times the usual detection rate for me` : null,
        ].filter(Boolean),
      }
    case 'soundscape_shift':
      return {
        lines: [
          `my soundscape has ${ev.direction === 'down' ? 'grown quieter' : 'grown busier'} than my recent baseline`,
          ev.delta != null ? `a change in acoustic complexity of ${ev.delta}` : null,
        ].filter(Boolean),
      }
    case 'survey_gap_question':
      return {
        lines: [payload.survey_gap?.question_focus || `there is something here I do not yet have a clear read on`],
        // survey_gap is a QUESTION, not a claim. relationship_rationale is NOT asserted:
        // relationship_strength / phenology_alignment are neutral 0.5 placeholders (guild/
        // diet + GloBI + USA-NPN unbuilt), so any relational thread is open wondering.
        isGap: true,
      }
    default:
      return null // absence handled by caller; unknown kinds skip
  }
}

/**
 * Pure: build the render prompt from a payload. Returns { skip: true } for absence / kinds
 * with nothing grounded to say, else { prompt }.
 */
export function buildNarrativePrompt(payload) {
  if (!payload || payload.kind === 'absence') return { skip: true } // absence is gated — never rendered
  const facts = groundedFacts(payload)
  if (!facts || !facts.lines.length) return { skip: true }

  const factBlock = facts.lines.map((f) => `- ${f}`).join('\n')

  const prompt = `You are a specific place in the Magora ecological network, speaking quietly, in your own plain first-person voice, about what you have been noticing. You are the place itself, not a person and not a field guide.

WHAT I HAVE NOTICED (these are the ONLY facts you may use):
${factBlock}
${facts.isGap ? '\nThis is something I am WONDERING about, not something I know the cause of. Frame any possible connection as open wonder, never as an established fact, and do not invent a reason.' : ''}

Write 1 to 3 short sentences in my own voice. Rules:
- Use ONLY the facts above. Never introduce a species, place, relationship, or cause that is not stated above.
- Do not claim to know WHY unless the facts say so. Wonder, do not assert.
- Speak as the place, about the place. No people, no names, no field-guide tone, no alarm.
- Plain prose, commas and periods, never em-dashes.
- End on EXACTLY ONE question. The last sentence MUST be a direct question addressed to the reader and MUST end with a question mark. Do not end on a statement, and put nothing after the question.`

  return { prompt }
}

// Grounded fallback question, built ONLY from payload facts. Used to guarantee the
// "ends on one question" contract when the model returns a wondering statement with no
// question mark. Never introduces a fact not already in the payload.
export function fallbackQuestion(payload) {
  const subj = payload.subject || {}
  const species = Array.isArray(subj.species) && subj.species.length ? subj.species[0] : null
  switch (payload.kind) {
    case 'novel_detection':
      return species ? `Have you noticed ${species} here?` : `Have you noticed it here?`
    case 'activity_spike':
      return `Is something drawing them in right now?`
    case 'soundscape_shift':
      return `What has shifted here?`
    case 'survey_gap_question': {
      const qf = (payload.survey_gap?.question_focus || '').trim()
      if (qf.endsWith('?')) {
        const i = qf.lastIndexOf('. ') // keep just the trailing question if there's lead-in prose
        return i >= 0 ? qf.slice(i + 2) : qf
      }
      return `Can you help fill this in?`
    }
    default:
      return `Is it worth a closer look?`
  }
}

/**
 * Pure: guarantee the text ends on exactly one question. Drops any prose after the final
 * '?', and collapses any earlier '?' into '.' so only the closing question remains.
 */
export function enforceSingleQuestion(text) {
  let t = String(text || '').trim()
  const last = t.lastIndexOf('?')
  if (last === -1) return t // no question — prompt should prevent this; leave as-is
  t = t.slice(0, last + 1).trim()
  if (t.length > 1) t = t.slice(0, -1).replace(/\?/g, '.') + '?'
  return t
}

/**
 * Render a payload into node-voice prose ending on one question.
 * @param {object} payload  a PulsePayload (Pulse-Agent-Spec §5a)
 * @param {"node"} [voice]
 * @returns {Promise<{ text: string, voice: string } | { error: string } | null>}
 *   null when there is nothing to render (absence / no grounded facts).
 */
export async function narrate(payload, voice = 'node') {
  const built = buildNarrativePrompt(payload)
  if (built.skip) return null
  const out = await generateInsight(built.prompt, INSIGHT_MODEL) // Haiku; strips em-dashes + honors the grounded/no-editorializing guards
  if (out.error) return { error: out.error }
  let text = enforceSingleQuestion(out.text)
  // Guarantee the contract: if the model ended on a statement (no '?'), append a
  // payload-grounded question so it always ends on exactly one question.
  if (!text.trim().endsWith('?')) text = enforceSingleQuestion(`${text} ${fallbackQuestion(payload)}`)
  return { text, voice }
}
