import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  winter: '❄️ Winter', early_spring: '🌱 Early Spring', breeding: '🐣 Breeding',
  post_breeding: '🌿 Post-Breeding', fall_migration: '🍂 Fall Migration', late_fall: '🍁 Late Fall',
}

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

  // Species counts
  const speciesCounts = detections.reduce((acc, d) => {
    const name = d.species_name || 'Unknown'
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxCount = topSpecies[0]?.[1] || 1

  // ACI
  const aciByCategory = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'].map(cat => {
    const logs = aciLogs.filter(l => l.time_category === cat)
    const avg = logs.length ? logs.reduce((a, b) => a + b.aci_score, 0) / logs.length : 0
    return { cat, avg: parseFloat(avg.toFixed(2)) }
  })
  const nightLogs = aciLogs.filter(l => l.time_category === 'Night').slice(0, 3)

  // Guild breakdown
  const guildCounts = detections.reduce((acc, d) => {
    const guild = d.species?.guild
    if (guild) acc[guild] = (acc[guild] || 0) + 1
    return acc
  }, {})
  const guildEntries = Object.entries(guildCounts).sort((a, b) => b[1] - a[1])
  const maxGuild = guildEntries[0]?.[1] || 1

  // Migration breakdown
  const migCounts = detections.reduce((acc, d) => {
    const m = d.species?.migratory_status
    if (m) acc[m] = (acc[m] || 0) + 1
    return acc
  }, {})
  const totalMig = Object.values(migCounts).reduce((a, b) => a + b, 0)

  // Sensitivity
  const sensitiveCount = [...new Set(
    detections.filter(d => d.species?.sensitivity_flag).map(d => d.species_name)
  )].length
  const climateCount = [...new Set(
    detections.filter(d => d.species?.indicator_status === 'climate_sensitive').map(d => d.species_name)
  )].length

  const season = getCurrentSeason()
  const totalSpecies = Object.keys(speciesCounts).length

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontSize: '16px' }}>Loading dashboard...</div>
  )

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '18px 20px' }
  const cardTitle = { fontSize: '13px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px' }

  return (
    <div>

      {/* Ecological Intelligence summary strip */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px 20px', marginBottom: '12px' }}>
        <div style={cardTitle}>Ecological Context</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', textAlign: 'center' }}>
          {[
            { label: 'Season', value: SEASON_LABEL[season.key], sub: `Week ${season.week}` },
            { label: 'Species recordings', value: totalSpecies, sub: 'total unique' },
            { label: 'Sensitive species', value: sensitiveCount, sub: 'conservation concern' },
            { label: 'Climate sensitive', value: climateCount, sub: 'unique species' },
          ].map(({ label, value, sub }) => (
            <div key={label}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: C.accentLight, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: '10px', color: C.textMuted, marginTop: '3px' }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

        {/* My nodes */}
        <div style={card}>
          <div style={cardTitle}>Active listening posts</div>
          {nodes.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No nodes registered yet</div>
          ) : nodes.map(node => (
            <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0, background: node.is_active ? C.accentLight : '#4a7a58' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{node.name}</div>
                <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '1px' }}>
                  {node.habitat_type || 'unknown'}{node.elevation_m ? ` · ${node.elevation_m}m` : ''}
                </div>
              </div>
              <div style={{ fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px', color: node.is_active ? C.accentLight : '#4a7a58', border: `1px solid ${node.is_active ? C.accent : C.border}` }}>
                {node.is_active ? 'online' : 'offline'}
              </div>
            </div>
          ))}
        </div>

        {/* ACI by time of day */}
        <div style={card}>
          <div style={cardTitle}>Soundscape health through the day</div>
          {aciByCategory.map(({ cat, avg }) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: C.textMuted, width: '64px', flexShrink: 0 }}>{cat}</span>
              <div style={{ flex: 1, height: '5px', background: C.bg, borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${avg * 100}%`, height: '100%', background: C.accent, borderRadius: '3px' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, width: '34px', textAlign: 'right' }}>{avg}</span>
            </div>
          ))}
        </div>

        {/* Guild breakdown */}
        <div style={card}>
          <div style={cardTitle}>Recordings by guild</div>
          {guildEntries.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No guild data yet</div>
          ) : guildEntries.map(([guild, count]) => (
            <div key={guild} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', flexShrink: 0 }}>{GUILD_EMOJI[guild] || '🐦'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: C.textSub, marginBottom: '3px' }}>
                  {guild.replace(/_/g, ' ')}
                </div>
                <div style={{ height: '4px', background: C.bg, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(count / maxGuild * 100)}%`, height: '100%', background: C.accent, borderRadius: '2px' }} />
                </div>
              </div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>{count}</span>
            </div>
          ))}
        </div>

        {/* Migration breakdown */}
        <div style={card}>
          <div style={cardTitle}>Migration status</div>
          {totalMig === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No data yet</div>
          ) : Object.entries(migCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
            const pct = Math.round(count / totalMig * 100)
            const emoji = status === 'long_distance' ? '🌍' : status === 'resident' ? '🏠' : status === 'altitudinal' ? '⛰️' : status === 'irruptive' ? '💨' : '↕️'
            return (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: C.textSub, marginBottom: '3px' }}>
                    {status.replace(/_/g, ' ')}
                  </div>
                  <div style={{ height: '4px', background: C.bg, borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: C.accentLight, borderRadius: '2px' }} />
                  </div>
                </div>
                <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>{pct}%</span>
              </div>
            )
          })}
        </div>

        {/* Top species */}
        <div style={card}>
          <div style={cardTitle}>Most recorded species</div>
          {topSpecies.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No recordings yet</div>
          ) : topSpecies.map(([name, count]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>{name}</div>
                <div style={{ height: '4px', background: C.bg, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(count / maxCount * 100)}%`, height: '100%', background: C.accent, borderRadius: '2px' }} />
                </div>
              </div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>{count}</div>
            </div>
          ))}
        </div>

        {/* Night ACI */}
        <div style={card}>
          <div style={cardTitle}>Insect activity (night ACI)</div>
          {nightLogs.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No night recordings yet</div>
          ) : nightLogs.map((log, i) => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: C.textMuted, width: '72px', flexShrink: 0 }}>
                {i === 0 ? 'Tonight' : i === 1 ? 'Last night' : '2 nights ago'}
              </span>
              <div style={{ flex: 1, height: '5px', background: C.bg, borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${log.aci_score * 100}%`, height: '100%', background: C.accentLight, borderRadius: '3px' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, width: '34px', textAlign: 'right' }}>{log.aci_score}</span>
            </div>
          ))}
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#4a7a58', lineHeight: '1.5' }}>
            Night ACI proxy — higher = more insect chorus activity
          </div>
        </div>

      </div>
    </div>
  )
}
