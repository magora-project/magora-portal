import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { parseNodeLocation } from '../lib/geo'
import DetectionCard, { toMountainTime } from '../components/DetectionCard'

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

export default function MapPage() {
  const navigate = useNavigate()
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
      .from('detections')
      .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
      .order('detected_at', { ascending: false }).limit(50)
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

  return (
    <div>
      {/* Map */}
      <div style={{ marginBottom: '16px', marginLeft: '-16px', marginRight: '-16px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '16px' }}>
          Detection locations — tap a node to view its profile
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

      {/* Bird detections */}
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

      {/* ACI feed */}
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
