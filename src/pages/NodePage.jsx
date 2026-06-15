import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseNodeLocation } from '../lib/geo'
import DetectionCard, { toMountainTime } from '../components/DetectionCard'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const HABITAT_EMOJI = {
  'montane-scrub': '🌿', forest: '🌲', grassland: '🌾',
  wetland: '💧', desert: '🏜️', 'urban-garden': '🏙️',
  farmland: '🌻', coastal: '🌊', other: '📍',
}

const HARDWARE_LABEL = {
  'rpi-zero-2w': 'Raspberry Pi Zero 2W',
  'rpi-4': 'Raspberry Pi 4',
  'rpi-3b': 'Raspberry Pi 3B+',
  other: 'Custom device',
}

function AciSparkline({ logs }) {
  if (!logs.length) return null
  const reversed = [...logs].reverse()
  const max = Math.max(...logs.map(l => l.aci_score), 0.01)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '52px' }}>
      {reversed.map((log, i) => {
        const pct = (log.aci_score / max) * 100
        const color = log.aci_score > 0.65 ? C.accent : log.aci_score > 0.50 ? C.accentLight : C.border
        return (
          <div
            key={log.id || i}
            title={`ACI ${log.aci_score} · ${log.time_category} · ${toMountainTime(log.recorded_at, false)}`}
            style={{
              flex: 1, height: `${Math.max(pct, 6)}%`,
              background: color, borderRadius: '2px 2px 0 0', minWidth: '4px',
            }}
          />
        )
      })}
    </div>
  )
}

export default function NodePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [node, setNode] = useState(null)
  const [detections, setDetections] = useState([])
  const [aciLogs, setAciLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [wikiData, setWikiData] = useState({})
  const [insights, setInsights] = useState({})
  const fetchedWiki = useRef(new Set())

  async function fetchData() {
    const [{ data: nodeData }, { data: dData }, { data: aciData }] = await Promise.all([
      supabase.from('nodes').select('*').eq('id', id).single(),
      supabase.from('detections')
        .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
        .eq('node_id', id)
        .order('detected_at', { ascending: false })
        .limit(30),
      supabase.from('aci_logs')
        .select('*')
        .eq('node_id', id)
        .order('recorded_at', { ascending: false })
        .limit(24),
    ])
    setNode(nodeData)
    setDetections(dData || [])
    setAciLogs(aciData || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    const uniqueSpecies = [...new Set(detections.map(d => d.species_name).filter(Boolean))]
    uniqueSpecies.forEach(name => {
      if (fetchedWiki.current.has(name)) return
      fetchedWiki.current.add(name)
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(data => setWikiData(prev => ({
          ...prev,
          [name]: { img: data.thumbnail?.source || null, fact: data.extract ? data.extract.split('.')[0] + '.' : null, loaded: true },
        })))
        .catch(() => setWikiData(prev => ({ ...prev, [name]: { img: null, fact: null, loaded: true } })))
    })
  }, [detections])

  async function requestInsight(d) {
    setInsights(prev => ({ ...prev, [d.id]: { loading: true } }))
    try {
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detection_id: d.id, species_name: d.species_name || d.raw_label,
          scientific_name: d.raw_label?.split('_')[1] || '',
          confidence: d.confidence, location: node?.habitat_type || '',
          is_dawn_chorus: d.is_dawn_chorus,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsights(prev => ({ ...prev, [d.id]: { text: data.insight } }))
    } catch {
      setInsights(prev => ({ ...prev, [d.id]: { error: true } }))
    }
  }

  const speciesCount = detections.reduce((acc, d) => {
    const name = d.species_name || d.raw_label
    if (name) acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const dedupedDetections = detections.filter((d, idx) => {
    const name = d.species_name || d.raw_label
    return detections.findIndex(x => (x.species_name || x.raw_label) === name) === idx
  })

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>
        Loading listening post...
      </div>
    )
  }

  if (!node) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>
        Listening post not found.{' '}
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: C.accentLight, cursor: 'pointer', fontSize: '14px' }}>
          Back to network
        </button>
      </div>
    )
  }

  const coords = parseNodeLocation(node.location)
  const latestAci = aciLogs[0]?.aci_score
  const aciLevel = latestAci > 0.65 ? 'High' : latestAci > 0.50 ? 'Moderate' : 'Low'

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none', border: 'none', color: C.accentLight,
          cursor: 'pointer', fontSize: '14px', fontWeight: '600',
          padding: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        ← Back to network
      </button>

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <div style={{ fontSize: '26px', fontWeight: '800', color: C.text }}>{node.name}</div>
          <div style={{
            fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px',
            background: node.is_active ? '#0f3020' : '#1a1a1a',
            border: `1px solid ${node.is_active ? C.accent : C.border}`,
            color: node.is_active ? C.accentLight : C.textMuted,
          }}>
            {node.is_active ? '🟢 Recording' : '⚫ Offline'}
          </div>
        </div>
        <div style={{ fontSize: '13px', color: C.textMuted }}>
          {HARDWARE_LABEL[node.hardware_type] || node.hardware_type}
        </div>
      </div>

      {/* Info tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Habitat', value: `${HABITAT_EMOJI[node.habitat_type] || '📍'} ${node.habitat_type?.replace(/-/g, ' ')}` },
          { label: 'Elevation', value: node.elevation_m ? `⛰️ ${node.elevation_m} m` : '—' },
          { label: 'Coordinates', value: coords ? `${coords.lat.toFixed(4)}°, ${coords.lon.toFixed(4)}°` : '—' },
          { label: 'Soundscape health', value: latestAci != null ? `${aciLevel} · ${latestAci}` : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ACI sparkline */}
      {aciLogs.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>Soundscape health — last {aciLogs.length} readings</span>
            <span style={{ fontSize: '11px', color: C.textMuted }}>Hover bars for detail</span>
          </div>
          <AciSparkline logs={aciLogs} />
          <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
            {[['🟢', 'High (>0.65)'], ['🔵', 'Moderate (0.50–0.65)'], ['⬜', 'Low (<0.50)']].map(([dot, label]) => (
              <div key={label} style={{ fontSize: '11px', color: C.textMuted }}>{dot} {label}</div>
            ))}
          </div>
        </div>
      )}

      {/* Recent detections */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Ecological record</span>
          <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last 30 · refreshes 30s</span>
        </div>
        {dedupedDetections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted, background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px' }}>
            Nothing recorded at this listening post
          </div>
        ) : (
          <div style={{ borderRadius: '16px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {dedupedDetections.map(d => (
              <DetectionCard
                key={d.id} d={d} wikiData={wikiData}
                count={speciesCount[d.species_name || d.raw_label] || 1}
                insight={insights[d.id]} onRequestInsight={() => requestInsight(d)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Acoustic log */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Soundscape log</span>
          <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This node only</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {aciLogs.map(log => {
            const level = log.aci_score > 0.65 ? 'High' : log.aci_score > 0.50 ? 'Moderate' : 'Low'
            return (
              <div key={log.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: '12px', padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0, border: `1px solid ${C.border}` }}>🦟</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>{level} insect activity</div>
                  <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>
                    {toMountainTime(log.recorded_at)} · {log.time_category} · ACI {log.aci_score}
                  </div>
                </div>
                <div style={{ width: '70px', flexShrink: 0 }}>
                  <div style={{ height: '5px', background: C.bg, borderRadius: '3px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                    <div style={{ width: `${log.aci_score * 100}%`, height: '100%', background: C.accent, borderRadius: '3px' }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
