// Narrative Agent v1.1 — voice roster unit tests (pure; no network).
// Run: node api/_narrative/voices.test.mjs
//
// Covers the roster shape + the load-bearing invariant that a voice is a thin STYLE layer
// over voice-independent grounded facts: same facts across every voice, only register varies.
// Underscore-prefixed dir => not a Vercel route; .mjs => outside the eslint js/jsx glob.

import { getVoice, listVoices, VOICES_VERSION, DEFAULT_VOICE } from './voices.js'
import { buildNarrativePrompt, narrate, enforceSingleQuestion, fallbackQuestion } from './narrate.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

// ── voices registry ──────────────────────────────────────────────────────────
const ids = listVoices().map((v) => v.id)
ok('four voices', ids.length === 4)
ok('exact roster', JSON.stringify(ids) === JSON.stringify(['node', 'attenborough', 'comedy', 'data_scientist']))
ok('node first (default)', ids[0] === 'node' && DEFAULT_VOICE === 'node')
ok('version v1.1', VOICES_VERSION === 'v1.1')
ok('getVoice(node) ok', getVoice('node')?.id === 'node')
ok('getVoice(elder) -> null (gated, not addable)', getVoice('elder') === null)
ok('getVoice(bogus) -> null', getVoice('bogus') === null)
ok('getVoice(non-string) -> null', getVoice(42) === null && getVoice(null) === null)
const iek = /elder|iek|indigenous|ancestral|traditional\s*knowledge/i
ok('no IEK-style entry', !listVoices().some((v) => iek.test(v.id) || iek.test(v.label)))
ok('directives are style-only (no digits/species)', listVoices().every((v) => !/\d/.test(v.styleDirectives)))

// ── sample payloads (one per renderable kind) ─────────────────────────────────
const novel = { kind: 'novel_detection', subject: { species: ["Steller's Jay"] }, evidence: { first_seen: '2026-07-08', conservation_status: 'NT' }, generated_at: '2026-07-08T00:00:00Z' }
const spike = { kind: 'activity_spike', subject: { metric: 'detection_rate' }, evidence: { ratio: 2.3 } }
const shift = { kind: 'soundscape_shift', subject: { metric: 'aci' }, evidence: { direction: 'down', delta: 0.12 } }
const gap = { kind: 'survey_gap_question', subject: {}, survey_gap: { question_focus: 'Is there water nearby?', relationship_rationale: 'SECRET_RATIONALE_MUST_NOT_APPEAR' } }
const absence = { kind: 'absence', subject: {} }

// ── 3-segment assembly, per voice × per kind ──────────────────────────────────
for (const payload of [novel, spike, shift, gap]) {
  const scaffolds = new Set()
  const voiceSegs = new Set()
  for (const vid of ids) {
    const cfg = getVoice(vid)
    const built = buildNarrativePrompt(payload, cfg)
    ok(`${payload.kind}/${vid}: builds`, !!built.prompt && !!built.segments)
    const { scaffold, voice, invariants } = built.segments
    const iS = built.prompt.indexOf(scaffold), iV = built.prompt.indexOf(voice), iI = built.prompt.indexOf(invariants)
    ok(`${payload.kind}/${vid}: 3 segments in order`, iS >= 0 && iV > iS && iI > iV)
    ok(`${payload.kind}/${vid}: voice seg = its directives`, voice.includes(cfg.styleDirectives))
    ok(`${payload.kind}/${vid}: invariants have single-? rule`, /EXACTLY ONE question/.test(invariants))
    ok(`${payload.kind}/${vid}: invariants forbid new facts`, /ONLY the facts above/.test(invariants))
    ok(`${payload.kind}/${vid}: no cold_start`, !/cold_start/.test(built.prompt))
    scaffolds.add(scaffold); voiceSegs.add(voice)
  }
  ok(`${payload.kind}: scaffold identical across voices`, scaffolds.size === 1)
  ok(`${payload.kind}: voice directives differ across voices`, voiceSegs.size === 4)
}

// ── NUMBERS ARE FACTS: figures single-sourced in the scaffold, no per-voice re-rounding ──
// Parallel to "scaffold identical across voices", but focused on numeric fidelity: the
// canonical figure is embedded once and byte-identical across all four voices, and the
// invariant forbids re-rounding/word-form drift (the 2.618× -> "two and a half" leak).
const spikeExact = { kind: 'activity_spike', subject: { metric: 'detection_rate' }, evidence: { ratio: 2.618 } }
const figScaffolds = new Set()
for (const vid of ids) {
  const built = buildNarrativePrompt(spikeExact, getVoice(vid))
  const s = built.segments.scaffold
  ok(`num/${vid}: canonical "2.6×" present`, s.includes('2.6×'))
  ok(`num/${vid}: over-precise "2.618" absent`, !s.includes('2.618'))
  ok(`num/${vid}: no "roughly" hedge`, !/roughly/i.test(s))
  ok(`num/${vid}: no word-form drift ("two and a half")`, !/two and a half/i.test(s))
  ok(`num/${vid}: invariant forbids re-rounding`, /Do not round, rescale, approximate/i.test(built.segments.invariants))
  figScaffolds.add(s)
}
ok('num: canonical figure byte-identical across all four voices', figScaffolds.size === 1)
// delta figure canonicalized to a single form too (2dp), not raw over-precision
const shiftPrecise = { kind: 'soundscape_shift', subject: {}, evidence: { direction: 'down', delta: 0.1234 } }
const deltaScaffold = buildNarrativePrompt(shiftPrecise, getVoice('node')).segments.scaffold
ok('num: delta canonicalized to 2dp ("0.12")', deltaScaffold.includes('0.12') && !deltaScaffold.includes('0.1234'))

// ── survey_gap: relationship_rationale NEVER asserted / never leaks into prompt ─
for (const vid of ids) {
  const built = buildNarrativePrompt(gap, getVoice(vid))
  ok(`gap/${vid}: rationale not leaked`, !built.prompt.includes('SECRET_RATIONALE_MUST_NOT_APPEAR'))
  ok(`gap/${vid}: framed as wondering`, /WONDERING/.test(built.prompt) && /open wonder/i.test(built.prompt))
  ok(`gap/${vid}: relationship-as-fact forbidden`, /never present a possible relationship/i.test(built.prompt))
}

// ── absence is gated: skip everywhere ─────────────────────────────────────────
for (const vid of ids) ok(`absence/${vid}: skipped`, buildNarrativePrompt(absence, getVoice(vid)).skip === true)
ok('narrate(absence) -> null', (await narrate(absence, 'node')) === null)

// ── unknown / elder voices HARD-REJECT (no network, no fallback) ──────────────
ok('narrate(elder) -> error', (await narrate(novel, 'elder'))?.error?.includes('elder'))
ok('narrate(bogus) -> error', !!(await narrate(novel, 'bogus'))?.error)

// ── single-question enforcement + grounded fallback (voice-independent) ────────
ok('enforceSingleQuestion collapses earlier ?', enforceSingleQuestion('Is it? Maybe. Right?') === 'Is it. Maybe. Right?')
ok('enforceSingleQuestion drops trailing prose', enforceSingleQuestion('Here? extra prose') === 'Here?')
ok('fallback grounded to species', fallbackQuestion(novel).includes("Steller's Jay"))
ok('fallback never invents (spike)', fallbackQuestion(spike).endsWith('?'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
