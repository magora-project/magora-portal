import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { parseNodeLocation } from '../lib/geo'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const SEASONS = [
  ['winter', '❄️ Winter'], ['early_spring', '🌱 Early spring'], ['breeding', '🐣 Breeding'],
  ['post_breeding', '🌿 Post-breeding'], ['fall_migration', '🍂 Fall migration'], ['late_fall', '🍁 Late fall'],
]

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], 4)
    else map.fitBounds(points, { padding: [30, 30], maxZoom: 5 })
  }, [points, map])
  return null
}

export default function SpeciesPage() {
  const { name } = useParams()
  const navigate = useNavigate()
  const species = decodeURIComponent(name)

  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [wiki, setWiki] = useState({})
  const [taxonKey, setTaxonKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const fetched = useRef(false)

  useEffect(() => {
    fetched.current = false
    setLoading(true)
    async function run() {
      const { data: dets } = await supabase
        .from('detections')
        .select('node_id, detected_at, season, raw_label, confidence')
        .eq('species_name', species)
        .gte('confidence', MIN_CONFIDENCE)
        .order('detected_at', { ascending: false })
        .limit(5000)

      const list = dets || []
      setDetections(list)

      const nodeIds = [...new Set(list.map(d => d.node_id).filter(Boolean))]
      if (nodeIds.length) {
        const { data: nodeData } = await supabase.from('nodes').select('*').in('id', nodeIds)
        setNodes(nodeData || [])
      } else {
        setNodes([])
      }
      setLoading(false)
    }
    run()
  }, [species])

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(species)}`)
      .then(r => r.json())
      .then(data => setWiki({
        img: data.thumbnail?.source || null,
        fact: data.extract ? data.extract.split('. ').slice(0, 2).join('. ') + '.' : null,
      }))
      .catch(() => setWiki({}))
  }, [species])

  const sci = detections.find(d => d.raw_label?.includes('_'))?.raw_label?.split('_')[1] || ''
  const total = detections.length

  // Look up the GBIF taxon key (prefer scientific name) for the range overlay
  useEffect(() => {
    const q = sci || species
    if (!q) return
    let cancelled = false
    fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setTaxonKey(data.usageKey || data.speciesKey || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sci, species])

  const perNode = detections.reduce((acc, d) => {
    if (d.node_id) acc[d.node_id] = (acc[d.node_id] || 0) + 1
    return acc
  }, {})
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const placesRanked = Object.entries(perNode)
    .map(([id, n]) => ({ node: nodeById[id], count: n }))
    .filter(p => p.node)
    .sort((a, b) => b.count - a.count)

  const mappable = placesRanked
    .map(p => ({ ...p, coords: parseNodeLocation(p.node.location) }))
    .filter(p => p.coords)
  const points = mappable.map(p => [p.coords.lat, p.coords.lon])

  const seasonCounts = detections.reduce((acc, d) => {
    if (d.season) acc[d.season] = (acc[d.season] || 0) + 1
    return acc
  }, {})
  const seasonMax = Math.max(1, ...Object.values(seasonCounts))
  const peakSeason = SEASONS.find(([k]) => k === Object.entries(seasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted }}>Loading species...</div>
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.textMuted, marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: C.accentLight, cursor: 'pointer', fontSize: '12px', fontWeight: '600', padding: 0 }}>Network</button>
        <span>→</span>
        <span>Species</span>
        <span>→</span>
        <span style={{ color: C.textSub, fontWeight: '600' }}>{species}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px' }}>
        {wiki.img
          ? <img src={wiki.img} alt={species} style={{ width: '88px', height: '88px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${C.border}` }} />
          : <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', flexShrink: 0 }}>🐦</div>
        }
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '26px', fontWeight: '800', color: C.text, lineHeight: 1.1, margin: 0 }}>{species}</h1>
          {sci && <div style={{ fontSize: '14px', color: C.textMuted, fontStyle: 'italic', marginTop: '4px' }}>{sci}</div>}
          <div style={{ fontSize: '13px', color: C.textSub, marginTop: '6px' }}>
            A thread running through {placesRanked.length} {placesRanked.length === 1 ? 'place' : 'places'} on the network.
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Recordings', value: total || '—' },
          { label: 'Places', value: placesRanked.length || '—' },
          { label: 'Peak season', value: peakSeason ? peakSeason[1].split(' ')[0] : '—', sub: peakSeason ? peakSeason[1].split(' ').slice(1).join(' ') : null },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', color: C.accentLight, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '3px' }}>{sub}</div>}
            <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '6px' }}>{label}</div>
          </div>
        ))}
      </div>

      {total === 0 && (
        <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted, background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', marginBottom: '20px' }}>
          No recordings of this species on the network yet.
        </div>
      )}

      {/* Wikipedia fact */}
      {wiki.fact && (
        <div style={{ fontSize: '14px', color: C.textSub, lineHeight: 1.7, fontStyle: 'italic', borderLeft: `3px solid ${C.accent}`, paddingLeft: '14px', marginBottom: '20px' }}>
          {wiki.fact}
        </div>
      )}

      {/* Range map: GBIF global occurrences + our nodes */}
      {(taxonKey || points.length > 0) && (
        <>
          <div style={{ borderRadius: '14px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <MapContainer center={points[0] || [20, 0]} zoom={points.length ? 4 : 2} style={{ height: '260px', width: '100%' }} scrollWheelZoom={false} worldCopyJump={true}>
              <FitBounds points={points} />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution="© OpenStreetMap © CARTO"
              />
              {taxonKey && (
                <TileLayer
                  url={`https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?srs=EPSG:3857&bin=hex&style=green.poly&taxonKey=${taxonKey}`}
                  opacity={0.7}
                  attribution="Range: GBIF"
                />
              )}
              {mappable.map(p => (
                <CircleMarker
                  key={p.node.id}
                  center={[p.coords.lat, p.coords.lon]}
                  radius={8}
                  pathOptions={{ fillColor: '#c0392b', color: '#fff', weight: 2, fillOpacity: 0.95 }}
                  eventHandlers={{ click: () => navigate(`/node/${p.node.id}`) }}
                >
                  <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                    <strong>{p.node.name}</strong> · {p.count} recording{p.count !== 1 ? 's' : ''}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div style={{ fontSize: '11px', color: C.textMuted, margin: '8px 0 20px' }}>
            Shaded areas show the species' global occurrence range (GBIF). Red markers show where Magora has recorded it.
          </div>
        </>
      )}

      {/* Places list */}
      {placesRanked.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Heard at these places</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {placesRanked.map(({ node, count }) => (
              <Link key={node.id} to={`/node/${node.id}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px', textDecoration: 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{node.name}</div>
                  <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '1px' }}>
                    {node.habitat_type ? node.habitat_type.replace(/-/g, ' ') : ''}{node.elevation_m ? ` · ${node.elevation_m}m` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>×{count}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Seasonal pattern */}
      {Object.keys(seasonCounts).length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>When it's heard</div>
          {SEASONS.filter(([k]) => seasonCounts[k]).map(([k, label]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: C.textSub, width: '120px', flexShrink: 0 }}>{label}</span>
              <div style={{ flex: 1, height: '6px', background: C.bg, borderRadius: '3px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                <div style={{ width: `${Math.round(seasonCounts[k] / seasonMax * 100)}%`, height: '100%', background: C.accent }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, width: '32px', textAlign: 'right', flexShrink: 0 }}>{seasonCounts[k]}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
