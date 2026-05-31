import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

function toMountainTime(utcString, showSeconds = true) {
  const d = new Date(new Date(utcString).getTime() - 6 * 60 * 60 * 1000)
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  if (showSeconds) {
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${hour}:${m}:${s} ${period}`
  }
  return `${hour}:${m} ${period}`
}

// Supabase can return PostGIS geometry as either a GeoJSON object or a hex WKB string
function parseNodeLocation(loc) {
  if (!loc) return null
  // GeoJSON object: { type: "Point", coordinates: [lon, lat] }
  if (typeof loc === 'object' && Array.isArray(loc.coordinates)) {
    return { lon: loc.coordinates[0], lat: loc.coordinates[1] }
  }
  // Hex WKB string fallback
  if (typeof loc === 'string') {
    try {
      const bytes = loc.match(/.{2}/g).map(b => parseInt(b, 16))
      const view = new DataView(new Uint8Array(bytes).buffer)
      const le = bytes[0] === 1
      const geomType = view.getUint32(1, le)
      const hasSRID = (geomType & 0x20000000) !== 0
      const offset = hasSRID ? 9 : 5
      return { lon: view.getFloat64(offset, le), lat: view.getFloat64(offset + 8, le) }
    } catch { return null }
  }
  return null
}

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
  bg: '#0d2818',
  card: '#163d22',
  border: '#1f5230',
  accent: '#1D9E75',
  accentLight: '#5DCAA5',
  text: '#f0ede8',
  textSub: '#c8e6d0',
  textMuted: '#7aad8a',
}

function DetectionCard({ d, wikiData, count, insight, onRequestInsight }) {
  const conf = d.confidence ? Math.round(d.confidence * 100) : null
  const wiki = wikiData[d.species_name] || {}

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: '20px', overflow: 'hidden',
    }}>
      {wiki.img ? (
        <img src={wiki.img} alt={d.species_name} className="bird-photo"
          style={{ width: '100%', height: '220px', objectFit: 'contain', background: C.bg, display: 'block' }} />
      ) : (
        <div className="bird-photo-placeholder" style={{
          width: '100%', height: '160px', background: '#1a4a28',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64px',
        }}>🐦</div>
      )}

      <div style={{ padding: '20px 22px 24px' }}>
        <div style={{ fontSize: '24px', fontWeight: '700', color: C.text, lineHeight: 1.2, marginBottom: '3px' }}>
          {d.species_name || d.raw_label || 'Unknown'}
        </div>
        {d.raw_label && d.species_name && (
          <div style={{ fontSize: '14px', color: C.textMuted, fontStyle: 'italic', marginBottom: '14px' }}>
            {d.raw_label.split('_')[1] || ''}
          </div>
        )}
        {!d.raw_label && <div style={{ marginBottom: '14px' }} />}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {conf !== null && (
            <span style={{ background: C.bg, border: `1px solid ${C.accent}`, borderRadius: '20px', padding: '5px 12px', fontSize: '13px', fontWeight: '700', color: C.accentLight }}>
              {conf}% confidence
            </span>
          )}
          <span style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '5px 12px', fontSize: '13px', fontWeight: '600', color: C.textSub }}>
            {toMountainTime(d.detected_at, false)}
          </span>
          {d.is_dawn_chorus && (
            <span style={{ background: '#1a3a4a', border: '1px solid #0ea5e9', borderRadius: '20px', padding: '5px 12px', fontSize: '13px', fontWeight: '600', color: '#7dd3fc' }}>
              🌅 Dawn chorus
            </span>
          )}
          {count > 1 && (
            <span style={{ background: '#1a3a28', border: '1px solid #22c55e', borderRadius: '20px', padding: '5px 12px', fontSize: '13px', fontWeight: '700', color: '#86efac' }}>
              ×{count} detections
            </span>
          )}
        </div>

        {wiki.fact && (
          <div style={{ fontSize: '15px', color: C.textSub, lineHeight: 1.7, borderLeft: `3px solid ${C.accent}`, paddingLeft: '14px', fontStyle: 'italic', marginBottom: '16px' }}>
            {wiki.fact}
          </div>
        )}
        {wiki.loaded && !wiki.fact && (
          <div style={{ fontSize: '14px', color: '#4a7a58', borderLeft: `3px solid ${C.border}`, paddingLeft: '14px', marginBottom: '16px' }}>
            No additional info available.
          </div>
        )}
        {!wiki.loaded && (
          <div style={{ fontSize: '14px', color: '#4a7a58', borderLeft: `3px solid ${C.border}`, paddingLeft: '14px', marginBottom: '16px' }}>
            Loading Wikipedia fact...
          </div>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '16px', marginTop: '4px' }}>
          {!insight?.text && (
            <button onClick={onRequestInsight} disabled={insight?.loading} style={{
              width: '100%', padding: '13px',
              background: insight?.loading ? C.border : C.accent,
              border: 'none', borderRadius: '12px',
              color: insight?.loading ? '#4a7a58' : '#fff',
              fontSize: '15px', fontWeight: '700',
              cursor: insight?.loading ? 'default' : 'pointer',
              fontFamily: "'DM Sans', sans-serif", transition: 'background 0.15s',
            }}>
              {insight?.loading ? '🔍 Generating insight...' : '🌿 Get Ecological Insight'}
            </button>
          )}
          {insight?.text && (
            <div style={{ fontSize: '15px', color: C.textSub, lineHeight: 1.7, borderLeft: `3px solid ${C.accentLight}`, paddingLeft: '14px' }}>
              {insight.text}
            </div>
          )}
          {insight?.error && (
            <div style={{ fontSize: '13px', color: '#f87171', marginTop: '8px' }}>Could not load insight. Try again.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MapPage() {
  const [aciLogs, setAciLogs] = useState([])
  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [wikiData, setWikiData] = useState({})
  const [insights, setInsights] = useState({})
  const fetchedWiki = useRef(new Set())

  async function fetchData() {
    const { data: nodeData } = await supabase.from('nodes').select('*').eq('is_active', true)
    const { data: detectionData } = await supabase
      .from('detections').select('*').order('detected_at', { ascending: false }).limit(50)
    const { data: aciData } = await supabase
      .from('aci_logs').select('*').order('recorded_at', { ascending: false }).limit(10)

    setNodes(nodeData || [])
    setDetections(detectionData || [])
    setAciLogs(aciData || [])
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
          species_name: d.species_name || d.raw_label,
          scientific_name: d.raw_label?.split('_')[1] || '',
          confidence: d.confidence,
          location: nodes[0]?.habitat_type || 'montane scrub, Colorado',
          is_dawn_chorus: d.is_dawn_chorus,
          aci_score: d.aci_score || null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setInsights(prev => ({ ...prev, [d.id]: { text: data.insight } }))
    } catch {
      setInsights(prev => ({ ...prev, [d.id]: { error: true } }))
    }
  }

  // Deduplicate feed: one card per species (most recent), with a total count badge
  const speciesCount = detections.reduce((acc, d) => {
    const name = d.species_name || d.raw_label
    if (name) acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const dedupedDetections = detections.filter((d, idx) => {
    const name = d.species_name || d.raw_label
    return detections.findIndex(x => (x.species_name || x.raw_label) === name) === idx
  })

  // Parse coordinates from PostGIS WKB
  const mappableNodes = nodes
    .map(n => ({ ...n, coords: parseNodeLocation(n.location) }))
    .filter(n => n.coords)

  return (
    <div>
      {/* Map */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
          Detection locations
        </div>
        <div className="map-container" style={{ borderRadius: '16px', overflow: 'hidden', border: `1px solid ${C.border}`, height: '320px' }}>
          <MapContainer center={[39.5, -105.5]} zoom={5} style={{ height: '100%', width: '100%' }} zoomControl={true}>
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
              >
                <Popup>
                  <strong style={{ fontSize: '15px' }}>{node.name}</strong><br />
                  <span style={{ fontSize: '13px', color: '#555' }}>
                    {node.habitat_type}{node.elevation_m ? ` · ${node.elevation_m}m` : ''}
                  </span>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/* Bird detections — now above ACI */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ marginBottom: '14px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Recent bird detections</span>
          <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live from Supabase</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Loading...</div>
        ) : detections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>No detections yet</div>
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

      {/* ACI feed — now below detections */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Live acoustic activity</span>
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
  )
}
