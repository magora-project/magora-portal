import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'
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
  const [speciesNames, setSpeciesNames] = useState([])
  const [following, setFollowing] = useState(false)
  const [shareState, setShareState] = useState(null) // null | 'copied' | 'error'
  const fetchedWiki = useRef(new Set())

  async function fetchData() {
    const [{ data: nodeData }, { data: dData }, { data: aciData }] = await Promise.all([
      supabase.from('nodes').select('*').eq('id', id).single(),
      supabase.from('detections')
        .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
        .eq('node_id', id)
        .gte('confidence', MIN_CONFIDENCE)
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

  // All-time species names for the place's profile stats (lightweight — one column, fetched once per node)
  useEffect(() => {
    supabase.from('detections').select('species_name').eq('node_id', id).gte('confidence', MIN_CONFIDENCE).limit(5000)
      .then(({ data }) => setSpeciesNames((data || []).map(d => d.species_name)))
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
    const name = d.species_name || d.raw_label || ''
    if (isHiddenSpecies(name)) return false
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

  // ── Place-profile derived values (use real columns if present, fall back gracefully) ──
  const habitat = node.habitat_type?.replace(/-/g, ' ')
  const habitatEmoji = HABITAT_EMOJI[node.habitat_type] || '📍'

  const region = node.region
    || (coords
      ? `${Math.abs(coords.lat).toFixed(1)}°${coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(coords.lon).toFixed(1)}°${coords.lon >= 0 ? 'W' : 'E'}`
      : habitat || 'Unmapped')
  const stewardHandle = node.steward_handle || node.steward || null
  const bannerImg = node.profile_image_url || node.image_url || node.banner_url || null
  const recording = !!node.is_active

  // All-time species stats (hidden sounds, insects/human/dogs, excluded)
  const speciesStats = speciesNames.reduce((acc, name) => {
    if (isHiddenSpecies(name)) return acc
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const rankedSpecies = Object.entries(speciesStats).sort((a, b) => b[1] - a[1])
  const totalSpecies = rankedSpecies.length
  const topSpecies = rankedSpecies.slice(0, 5)

  const listeningSince = node.created_at
    ? new Date(node.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  const bio = node.bio || node.description ||
    `${node.name} listens continuously over ${habitat || 'this landscape'}${node.elevation_m ? ` at ${node.elevation_m} m` : ''}. Every bird and insect that calls here adds to a long-running record of what lives in this place, and what is changing.`

  async function handleShareProfile() {
    const url = window.location.href
    const text = `${node.name}, a ${habitat || 'wild'} soundscape${totalSpecies ? `, ${totalSpecies} species recorded` : ''}.\n\nEvery place is speaking.\n${url}`
    if (navigator.share) {
      try { await navigator.share({ title: `${node.name} · Magora`, text }) } catch { /* dismissed */ }
      return
    }
    try { await navigator.clipboard.writeText(text); setShareState('copied') }
    catch { setShareState('error') }
    setTimeout(() => setShareState(null), 2000)
  }

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px 18px' }
  const cardLabel = { fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }

  return (
    <div>
      {/* Breadcrumb: Network → Region → Node */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.textMuted, marginBottom: '14px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: C.accentLight, cursor: 'pointer', fontSize: '12px', fontWeight: '600', padding: 0 }}>
          Network
        </button>
        <span>→</span>
        <span>{region}</span>
        <span>→</span>
        <span style={{ color: C.textSub, fontWeight: '600' }}>{node.name}</span>
      </div>

      {/* Profile banner — landscape image slot (placeholder for now) */}
      <div style={{
        position: 'relative', height: '160px', borderRadius: '16px', overflow: 'hidden',
        marginBottom: '16px', border: `1px solid ${C.border}`,
        background: bannerImg ? undefined : `linear-gradient(135deg, ${C.card}, ${C.bg})`,
      }}>
        {bannerImg
          ? <img src={bannerImg} alt={node.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '68px', opacity: 0.45 }}>{habitatEmoji}</div>
        }
        <div style={{
          position: 'absolute', top: '12px', right: '12px',
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '20px',
          background: 'rgba(13,40,24,0.82)', backdropFilter: 'blur(4px)',
          border: `1px solid ${recording ? C.accent : C.border}`,
          color: recording ? C.accentLight : C.textMuted,
        }}>
          {recording ? <><span className="heartbeat-dot" /> Currently recording</> : '⚫ Quiet right now'}
        </div>
      </div>

      {/* Identity */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '26px', fontWeight: '800', color: C.text, lineHeight: 1.1 }}>{node.name}</div>
        <div style={{ fontSize: '13px', color: C.textMuted, marginTop: '5px' }}>
          {habitatEmoji} {habitat}{node.elevation_m ? ` · ${node.elevation_m} m` : ''}
          {stewardHandle ? ` · stewarded by @${stewardHandle}` : ''}
        </div>
      </div>

      {/* Follow + Share */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button
          onClick={() => setFollowing(f => !f)}
          style={{
            flex: 1, padding: '11px', borderRadius: '10px', cursor: 'pointer',
            fontSize: '14px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif",
            background: following ? C.bg : C.accent,
            border: `1px solid ${following ? C.border : C.accent}`,
            color: following ? C.textSub : '#fff',
          }}
        >
          {following ? '✓ Following' : '+ Follow'}
        </button>
        <button
          onClick={handleShareProfile}
          aria-label="Share this place"
          title={shareState === 'error' ? 'Copy failed' : 'Share'}
          style={{
            flex: '0 0 auto', padding: '11px 14px', borderRadius: '10px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: shareState === 'copied' ? '#0f3020' : C.card,
            border: `1px solid ${shareState === 'copied' ? C.accent : C.border}`,
            color: shareState === 'copied' ? C.accentLight : C.textSub,
          }}
        >
          {shareState === 'copied' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          )}
        </button>
      </div>

      {/* Profile stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Species recorded', value: totalSpecies || '—' },
          { label: 'Soundscape health', value: latestAci != null ? latestAci.toFixed(2) : '—', sub: latestAci != null ? aciLevel : null },
          { label: 'Listening since', value: listeningSince || '—' },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ ...card, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: C.accentLight, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '3px' }}>{sub}</div>}
            <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '6px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Ecosystem bio */}
      <div style={{ ...card, marginBottom: '14px' }}>
        <div style={cardLabel}>About this place</div>
        <p style={{ fontSize: '14px', color: C.textSub, lineHeight: 1.7 }}>{bio}</p>
      </div>

      {/* Most recorded here */}
      {topSpecies.length > 0 && (
        <div style={{ ...card, marginBottom: '14px' }}>
          <div style={cardLabel}>Most recorded here</div>
          {topSpecies.map(([name, n], i) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: i < topSpecies.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.textMuted, width: '18px', flexShrink: 0 }}>{i + 1}</span>
              <Link to={`/species/${encodeURIComponent(name)}`} style={{ flex: 1, fontSize: '14px', fontWeight: '600', color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>{name}</Link>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>×{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Place details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Coordinates', value: coords ? `${coords.lat.toFixed(4)}°, ${coords.lon.toFixed(4)}°` : '—' },
          { label: 'Elevation', value: node.elevation_m ? `⛰️ ${node.elevation_m} m` : '—' },
          { label: 'Hardware', value: HARDWARE_LABEL[node.hardware_type] || node.hardware_type || '—' },
          { label: 'Deployed', value: listeningSince || '—' },
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
            <span style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>Soundscape health, last {aciLogs.length} readings</span>
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
          <div className="detection-grid">
            {dedupedDetections.map(d => (
              <DetectionCard
                key={d.id} d={d} node={node} wikiData={wikiData}
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
