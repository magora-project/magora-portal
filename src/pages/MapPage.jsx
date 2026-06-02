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

const GUILD = {
  aerial_insectivore: { label: 'Aerial insectivore', emoji: '🪁' },
  foliage_gleaner:    { label: 'Foliage gleaner',    emoji: '🌿' },
  bark_prober:        { label: 'Bark prober',         emoji: '🪵' },
  ground_forager:     { label: 'Ground forager',      emoji: '🌾' },
  granivore:          { label: 'Seed eater',          emoji: '🌱' },
  omnivore:           { label: 'Omnivore',            emoji: '🔄' },
  raptor:             { label: 'Raptor',              emoji: '🦅' },
  nectarivore:        { label: 'Nectarivore',         emoji: '🌸' },
  frugivore:          { label: 'Fruit eater',         emoji: '🍇' },
  aquatic:            { label: 'Aquatic',             emoji: '💧' },
}

const SEASON_EMOJI = {
  winter: '❄️', early_spring: '🌱', breeding: '🐣',
  post_breeding: '🌿', fall_migration: '🍂', late_fall: '🍁',
}

function clientSeason() {
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const week = Math.min(52, Math.ceil(doy / 7))
  if (week <= 10) return 'winter'
  if (week <= 18) return 'early_spring'
  if (week <= 26) return 'breeding'
  if (week <= 34) return 'post_breeding'
  if (week <= 44) return 'fall_migration'
  return 'late_fall'
}

const BADGE_EXPLAIN = {
  confidence: v => v >= 75
    ? `${v}% confidence — BirdNET is highly confident this identification is correct.`
    : v >= 50
    ? `${v}% confidence — likely correct, but there's some uncertainty in the identification.`
    : `${v}% confidence — possible detection, but treat with caution. Lower confidence can mean background noise or a similar-sounding species.`,
  count:      v => `Detected ${v} times in the most recent 50 recordings at this node. High repeat count suggests this species is actively using this habitat.`,
  dawn:       () => 'Detected during the acoustic dawn chorus — the peak singing window just before and after sunrise. This is when birds are most vocally active, often defending territory or attracting mates.',
  season:     v => ({
    winter:        'Winter — resident species dominate. Migrants have departed and breeding has ended. Activity is driven by foraging and survival.',
    early_spring:  'Early spring — the first long-distance migrants are arriving. Territory establishment begins and singing activity picks up.',
    breeding:      'Breeding season — peak vocal activity. Most detections are territorial males singing to defend space or attract mates.',
    post_breeding: 'Post-breeding — fledglings are dispersing and adult birds are quieter. A transitional period before fall migration.',
    fall_migration: 'Fall migration — species passing through on their way south. You may detect birds that don\'t normally live here.',
    late_fall:     'Late fall — most migrants have departed. Detections are mostly resident species preparing for winter.',
  }[v] || v.replace(/_/g, ' ')),
  sunrise:    v => v < 0
    ? `Detected ${Math.abs(v)} minutes before sunrise — in the pre-dawn period when the earliest singers begin.`
    : `Detected ${v} minutes after sunrise — ${v < 120 ? 'within the dawn chorus window, peak vocal activity.' : v < 360 ? 'morning singing period.' : 'well into the day.'}`,
  guild: g => ({
    aerial_insectivore: 'Aerial insectivore — catches flying insects in mid-air. Their presence reflects healthy insect populations and open airspace.',
    foliage_gleaner:    'Foliage gleaner — picks insects and spiders from leaves and branches. Tightly linked to the health and structure of the tree canopy.',
    bark_prober:        'Bark prober — excavates insects from tree bark and dead wood. Often an indicator of mature forest with standing dead trees.',
    ground_forager:     'Ground forager — finds food on or near the soil surface. Sensitive to ground cover, litter depth, and low vegetation structure.',
    granivore:          'Seed eater — primarily eats seeds and grains. Their population tracks the productivity of grasses, shrubs, and wildflowers.',
    omnivore:           'Omnivore — eats a wide variety of food including insects, fruit, and seeds. Often adaptable to disturbed or changing habitats.',
    raptor:             'Raptor — a bird of prey. Raptors sit at the top of the food web and their presence reflects a healthy prey base below them.',
    nectarivore:        'Nectarivore — feeds primarily on flower nectar. A direct link between bird activity and the flowering plant community.',
    frugivore:          'Fruit eater — depends on fruiting shrubs and trees. Often an important seed disperser, shaping future plant communities.',
    aquatic:            'Aquatic forager — hunts in or near water. Their presence is a direct indicator of water quality and aquatic food availability.',
  }[g] || `Foraging guild: ${g.replace(/_/g, ' ')}. Guild describes how and where a bird finds its food.`),
  migratory: m => ({
    long_distance:  'Long-distance migrant — travels thousands of miles between breeding and wintering grounds, often to Central or South America. Highly sensitive to habitat loss at both ends of the journey.',
    short_distance: 'Short-distance migrant — moves seasonally within North America, often shifting to lower elevations or southern regions in winter.',
    resident:       'Year-round resident — lives here in all seasons. Does not migrate. Their presence is a stable signal of local habitat quality.',
    altitudinal:    'Altitudinal migrant — moves up and down in elevation with the seasons rather than north-south. Winters in valley bottoms, breeds at higher elevation.',
    irruptive:      'Irruptive migrant — makes unpredictable long-distance movements when food sources like seeds or prey collapse in their normal range.',
  }[m] || m.replace(/_/g, ' ')),
  sensitive:  () => 'Conservation-sensitive species — flagged because this bird is vulnerable to habitat loss, climate change, or declining populations. Its presence or absence at this node is ecologically meaningful.',
}

function DetectionCard({ d, wikiData, count, insight, onRequestInsight }) {
  const [activeBadge, setActiveBadge] = useState(null)
  const conf = d.confidence ? Math.round(d.confidence * 100) : null
  const wiki = wikiData[d.species_name] || {}
  const sci  = d.raw_label?.split('_')[1] || ''

  function Btn({ id, explain, style, children }) {
    const active = activeBadge === id
    return (
      <button
        onClick={() => setActiveBadge(active ? null : id)}
        style={{
          borderRadius: '20px', padding: '3px 9px', fontSize: '12px',
          fontWeight: '600', border: 'none', cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          outline: active ? `2px solid #fff` : 'none',
          outlineOffset: '1px',
          ...style,
        }}
      >
        {children}
      </button>
    )
  }

  return (
    <div style={{ background: C.card, borderTop: `1px solid ${C.border}`, overflow: 'hidden' }}>

      {/* Top row: thumbnail left, info right */}
      <div style={{ display: 'flex', gap: '0' }}>
        {wiki.img
          ? <img src={wiki.img} alt={d.species_name} style={{ width: '110px', minHeight: '110px', objectFit: 'cover', objectPosition: 'center', flexShrink: 0, display: 'block' }} />
          : <div style={{ width: '110px', height: '110px', background: '#1a4a28', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', flexShrink: 0 }}>🐦</div>
        }
        <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ fontSize: '17px', fontWeight: '700', color: C.text, lineHeight: 1.2, marginBottom: sci ? '2px' : '8px' }}>
            {d.species_name || d.raw_label || 'Unknown'}
          </div>
          {sci && <div style={{ fontSize: '12px', color: C.textMuted, fontStyle: 'italic', marginBottom: '8px' }}>{sci}</div>}

          {/* Row 1: detection metadata */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '5px' }}>
            {conf !== null && <Btn id="confidence" style={{ background: C.bg, color: C.accentLight, border: `1px solid ${C.accent}` }}>{conf}%</Btn>}
            <span style={{ borderRadius: '20px', padding: '3px 9px', fontSize: '12px', fontWeight: '600', background: C.bg, border: `1px solid ${C.border}`, color: C.textSub }}>
              {toMountainTime(d.detected_at, false)}
            </span>
            {count > 1 && <Btn id="count" style={{ background: '#1a3a28', border: '1px solid #22c55e', color: '#86efac' }}>×{count}</Btn>}
            {d.is_dawn_chorus && <Btn id="dawn" style={{ background: '#1a3a4a', border: '1px solid #0ea5e9', color: '#7dd3fc' }}>🌅 Dawn chorus</Btn>}
            {d.season && <Btn id="season" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>{SEASON_EMOJI[d.season]} {d.season.replace(/_/g, ' ')}</Btn>}
            {d.minutes_from_sunrise != null && <Btn id="sunrise" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>☀️ {d.minutes_from_sunrise < 0 ? `${Math.abs(d.minutes_from_sunrise)}m pre-dawn` : `+${d.minutes_from_sunrise}m`}</Btn>}
          </div>

          {/* Row 2: species profile */}
          {d.species?.guild && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <Btn id="guild" style={{ background: '#1a3a28', border: `1px solid ${C.accent}`, color: C.accentLight }}>
                {GUILD[d.species.guild]?.emoji} {GUILD[d.species.guild]?.label || d.species.guild.replace(/_/g, ' ')}
              </Btn>
              {d.species.migratory_status && (
                <Btn id="migratory" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>
                  {d.species.migratory_status === 'long_distance' ? '🌍' : d.species.migratory_status === 'resident' ? '🏠' : d.species.migratory_status === 'altitudinal' ? '⛰️' : '💨'} {d.species.migratory_status.replace(/_/g, ' ')}
                </Btn>
              )}
              {d.species.sensitivity_flag && (
                <Btn id="sensitive" style={{ background: '#2a1a0a', border: '1px solid #f97316', color: '#fb923c' }}>⚠️ sensitive</Btn>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Badge explanation strip */}
      {activeBadge && (
        <div style={{
          padding: '10px 14px', fontSize: '13px', color: C.textSub,
          lineHeight: 1.6, background: '#0f3020',
          borderTop: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.accentLight}`,
        }}>
          {activeBadge === 'confidence'  && BADGE_EXPLAIN.confidence(conf)}
          {activeBadge === 'count'       && BADGE_EXPLAIN.count(count)}
          {activeBadge === 'dawn'        && BADGE_EXPLAIN.dawn()}
          {activeBadge === 'season'      && BADGE_EXPLAIN.season(d.season)}
          {activeBadge === 'sunrise'     && BADGE_EXPLAIN.sunrise(d.minutes_from_sunrise)}
          {activeBadge === 'guild'       && BADGE_EXPLAIN.guild(d.species?.guild)}
          {activeBadge === 'migratory'   && BADGE_EXPLAIN.migratory(d.species?.migratory_status)}
          {activeBadge === 'sensitive'   && BADGE_EXPLAIN.sensitive()}
        </div>
      )}

      {/* Wikipedia fact */}
      {wiki.fact && (
        <div style={{ padding: '10px 14px', fontSize: '13px', color: C.textSub, lineHeight: 1.5, fontStyle: 'italic', borderTop: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}` }}>
          {wiki.fact}
        </div>
      )}

      {/* Insight */}
      <div style={{ padding: '10px 14px 14px' }}>
        {!insight?.text && (
          <button onClick={onRequestInsight} disabled={insight?.loading} style={{
            width: '100%', padding: '10px',
            background: insight?.loading ? C.border : C.accent,
            border: 'none', borderRadius: '10px',
            color: insight?.loading ? '#4a7a58' : '#fff',
            fontSize: '14px', fontWeight: '700',
            cursor: insight?.loading ? 'default' : 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {insight?.loading ? '🔍 Generating...' : '🌿 Get Ecological Insight'}
          </button>
        )}
        {insight?.text && (
          <div style={{ fontSize: '13px', color: C.textSub, lineHeight: 1.5, borderLeft: `3px solid ${C.accentLight}`, paddingLeft: '10px' }}>
            {insight.text}
          </div>
        )}
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
          // fallbacks in case Supabase enrichment fails
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
      <div style={{ marginBottom: '16px', marginLeft: '-16px', marginRight: '-16px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', paddingLeft: '16px' }}>
          Detection locations
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

      {/* Bird detections */}
      <div style={{ marginBottom: '28px' }}>
        <div className="section-header" style={{ marginBottom: '14px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
