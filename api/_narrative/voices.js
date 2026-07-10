// Narrative Agent v1.1 — voice roster.
//
// A tiny registry of reader-selectable voices. Every voice renders the SAME canonical
// PulsePayload on the SAME on-demand NodePage "Pulse" panel; only the register/tone varies,
// never the facts (Pulse decides WHAT is worth saying; the voice decides only HOW). A voice's
// `styleDirectives` is prose-STYLE guidance ONLY — tone, register, framing verbs. It must
// carry no ecological facts, no species, no place content, no example claims: those come
// solely from the payload-grounded scaffold in narrate.js.
//
// IEK / Elder voice is DELIBERATELY ABSENT and not addable here. It is gated on the IEK
// consent model, not a render config — `getVoice('elder')` resolves to "not available" like
// any other unknown id (see the test asserting no IEK-style entry exists).

export const VOICES_VERSION = 'v1.1'

// Model selector token per voice (resolved to a concrete model id in narrate.js). All four
// render on Haiku, matching the v1 narrative path (INSIGHT_MODEL).
const VOICES = Object.freeze({
  node: {
    id: 'node',
    label: 'This place',
    // The v1 behavior verbatim: plain, quiet, first-person place voice.
    styleDirectives:
      'Speak quietly, in your own plain, unadorned first-person voice, as the place itself. ' +
      'No flourish, no performance. Simple sentences.',
    model: 'haiku',
    enabled: true,
  },
  attenborough: {
    id: 'attenborough',
    label: 'Naturalist',
    styleDirectives:
      'Speak in a measured, naturalist-documentary register: unhurried, warmly observational, ' +
      'attentive to the small and ordinary, with a quiet sense of wonder. Still first-person as ' +
      'the place. Calm cadence, no melodrama.',
    model: 'haiku',
    enabled: true,
  },
  comedy: {
    id: 'comedy',
    label: 'Wry',
    styleDirectives:
      'Speak in a light, wry, good-humored register: a touch of dry wit, gentle self-aware ' +
      'understatement. Still first-person as the place, still sincere underneath. Never mocking, ' +
      'never slapstick, never at any creature’s expense.',
    model: 'haiku',
    enabled: true,
  },
  data_scientist: {
    id: 'data_scientist',
    label: 'Analyst',
    styleDirectives:
      'Speak in a precise, quantitative register: crisp, measured, matter-of-fact, comfortable ' +
      'naming the figures the facts already provide. Still first-person as the place. No jargon ' +
      'for its own sake, no coldness, no invented statistics.',
    model: 'haiku',
    enabled: true,
  },
})

/**
 * Resolve a voice id to its config. Returns null for any unknown / unregistered / disabled
 * id (including 'elder', which is intentionally not a member) — callers HARD-REJECT on null,
 * they do not silently fall back to `node`.
 * @param {string} id
 * @returns {Readonly<{id:string,label:string,styleDirectives:string,model:string,enabled:boolean}>|null}
 */
export function getVoice(id) {
  if (typeof id !== 'string') return null
  const v = VOICES[id]
  return v && v.enabled ? v : null
}

/** All registered, enabled voices (for the UI selector). Ordered: node first. */
export function listVoices() {
  return Object.values(VOICES).filter((v) => v.enabled)
}

export const DEFAULT_VOICE = 'node'
