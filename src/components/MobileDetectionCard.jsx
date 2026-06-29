import { Link } from 'react-router-dom'
import { MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'
import { AMBER } from '../lib/listen'

const C = {
  card: '#163d22', border: '#1f5230',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

function relativeTime(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// A mobile "Listen" in the feed — visually distinct from node DetectionCards
// (amber 〰 instead of a node header, no precise location/identity).
export default function MobileDetectionCard({ d, insight, onRequestInsight }) {
  const species = (d.species || [])
    .filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
    .sort((a, b) => b.confidence - a.confidence)

  const tags = [
    d.habitat_type, d.canopy_cover && `${d.canopy_cover} canopy`,
    d.water_present ? 'water nearby' : null,
    d.disturbance_level && d.disturbance_level !== 'none' ? `${d.disturbance_level} disturbance` : null,
  ].filter(Boolean)

  const listenerHandle = d.listener_handle

  return (
    <div style={S.card}>
      <div style={S.header}>
        <span style={S.badge}>〰 Listen</span>
        <span style={{ color: C.textMuted, fontSize: '12px' }}>{relativeTime(d.detected_at)}</span>
      </div>

      <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px' }}>
        A field recording from someone in the network
      </div>
      {listenerHandle && (
        <div style={{ marginBottom: '10px', fontSize: '12px' }}>
          <Link to={`/journal/${listenerHandle}`} style={{ color: C.textSub, textDecoration: 'underline' }}>
            Listened by @{listenerHandle}
          </Link>
        </div>
      )}

      {species.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {species.map((s, i) => (
            <div key={i} style={S.row}>
              <Link to={`/species/${encodeURIComponent(s.common_name)}`} style={S.species}>
                {s.common_name}
                <span style={{ color: C.textMuted, fontStyle: 'italic', fontWeight: 400 }}> · {s.scientific_name}</span>
              </Link>
              <span style={{ color: AMBER.light, fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                {Math.round(s.confidence * 100)}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: C.textMuted, fontSize: '13px' }}>No confident bird ID in this clip.</div>
      )}

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
          {tags.map(t => <span key={t} style={S.tag}>{t}</span>)}
        </div>
      )}

      {/* Ecological insight — prefer the one stored with the post (covers all
          species + the listener's notes); fall back to on-demand for older posts. */}
      {(d.insight || insight?.text) && (
        <div style={{ fontSize: '13px', color: C.textSub, lineHeight: 1.6, borderLeft: `3px solid ${AMBER.base}`, paddingLeft: '12px', marginTop: '12px' }}>
          {d.insight || insight.text}
        </div>
      )}
      {onRequestInsight && species.length > 0 && !d.insight && !insight?.text && (
        <button onClick={onRequestInsight} disabled={insight?.loading} style={{
          width: '100%', marginTop: '12px', padding: '9px',
          background: insight?.loading ? C.border : 'transparent',
          border: `1px solid ${AMBER.dark}`, borderRadius: '8px',
          color: insight?.loading ? C.textMuted : AMBER.light,
          fontSize: '13px', fontWeight: 700, cursor: insight?.loading ? 'default' : 'pointer',
        }}>
          {insight?.loading ? '🔍 Reading the soundscape…' : insight?.error ? 'Try again' : "What's the ecosystem saying?"}
        </button>
      )}
    </div>
  )
}

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${AMBER.base}`, borderRadius: '12px', padding: '14px 16px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '5px', color: AMBER.ink, background: AMBER.base, padding: '3px 9px', borderRadius: '12px', fontSize: '12px', fontWeight: 800 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  species: { color: C.text, fontWeight: 700, fontSize: '14px', textDecoration: 'none' },
  tag: { fontSize: '11px', color: C.textSub, background: 'rgba(217,149,43,0.12)', border: `1px solid ${AMBER.dark}`, borderRadius: '12px', padding: '3px 9px', textTransform: 'capitalize' },
}
