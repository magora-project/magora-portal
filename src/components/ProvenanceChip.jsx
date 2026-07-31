import { PROVENANCE, BACKABLE } from '../lib/provenance'

// Provenance chip — renders one class from the shared provenance vocabulary (src/lib/provenance.js)
// beside a claim, so every surfaced statement in Magora can say where it came from.
//
// The chip fails CLOSED: a class that is defined but not yet backable by real data renders nothing
// at all. That is the guardrail, not decoration — it means a future surface cannot accidentally
// ship a correlation or community-observation claim before the substrate and consent model exist.

const C = {
  bg: '#0d2818', border: '#1f5230', accent: '#1D9E75', textMuted: '#7aad8a',
}

/**
 * @param {Object} p
 * @param {keyof typeof PROVENANCE} p.kind  provenance class for the claim this chip labels
 * @param {string} [p.note]  optional short qualifier appended after the label (e.g. a source name)
 */
export default function ProvenanceChip({ kind, note }) {
  const entry = PROVENANCE[kind]
  if (!entry) {
    console.warn(`ProvenanceChip: unknown provenance class '${kind}'`)
    return null
  }
  if (!BACKABLE.has(kind)) {
    console.warn(`ProvenanceChip: '${kind}' is defined but not backable yet — not rendering.`)
    return null
  }

  return (
    <span
      title={entry.title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: '999px',
        padding: '3px 9px', fontSize: '10px', fontWeight: '700',
        color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
        lineHeight: 1.4, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ color: C.accent, fontSize: '9px' }}>{entry.icon}</span>
      {entry.label}{note ? ` · ${note}` : ''}
    </span>
  )
}
