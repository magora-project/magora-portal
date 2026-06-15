import { useEffect, useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { parseNodeLocation } from '../lib/geo'
import DetectionCard, { toMountainTime } from '../components/DetectionCard'
import EcologicalPipeline from '../components/EcologicalPipeline'
import EcologicalCommons from '../components/EcologicalCommons'

function MapController({ nodes }) {
  const map = useMap()
  useEffect(() => {
    if (nodes.length === 0) return
    if (nodes.length === 1) {
      map.setView([nodes[0].coords.lat, nodes[0].coords.lon], 11)
    } else {
      map.fitBounds(nodes.map(n => [n.coords.lat, n.coords.lon]), { padding: [30, 30] })
    }
  }, [nodes, map])
  return null
}

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

function WaveformSVG() {
  return (
    <svg
      viewBox="0 0 1200 200"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <path d="M0,40 C100,20 200,60 300,40 C400,20 500,60 600,40 C700,20 800,60 900,40 C1000,20 1100,60 1200,40"
        stroke="#1a1a1a" strokeWidth="1.5" fill="none" opacity="0.05"/>
      <path d="M0,80 C100,52 200,108 300,80 C400,52 500,108 600,80 C700,52 800,108 900,80 C1000,52 1100,108 1200,80"
        stroke="#1a1a1a" strokeWidth="1.5" fill="none" opacity="0.07"/>
      <path d="M0,120 C100,90 200,150 300,120 C400,90 500,150 600,120 C700,90 800,150 900,120 C1000,90 1100,150 1200,120"
        stroke="#1a1a1a" strokeWidth="1.5" fill="none" opacity="0.05"/>
      <path d="M0,160 C100,135 200,185 300,160 C400,135 500,185 600,160 C700,135 800,185 900,160 C1000,135 1100,185 1200,160"
        stroke="#1a1a1a" strokeWidth="1.5" fill="none" opacity="0.04"/>
    </svg>
  )
}

export default function MapPage() {
  const navigate = useNavigate()
  const mapSectionRef = useRef(null)
  const [aciLogs, setAciLogs] = useState([])
  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [wikiData, setWikiData] = useState({})
  const [insights, setInsights] = useState({})
  const [todaySpeciesCount, setTodaySpeciesCount] = useState(null)
  const fetchedWiki = useRef(new Set())

  async function fetchData() {
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [{ data: nodeData }, { data: detectionData }, { data: aciData }, { data: todayData }] = await Promise.all([
      supabase.from('nodes').select('*').eq('is_active', true),
      supabase.from('detections')
        .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
        .order('detected_at', { ascending: false }).limit(50),
      supabase.from('aci_logs').select('*').order('recorded_at', { ascending: false }).limit(10),
      supabase.from('detections').select('species_name').gte('detected_at', todayStart.toISOString()),
    ])

    setNodes(nodeData || [])
    setDetections(detectionData || [])
    setAciLogs(aciData || [])
    setTodaySpeciesCount(new Set((todayData || []).map(d => d.species_name).filter(Boolean)).size)
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const uniqueSpecies = [...new Set(detections.map(d => d.species_name).filter(Boolean))]
    uniqueSpecies.forEach(name => {
      if (fetchedWiki.current.has(name)) return
      fetchedWiki.current.add(name)
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(data => {
          setWikiData(prev => ({
            ...prev,
            [name]: {
              img: data.thumbnail?.source || null,
              fact: data.extract ? data.extract.split('.')[0] + '.' : null,
              loaded: true,
            }
          }))
        })
        .catch(() => {
          setWikiData(prev => ({ ...prev, [name]: { img: null, fact: null, loaded: true } }))
        })
    })
  }, [detections])

  async function requestInsight(d) {
    setInsights(prev => ({ ...prev, [d.id]: { loading: true } }))
    try {
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detection_id:    d.id,
          species_name:    d.species_name || d.raw_label,
          scientific_name: d.raw_label?.split('_')[1] || '',
          confidence:      d.confidence,
          location:        nodes[0]?.habitat_type || 'montane scrub, Wyoming',
          is_dawn_chorus:  d.is_dawn_chorus,
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

  const mappableNodes = nodes
    .map(n => ({ ...n, coords: parseNodeLocation(n.location) }))
    .filter(n => n.coords)

  function isRecentNode(node) {
    if (!node.last_seen) return false
    return (Date.now() - new Date(node.last_seen).getTime()) / 60000 <= 5
  }

  const latestAci = aciLogs[0]?.aci_score

  return (
    <div>

      {/* Section 1 — Hero */}
      <section
        className="section-full-bleed"
        style={{ background: '#f0ebe0', padding: '80px 20px 96px', position: 'relative', overflow: 'hidden' }}
      >
        <WaveformSVG />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '680px' }}>
          <h1 style={{
            fontFamily: "'Big Shoulders Display', sans-serif",
            fontWeight: 900,
            fontSize: 'clamp(2.5rem, 6vw, 5rem)',
            color: '#1a1a1a',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            marginBottom: '20px',
          }}>
            Every place is speaking.
          </h1>
          <p style={{
            fontSize: 'clamp(0.95rem, 1.8vw, 1.1rem)',
            color: '#3a3530',
            lineHeight: 1.7,
            marginBottom: '36px',
            maxWidth: '540px',
          }}>
            Magora is an open-source ecological intelligence platform where low-cost monitoring nodes transform soundscapes into shared biodiversity knowledge.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '14px 28px',
                background: '#1a1a1a',
                color: '#f0ebe0',
                border: 'none',
                borderRadius: '3px',
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontSize: '1rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Explore the network
            </button>
            <Link
              to="/register"
              style={{
                padding: '12px 28px',
                background: 'transparent',
                color: '#1a1a1a',
                border: '2px solid #1a1a1a',
                borderRadius: '3px',
                textDecoration: 'none',
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontSize: '1rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Add a node
            </Link>
          </div>
        </div>
      </section>

      {/* Section 2 — Heartbeat Strip */}
      <section
        className="section-full-bleed"
        style={{
          background: '#e8e2d5',
          borderTop: '1px solid #ccc7b8',
          borderBottom: '1px solid #ccc7b8',
          padding: '22px 20px',
        }}
      >
        <div style={{ display: 'flex', gap: '0', flexWrap: 'wrap', alignItems: 'center', maxWidth: '900px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingRight: '32px' }}>
            <span className="heartbeat-dot" />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#7a7060', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>
                Listening posts active
              </div>
              <div style={{ fontSize: '24px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1, fontFamily: "'Big Shoulders Display', sans-serif" }}>
                {nodes.length > 0 ? nodes.length : '—'}
              </div>
            </div>
          </div>

          <div style={{ width: '1px', height: '40px', background: '#ccc7b8', flexShrink: 0, marginRight: '32px' }} />

          <div style={{ paddingRight: '32px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#7a7060', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>
              Species recorded today
            </div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1, fontFamily: "'Big Shoulders Display', sans-serif" }}>
              {todaySpeciesCount ?? '—'}
            </div>
          </div>

          <div style={{ width: '1px', height: '40px', background: '#ccc7b8', flexShrink: 0, marginRight: '32px' }} />

          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#7a7060', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>
              Current soundscape health
            </div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1, fontFamily: "'Big Shoulders Display', sans-serif" }}>
              {latestAci != null ? latestAci.toFixed(2) : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3 — The Ecological Record, Live */}
      <div ref={mapSectionRef}>

        {/* Map */}
        <div style={{ marginBottom: '16px', marginLeft: '-20px', marginRight: '-20px', marginTop: '32px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '20px' }}>
            Recorded by — tap a listening post to view its profile
          </div>
          <div style={{ overflow: 'hidden', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
            <MapContainer center={[39.5, -105.5]} zoom={5} style={{ height: '230px', width: '100%' }} zoomControl={true}>
              <MapController nodes={mappableNodes} />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution="© OpenStreetMap © CARTO"
              />
              {mappableNodes.map(node => (
                <CircleMarker
                  key={node.id}
                  center={[node.coords.lat, node.coords.lon]}
                  radius={10}
                  pathOptions={{ fillColor: '#1D9E75', color: '#0F6E56', weight: 2, fillOpacity: 0.85 }}
                  className={isRecentNode(node) ? 'node-pulse' : ''}
                  eventHandlers={{ click: () => navigate(`/node/${node.id}`) }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                    <strong style={{ fontSize: '14px' }}>{node.name}</strong><br />
                    <span style={{ fontSize: '12px', color: '#555' }}>
                      {node.habitat_type}{node.elevation_m ? ` · ${node.elevation_m}m` : ''} · tap to view
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Detection feed */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ marginBottom: '14px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Ecological record — live</span>
            <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live from Supabase</span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Loading...</div>
          ) : detections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Nothing recorded in this window</div>
          ) : (
            <div className="detection-grid">
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

        {/* ACI feed */}
        <div style={{ marginBottom: '56px' }}>
          <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Soundscape activity</span>
            <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Refreshes every 30s</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {aciLogs.map(log => {
              const level = log.aci_score > 0.65 ? 'High' : log.aci_score > 0.50 ? 'Moderate' : 'Low'
              return (
                <div key={log.id} style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: '16px', padding: '14px 18px',
                  display: 'flex', alignItems: 'center', gap: '14px',
                }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0, border: `1px solid ${C.border}` }}>🦟</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{level} insect activity</div>
                    <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>
                      {toMountainTime(log.recorded_at)} · {log.time_category} · ACI {log.aci_score}
                    </div>
                  </div>
                  <div style={{ width: '80px', flexShrink: 0 }}>
                    <div style={{ height: '6px', background: C.bg, borderRadius: '3px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                      <div style={{ width: `${log.aci_score * 100}%`, height: '100%', background: C.accent, borderRadius: '3px' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>

      {/* Section 4 — Ecological Pipeline */}
      <EcologicalPipeline />

      {/* Section 5 — Ecological Commons */}
      <EcologicalCommons />

    </div>
  )
}
