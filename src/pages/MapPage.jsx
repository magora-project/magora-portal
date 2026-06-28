import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'
import { useAuth } from '../lib/auth'
import { parseNodeLocation } from '../lib/geo'
import DetectionCard, { toMountainTime } from '../components/DetectionCard'
import EcologicalPipeline from '../components/EcologicalPipeline'
import EcologicalCommons from '../components/EcologicalCommons'
import ListenButton from '../components/ListenButton'
import MobileDetectionCard from '../components/MobileDetectionCard'
import { AMBER } from '../lib/listen'

function MapController({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 11)
    } else {
      map.fitBounds(points, { padding: [30, 30] })
    }
  }, [points, map])
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
  const [mobileDetections, setMobileDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [wikiData, setWikiData] = useState({})
  const [insights, setInsights] = useState({})
  const [todaySpeciesCount, setTodaySpeciesCount] = useState(null)
  const [todayDetections, setTodayDetections] = useState([])
  const fetchedWiki = useRef(new Set())
  const { user, openSignIn } = useAuth()
  const [tab, setTab] = useState('global')
  const [followedIds, setFollowedIds] = useState([])

  useEffect(() => {
    if (!user) { setFollowedIds([]); return }
    supabase.from('node_follows').select('node_id')
      .then(({ data }) => setFollowedIds((data || []).map(r => r.node_id)))
  }, [user])

  async function fetchData() {
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    try {
      const [nodesRes, detRes, aciRes, todayRes, mobileRes] = await Promise.all([
        supabase.from('nodes').select('*').eq('is_active', true),
        supabase.from('detections')
          .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
          .gte('confidence', MIN_CONFIDENCE)
          .order('detected_at', { ascending: false }).limit(50),
        supabase.from('aci_logs').select('*').order('recorded_at', { ascending: false }).limit(10),
        supabase.from('detections').select('species_name').gte('confidence', MIN_CONFIDENCE).gte('detected_at', todayStart.toISOString()),
        supabase.from('public_mobile_detections').select('*').order('detected_at', { ascending: false }).limit(50),
      ])

      // supabase-js resolves with { data, error } even on API failures — surface those too
      const firstErr = nodesRes.error || detRes.error || aciRes.error || todayRes.error
      if (firstErr) throw firstErr

      setNodes(nodesRes.data || [])
      setDetections(detRes.data || [])
      setMobileDetections(mobileRes.data || [])
      setAciLogs(aciRes.data || [])
      setTodayDetections(todayRes.data || [])
      setTodaySpeciesCount(new Set((todayRes.data || []).map(d => d.species_name).filter(n => n && !isHiddenSpecies(n))).size)
      setError(false)
    } catch (e) {
      console.warn('MapPage fetch failed:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
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
              ...prev[name],
              fact: data.extract ? data.extract.split('.')[0] + '.' : null,
              img: data.thumbnail?.source || null,
              loaded: true,
            }
          }))
        })
        .catch(() => {
          setWikiData(prev => ({ ...prev, [name]: { ...prev[name], fact: null, loaded: true } }))
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

  async function requestMobileInsight(m) {
    setInsights(prev => ({ ...prev, [m.id]: { loading: true } }))
    try {
      const conf = (m.species || []).filter(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile: true,
          detection_id: m.id,
          species: conf,
          lat: m.lat,
          lon: m.lon,
          detected_at: m.detected_at,
          habitat_type: m.habitat_type,
          canopy_cover: m.canopy_cover,
          water_present: m.water_present,
          disturbance_level: m.disturbance_level,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsights(prev => ({ ...prev, [m.id]: { text: data.insight } }))
    } catch {
      setInsights(prev => ({ ...prev, [m.id]: { error: true } }))
    }
  }

  const speciesCountToday = (todayDetections || []).reduce((acc, d) => {
    const name = d.species_name
    if (name) acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  // Following tab gates on the "empty room" problem: hidden until the network is
  // big enough to follow, or the signed-in user already follows something.
  const MIN_NODES_FOR_TABS = 4
  const showTabs = nodes.length >= MIN_NODES_FOR_TABS || (!!user && followedIds.length > 0)
  const activeTab = showTabs ? tab : 'global'
  const followedSet = new Set(followedIds)
  const baseDetections = activeTab === 'following'
    ? detections.filter(d => followedSet.has(d.node_id))
    : detections
  const dedupedDetections = baseDetections.filter((d, idx) => {
    const name = d.species_name || d.raw_label || ''
    if (isHiddenSpecies(name)) return false
    return baseDetections.findIndex(x => (x.species_name || x.raw_label) === name) === idx
  })

  // Mobile Listens with at least one confident, non-hidden ID (avoids empty cards).
  const mobileFeed = mobileDetections.filter(m =>
    (m.species || []).some(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name)))

  // Unified, time-sorted feed. Mobile Listens only show on Global (they don't
  // belong to a followed node).
  const feedItems = (activeTab === 'following'
    ? dedupedDetections.map(d => ({ type: 'node', ts: d.detected_at, key: `n-${d.id}`, d }))
    : [
        ...dedupedDetections.map(d => ({ type: 'node', ts: d.detected_at, key: `n-${d.id}`, d })),
        ...mobileFeed.map(m => ({ type: 'mobile', ts: m.detected_at, key: `m-${m.id}`, m })),
      ]
  ).sort((a, b) => new Date(b.ts) - new Date(a.ts))

  const mappableNodes = nodes
    .map(n => ({ ...n, coords: parseNodeLocation(n.location) }))
    .filter(n => n.coords)

  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))

  function isRecentNode(node) {
    if (!node.last_seen) return false
    return (Date.now() - new Date(node.last_seen).getTime()) / 60000 <= 5
  }

  const latestAci = aciLogs[0]?.aci_score

  // Fit the map to nodes AND mobile Listens, so Listens far from any node aren't
  // left off-screen. Memoized so it only re-fits when the underlying data changes.
  const mapPoints = useMemo(() => {
    const nodePts = nodes
      .map(n => parseNodeLocation(n.location))
      .filter(Boolean)
      .map(c => [c.lat, c.lon])
    const mobilePts = mobileDetections
      .filter(m => (m.species || []).some(s => s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name)))
      .map(m => [m.lat, m.lon])
    return [...nodePts, ...mobilePts]
  }, [nodes, mobileDetections])

  return (
    <div>

      {/* Section 1 — Hero */}
      <section
        className="section-full-bleed"
        style={{ background: '#f0ebe0', padding: '48px 20px 56px', position: 'relative', overflow: 'hidden' }}
      >
        <WaveformSVG />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '680px' }}>
          <h1 style={{
            fontFamily: "'Big Shoulders Display', sans-serif",
            fontWeight: 900,
            fontSize: 'clamp(1.8rem, 4vw, 3.2rem)',
            color: '#1a1a1a',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            marginBottom: '14px',
          }}>
            The ecosystem is telling a story.
          </h1>
          <p style={{
            fontSize: '0.95rem',
            color: '#3a3530',
            lineHeight: 1.65,
            marginBottom: '24px',
            maxWidth: '540px',
          }}>
            Magora is an open-source ecological intelligence network. Low-cost listening posts turn the soundscape of a place into a living record of its ecosystem: the birds, the insects, the seasons, and the health of the land.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '11px 22px',
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
                padding: '9px 22px',
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
            <ListenButton variant="hero" />
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
            Tap a listening post to view its profile
          </div>
          <div style={{ overflow: 'hidden', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
            <MapContainer center={[39.5, -105.5]} zoom={5} style={{ height: '230px', width: '100%' }} zoomControl={true}>
              <MapController points={mapPoints} />
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
              {mobileFeed.map(m => (
                <CircleMarker
                  key={`mob-${m.id}`}
                  center={[m.lat, m.lon]}
                  radius={7}
                  pathOptions={{ fillColor: AMBER.base, color: AMBER.dark, weight: 2, fillOpacity: 0.8 }}
                  className="node-pulse"
                >
                  <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                    <strong style={{ fontSize: '13px' }}>〰 Listen</strong><br />
                    <span style={{ fontSize: '12px', color: '#555' }}>
                      {m.species?.find(s => s.confidence >= MIN_CONFIDENCE)?.common_name || 'A field recording'}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Detection feed */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ marginBottom: '8px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>The ecological record, live</span>
            <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live from Supabase</span>
          </div>
          <p style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.6, marginBottom: '14px', maxWidth: '640px' }}>
            Right now, across the network, places are speaking. Each signal below is a moment from a living ecosystem, who's present, and how the soundscape is doing.
          </p>

          {showTabs && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              {[['global', 'Global'], ['following', 'Following']].map(([key, label]) => {
                const active = activeTab === key
                return (
                  <button
                    key={key}
                    onClick={() => { if (key === 'following' && !user) { openSignIn(); return } setTab(key) }}
                    style={{
                      padding: '7px 16px', borderRadius: '20px', cursor: 'pointer',
                      fontSize: '13px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif",
                      background: active ? C.accent : C.card,
                      border: `1px solid ${active ? C.accent : C.border}`,
                      color: active ? '#fff' : C.textSub,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Loading...</div>
          ) : feedItems.length > 0 ? (
            <div className="detection-grid">
              {feedItems.map(item => (
                item.type === 'mobile' ? (
                  <MobileDetectionCard
                    key={item.key} d={item.m}
                    insight={insights[item.m.id]} onRequestInsight={() => requestMobileInsight(item.m)}
                  />
                ) : (
                  <DetectionCard
                    key={item.key} d={item.d} node={nodeById[item.d.node_id]} showNode wikiData={wikiData}
                    count={speciesCountToday[item.d.species_name || item.d.raw_label] || 1}
                    insight={insights[item.d.id]} onRequestInsight={() => requestInsight(item.d)}
                  />
                )
              ))}
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textMuted }}>
              <div style={{ fontSize: '15px', fontWeight: '700', color: C.text, marginBottom: '6px' }}>Couldn't reach the network</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
                This looks like a connection problem, not a quiet soundscape. Check your signal and try again.
              </div>
              <button
                onClick={() => { setLoading(true); fetchData() }}
                style={{
                  padding: '9px 18px', background: C.accent, border: 'none', borderRadius: '10px',
                  color: '#fff', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Try again
              </button>
            </div>
          ) : activeTab === 'following' ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textMuted, lineHeight: 1.6 }}>
              Nothing from the places you follow in this window. Try the Global tab, or follow more listening posts.
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Nothing recorded in this window</div>
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
