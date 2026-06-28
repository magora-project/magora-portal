import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const GUILD_EMOJI = {
  aerial_insectivore: '🪁', foliage_gleaner: '🌿', bark_prober: '🪵',
  ground_forager: '🌾', granivore: '🌱', omnivore: '🔄',
  raptor: '🦅', nectarivore: '🌸', frugivore: '🍇', aquatic: '💧', other: '🐦',
}

const SEASON_LABEL = {
  winter: '❄️ Winter', early_spring: '🌱 Early spring', breeding: '🐣 Breeding',
  post_breeding: '🌿 Post-breeding', fall_migration: '🍂 Fall migration', late_fall: '🍁 Late fall',
}
const SEASON_ORDER = ['winter', 'early_spring', 'breeding', 'post_breeding', 'fall_migration', 'late_fall']
const MIG_EMOJI = { long_distance: '🌍', resident: '🏠', altitudinal: '⛰️', irruptive: '💨', short_distance: '↕️' }

function getCurrentSeason() {
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const week = Math.min(52, Math.ceil(doy / 7))
  if (week <= 10) return { key: 'winter', week }
  if (week <= 18) return { key: 'early_spring', week }
  if (week <= 26) return { key: 'breeding', week }
  if (week <= 34) return { key: 'post_breeding', week }
  if (week <= 44) return { key: 'fall_migration', week }
  return { key: 'late_fall', week }
}

// Smooth open curve through points (Catmull-Rom -> cubic bezier)
function smoothLine(points) {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

// River-style soundscape: a flowing band whose thickness = soundscape complexity
function SoundRiver({ data }) {
  const W = 680, H = 150, padX = 26, center = H / 2, amp = 108
  const n = data.length
  const xs = data.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1))
  const top = data.map((d, i) => ({ x: xs[i], y: center - (d.avg * amp) / 2 }))
  const bot = data.map((d, i) => ({ x: xs[i], y: center + (d.avg * amp) / 2 }))
  const botRev = [...bot].reverse()
  const topPath = smoothLine(top)
  const botPath = smoothLine(botRev)
  const area = `${topPath} L ${botRev[0].x} ${botRev[0].y} ${botPath.slice(botPath.indexOf('C'))} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Soundscape complexity through the day">
      <defs>
        <linearGradient id="river" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0F6E56" />
          <stop offset="0.5" stopColor="#1D9E75" />
          <stop offset="1" stopColor="#5DCAA5" />
        </linearGradient>
      </defs>
      <line x1={padX} y1={center} x2={W - padX} y2={center} stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <path d={area} fill="url(#river)" opacity="0.92" />
      {data.map((d, i) => (
        <text key={d.cat} x={xs[i]} y={H + 16} fill="#7aad8a" fontSize="11" textAnchor="middle">{d.cat}</text>
      ))}
    </svg>
  )
}

function Section({ title, sub, children }) {
  return (
    <section style={{ marginBottom: '36px' }}>
      <h2 style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: '20px', color: C.accentLight, textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 4px' }}>
        {title}
      </h2>
      {sub && <p style={{ fontSize: '13px', color: C.textMuted, margin: '0 0 16px', lineHeight: 1.55 }}>{sub}</p>}
      {children}
    </section>
  )
}

function BarRow({ icon, label, pct, value, to }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
      {icon && <span style={{ fontSize: '15px', width: '20px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: C.textSub, marginBottom: '4px' }}>
          {to ? <Link to={to} style={{ color: C.textSub, textDecoration: 'none' }}>{label}</Link> : label}
        </div>
        <div style={{ height: '6px', background: C.bg, borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.accent, borderRadius: '3px' }} />
        </div>
      </div>
      <span style={{ fontSize: '13px', fontWeight: 700, color: C.accentLight, flexShrink: 0, minWidth: '36px', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

const emptyNote = (t) => <div style={{ fontSize: '13px', color: C.textMuted }}>{t}</div>

export default function Dashboard() {
  const [detections, setDetections] = useState([])
  const [aciLogs, setAciLogs] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: nodeData } = await supabase.from('nodes').select('*')
      const { data: detectionData } = await supabase
        .from('detections')
        .select('*, species(guild, migratory_status, indicator_status, sensitivity_flag)')
        .gte('confidence', MIN_CONFIDENCE)
        .order('detected_at', { ascending: false }).limit(200)
      const { data: aciData } = await supabase
        .from('aci_logs').select('*').order('recorded_at', { ascending: false }).limit(200)
      setNodes(nodeData || [])
      setDetections(detectionData || [])
      setAciLogs(aciData || [])
      setLoading(false)
    }
    fetchData()
  }, [])

  // Species
  const speciesCounts = detections.reduce((acc, d) => {
    const name = d.species_name || 'Unknown'
    if (isHiddenSpecies(name)) return acc
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxCount = topSpecies[0]?.[1] || 1
  const totalSpecies = Object.keys(speciesCounts).length

  // Soundscape through the day (river)
  const aciByCategory = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'].map(cat => {
    const logs = aciLogs.filter(l => l.time_category === cat)
    const avg = logs.length ? logs.reduce((a, b) => a + b.aci_score, 0) / logs.length : 0
    return { cat, avg: parseFloat(avg.toFixed(2)) }
  })
  const aciVals = aciByCategory.map(d => d.avg).filter(v => v > 0)
  const avgAci = aciVals.length ? aciVals.reduce((a, b) => a + b, 0) / aciVals.length : 0
  const soundWord = avgAci > 0.6 ? 'rich' : avgAci > 0.45 ? 'moderate' : avgAci > 0 ? 'quiet' : null
  const latestNight = aciLogs.find(l => l.time_category === 'Night')?.aci_score

  // Guilds
  const guildCounts = detections.reduce((acc, d) => {
    const g = d.species?.guild
    if (g) acc[g] = (acc[g] || 0) + 1
    return acc
  }, {})
  const guildEntries = Object.entries(guildCounts).sort((a, b) => b[1] - a[1])
  const maxGuild = guildEntries[0]?.[1] || 1

  // Migration
  const migCounts = detections.reduce((acc, d) => {
    const m = d.species?.migratory_status
    if (m) acc[m] = (acc[m] || 0) + 1
    return acc
  }, {})
  const totalMig = Object.values(migCounts).reduce((a, b) => a + b, 0)
  const migEntries = Object.entries(migCounts).sort((a, b) => b[1] - a[1])

  // Seasonal species shift (distinct species per season)
  const seasonSpecies = detections.reduce((acc, d) => {
    const s = d.season, n = d.species_name
    if (!s || !n || isHiddenSpecies(n)) return acc
    ;(acc[s] = acc[s] || new Set()).add(n)
    return acc
  }, {})
  const seasonData = SEASON_ORDER.map(k => ({ key: k, label: SEASON_LABEL[k], count: seasonSpecies[k]?.size || 0 }))
  const maxSeason = Math.max(1, ...seasonData.map(s => s.count))

  // Conservation
  const sensitiveCount = [...new Set(detections.filter(d => d.species?.sensitivity_flag).map(d => d.species_name))].length

  const season = getCurrentSeason()
  const seasonPlain = SEASON_LABEL[season.key].split(' ').slice(1).join(' ').toLowerCase()
  const activeNodes = nodes.filter(n => n.is_active).length

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontSize: '16px' }}>Loading patterns…</div>
  )

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', paddingBottom: '48px' }}>

      {/* Header */}
      <h1 style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(2rem, 6vw, 2.6rem)', color: C.text, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.05, margin: '0 0 10px' }}>
        Ecological Patterns
      </h1>
      <p style={{ fontSize: '15px', color: C.textSub, lineHeight: 1.6, margin: '0 0 6px' }}>
        Across {activeNodes} listening post{activeNodes !== 1 ? 's' : ''}, {totalSpecies} species recorded this {seasonPlain}
        {soundWord ? `, with soundscapes running ${soundWord} through the day` : ''}.
      </p>
      {sensitiveCount > 0 && (
        <p style={{ fontSize: '13px', color: '#fb923c', margin: '0 0 30px' }}>
          ⚠️ {sensitiveCount} conservation-sensitive species detected
        </p>
      )}
      {sensitiveCount === 0 && <div style={{ height: '24px' }} />}

      {/* Soundscape river */}
      <Section title="Soundscape through the day" sub="How alive the whole soundscape sounds, hour by hour. The river swells where the place is richest, thins when it falls quiet.">
        {avgAci > 0
          ? <>
              <SoundRiver data={aciByCategory} />
              {latestNight != null && (
                <p style={{ fontSize: '12px', color: C.textMuted, marginTop: '10px' }}>
                  Latest night reading {latestNight} — a proxy for insect chorus activity.
                </p>
              )}
            </>
          : emptyNote('No soundscape readings yet.')}
      </Section>

      {/* Guilds */}
      <Section title="The community right now" sub="The functional roles being heard, who eats what, and where. A spread of guilds signals a layered, working ecosystem.">
        {guildEntries.length === 0 ? emptyNote('No guild data yet.') : guildEntries.map(([guild, count]) => (
          <BarRow key={guild} icon={GUILD_EMOJI[guild] || '🐦'} label={guild.replace(/_/g, ' ')} pct={Math.round(count / maxGuild * 100)} value={count} />
        ))}
      </Section>

      {/* Migration */}
      <Section title="Who's passing through" sub="Year-round residents versus migrants moving with the seasons.">
        {totalMig === 0 ? emptyNote('No migration data yet.') : migEntries.map(([status, count]) => (
          <BarRow key={status} icon={MIG_EMOJI[status] || '↕️'} label={status.replace(/_/g, ' ')} pct={Math.round(count / totalMig * 100)} value={`${Math.round(count / totalMig * 100)}%`} />
        ))}
      </Section>

      {/* Seasonal shift */}
      <Section title="Across the seasons" sub="Distinct species recorded in each season. This view fills in as the year turns.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px' }}>
          {seasonData.map(s => {
            const isNow = s.key === season.key
            return (
              <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: s.count ? C.accentLight : C.textMuted }}>{s.count || ''}</div>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{
                    width: '100%', height: `${Math.max(s.count ? 6 : 0, Math.round(s.count / maxSeason * 100))}%`,
                    background: isNow ? C.accent : C.border, borderRadius: '4px 4px 0 0',
                  }} />
                </div>
                <div title={s.label.split(' ').slice(1).join(' ')} style={{ fontSize: '15px', opacity: isNow ? 1 : 0.6 }}>{s.label.split(' ')[0]}</div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Most recorded */}
      <Section title="Most recorded" sub="The species heard most often across the network.">
        {topSpecies.length === 0 ? emptyNote('No recordings yet.') : topSpecies.map(([name, count]) => (
          <BarRow
            key={name}
            label={name}
            pct={Math.round(count / maxCount * 100)}
            value={count}
            to={name !== 'Unknown' ? `/species/${encodeURIComponent(name)}` : undefined}
          />
        ))}
      </Section>

      {/* Listening posts */}
      <Section title="Listening posts">
        {nodes.length === 0 ? emptyNote('No listening posts registered yet.') : nodes.map(node => (
          <Link key={node.id} to={`/node/${node.id}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: `1px solid ${C.border}`, textDecoration: 'none' }}>
            <div style={{ width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0, background: node.is_active ? C.accentLight : '#4a7a58' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>{node.name}</div>
              <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '1px' }}>
                {(node.habitat_type || 'unknown').replace(/-/g, ' ')}{node.elevation_m ? ` · ${node.elevation_m}m` : ''}
              </div>
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: node.is_active ? C.accentLight : '#4a7a58' }}>
              {node.is_active ? 'online' : 'offline'}
            </div>
          </Link>
        ))}
      </Section>

    </div>
  )
}
