import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [detections, setDetections] = useState([])
  const [aciLogs, setAciLogs] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: nodeData } = await supabase
        .from('nodes')
        .select('*')

      const { data: detectionData } = await supabase
        .from('detections')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100)

      const { data: aciData } = await supabase
        .from('aci_logs')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(200)

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

  const topSpecies = Object.entries(speciesCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const aciByCategory = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'].map(cat => {
    const logs = aciLogs.filter(l => l.time_category === cat)
    const avg = logs.length ? logs.reduce((a, b) => a + b.aci_score, 0) / logs.length : 0
    return { cat, avg: parseFloat(avg.toFixed(2)) }
  })

  const nightLogs = aciLogs.filter(l => l.time_category === 'Night').slice(0, 3)

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#888780' }}>Loading dashboard...</div>
  )

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>

        <div style={{ background: '#fff', border: '0.5px solid #d3d1c7', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#5f5e5a', marginBottom: '12px' }}>My nodes</div>
          {nodes.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#888780' }}>No nodes registered yet</div>
          ) : nodes.map(node => (
            <div key={node.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 0', borderBottom: '0.5px solid #f1efe8'
            }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50', flexShrink: 0,
                background: node.is_active ? '#639922' : '#b4b2a9'
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', color: '#2c2c2a' }}>{node.name}</div>
                <div style={{ fontSize: '11px', color: '#888780' }}>
                  {node.habitat_type || 'unknown habitat'} · {node.elevation_m ? node.elevation_m + 'm' : ''}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: node.is_active ? '#639922' : '#888780', fontWeight: '500' }}>
                {node.is_active ? 'online' : 'offline'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '0.5px solid #d3d1c7', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#5f5e5a', marginBottom: '12px' }}>ACI by time of day</div>
          {aciByCategory.map(({ cat, avg }) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: '#888780', width: '60px', flexShrink: 0 }}>{cat}</span>
              <div style={{ flex: 1, height: '8px', background: '#f1efe8', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${avg * 100}%`, height: '100%', background: '#3b6d11', borderRadius: '4px' }} />
              </div>
              <span style={{ fontSize: '11px', color: '#5f5e5a', width: '32px', textAlign: 'right' }}>{avg}</span>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '0.5px solid #d3d1c7', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#5f5e5a', marginBottom: '12px' }}>Top species this week</div>
          {topSpecies.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#888780' }}>No detections yet</div>
          ) : topSpecies.map(([name, count]) => (
            <div key={name} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '5px 0', borderBottom: '0.5px solid #f1efe8'
            }}>
              <div style={{ flex: 1, fontSize: '12px', color: '#2c2c2a' }}>{name}</div>
              <div style={{ fontSize: '12px', fontWeight: '500', color: '#3b6d11' }}>{count}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '0.5px solid #d3d1c7', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '500', color: '#5f5e5a', marginBottom: '12px' }}>Insect activity (night ACI)</div>
          {nightLogs.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#888780' }}>No night recordings yet</div>
          ) : nightLogs.map((log, i) => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: '#888780', width: '60px', flexShrink: 0 }}>
                {i === 0 ? 'Tonight' : i === 1 ? 'Last night' : '2 nights ago'}
              </span>
              <div style={{ flex: 1, height: '8px', background: '#f1efe8', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${log.aci_score * 100}%`, height: '100%', background: '#854f0b', borderRadius: '4px' }} />
              </div>
              <span style={{ fontSize: '11px', color: '#854f0b', width: '32px', textAlign: 'right' }}>{log.aci_score}</span>
            </div>
          ))}
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#888780', lineHeight: '1.5' }}>
            Night ACI proxy — higher = more insect chorus activity
          </div>
        </div>

      </div>
    </div>
  )
}