import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

export default function Dashboard() {
  const [detections, setDetections] = useState([])
  const [aciLogs, setAciLogs] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: nodeData } = await supabase.from('nodes').select('*')
      const { data: detectionData } = await supabase
        .from('detections').select('*').order('detected_at', { ascending: false }).limit(100)
      const { data: aciData } = await supabase
        .from('aci_logs').select('*').order('recorded_at', { ascending: false }).limit(200)
      setNodes(nodeData || [])
      setDetections(detectionData || [])
      setAciLogs(aciData || [])
      setLoading(false)
    }
    fetchData()
  }, [])

  const speciesCounts = detections.reduce((acc, d) => {
    const name = d.species_name || 'Unknown'
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})
  const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxCount = topSpecies[0]?.[1] || 1

  const aciByCategory = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'].map(cat => {
    const logs = aciLogs.filter(l => l.time_category === cat)
    const avg = logs.length ? logs.reduce((a, b) => a + b.aci_score, 0) / logs.length : 0
    return { cat, avg: parseFloat(avg.toFixed(2)) }
  })

  const nightLogs = aciLogs.filter(l => l.time_category === 'Night').slice(0, 3)

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, fontSize: '16px' }}>
      Loading dashboard...
    </div>
  )

  const card = {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: '16px', padding: '18px 20px',
  }
  const cardTitle = {
    fontSize: '13px', fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px',
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* My nodes */}
        <div style={card}>
          <div style={cardTitle}>My nodes</div>
          {nodes.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No nodes registered yet</div>
          ) : nodes.map(node => (
            <div key={node.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{
                width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
                background: node.is_active ? C.accentLight : '#4a7a58',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>{node.name}</div>
                <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '1px' }}>
                  {node.habitat_type || 'unknown habitat'}{node.elevation_m ? ` · ${node.elevation_m}m` : ''}
                </div>
              </div>
              <div style={{
                fontSize: '12px', fontWeight: '700', padding: '3px 10px',
                borderRadius: '20px',
                background: node.is_active ? '#0d2818' : '#0d2818',
                color: node.is_active ? C.accentLight : '#4a7a58',
                border: `1px solid ${node.is_active ? C.accent : C.border}`,
              }}>
                {node.is_active ? 'online' : 'offline'}
              </div>
            </div>
          ))}
        </div>

        {/* ACI by time of day */}
        <div style={card}>
          <div style={cardTitle}>ACI by time of day</div>
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

        {/* Top species */}
        <div style={card}>
          <div style={cardTitle}>Top species this week</div>
          {topSpecies.length === 0 ? (
            <div style={{ fontSize: '13px', color: C.textMuted }}>No detections yet</div>
          ) : topSpecies.map(([name, count]) => (
            <div key={name} style={{
              display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>{name}</div>
                <div style={{ height: '4px', background: C.bg, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(count / maxCount * 100)}%`, height: '100%', background: C.accent, borderRadius: '2px' }} />
                </div>
              </div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: C.accentLight, flexShrink: 0 }}>
                {count}
              </div>
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
