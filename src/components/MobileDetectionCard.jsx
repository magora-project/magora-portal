import { memo, useState } from 'react'
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
//
// The "What's the ecosystem saying?" insight is an inline collapsible panel,
// collapsed by default. onGenerate asks the parent (useEcosystemInsight) to
// generate one for older Listens with no stored insight. Memoized + keyed by
// detection id so existing cards keep their expanded state across feed updates,
// while a full page refresh resets everything to collapsed.
function MobileDetectionCard({ d, insight, onGenerate }) {
  // Collapsed by default. Being local UI state (not derived from the row), it
  // resets to collapsed on a page refresh even for insights stored on the row.
  const [expanded, setExpanded] = useState(false)

  const species = (d.species || [])
    .filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
    .sort((a, b) => b.confidence - a.confidence)

  const insightText = d.insight || insight?.text

  function toggleInsight() {
    const next = !expanded
    setExpanded(next)
    // Generate on first expand only for older Listens with no stored insight.
    if (next && !insightText && !insight?.loading) onGenerate?.()
  }

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

      {/* Ecosystem insight — collapsible, collapsed by default. Stored insights
          (d.insight) and on-demand ones alike live behind this toggle. */}
      {species.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <button onClick={toggleInsight} aria-expanded={expanded} style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 12px', background: 'transparent', border: `1px solid ${AMBER.dark}`,
            borderRadius: '8px', color: AMBER.light, fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          }}>
            <span>What&apos;s the ecosystem saying?</span>
            <span aria-hidden="true" style={{ fontSize: '10px', opacity: 0.8 }}>{expanded ? '▲' : '▼'}</span>
          </button>
          {expanded && (
            <div style={{ marginTop: '10px', borderLeft: `3px solid ${AMBER.base}`, paddingLeft: '12px' }}>
              {insightText ? (
                <div style={{ fontSize: '13px', color: C.textSub, lineHeight: 1.6 }}>{insightText}</div>
              ) : insight?.loading ? (
                <div style={{ fontSize: '13px', color: C.textMuted }}>🔍 Reading the soundscape…</div>
              ) : insight?.error ? (
                <div style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.6 }}>
                  Couldn&apos;t read the soundscape just now.
                  <button onClick={onGenerate} style={{
                    display: 'block', marginTop: '10px', padding: '8px 12px', background: 'transparent',
                    border: `1px solid ${AMBER.dark}`, borderRadius: '8px', color: AMBER.light,
                    fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  }}>
                    Try again
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(MobileDetectionCard)

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${AMBER.base}`, borderRadius: '12px', padding: '14px 16px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '5px', color: AMBER.ink, background: AMBER.base, padding: '3px 9px', borderRadius: '12px', fontSize: '12px', fontWeight: 800 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  species: { color: C.text, fontWeight: 700, fontSize: '14px', textDecoration: 'none' },
  tag: { fontSize: '11px', color: C.textSub, background: 'rgba(217,149,43,0.12)', border: `1px solid ${AMBER.dark}`, borderRadius: '12px', padding: '3px 9px', textTransform: 'capitalize' },
}
