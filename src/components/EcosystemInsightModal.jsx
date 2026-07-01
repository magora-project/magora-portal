import { createPortal } from 'react-dom'
import { AMBER } from '../lib/listen'

const C = { card: '#163d22', border: '#1f5230', textSub: '#c8e6d0', textMuted: '#7aad8a' }

// The "What's the ecosystem saying?" modal for a mobile Listen. Portaled to
// <body> so a feed re-render can't collapse it. Driven by useEcosystemInsight:
// pass its openInsight / insights / closeInsight / requestInsight straight through.
export default function EcosystemInsightModal({ openInsight, insights, onClose, onRetry }) {
  if (!openInsight) return null
  const st = insights[openInsight.id] || {}
  const text = openInsight.insight || st.text

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,20,12,0.72)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${AMBER.base}`, borderRadius: '14px', maxWidth: '440px', width: '100%', maxHeight: '80vh', overflowY: 'auto', padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: AMBER.light, fontWeight: 800, fontSize: '15px' }}>
            〰 What&apos;s the ecosystem saying?
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: '22px', lineHeight: 1, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>
        {text ? (
          <div style={{ fontSize: '14px', color: C.textSub, lineHeight: 1.7 }}>{text}</div>
        ) : st.error ? (
          <div style={{ color: C.textMuted, fontSize: '14px', lineHeight: 1.6 }}>
            Couldn&apos;t read the soundscape just now.
            <button
              onClick={() => onRetry(openInsight)}
              style={{ display: 'block', marginTop: '12px', padding: '9px 14px', background: 'transparent', border: `1px solid ${AMBER.dark}`, borderRadius: '8px', color: AMBER.light, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        ) : (
          <div style={{ color: C.textMuted, fontSize: '14px' }}>🔍 Reading the soundscape…</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
