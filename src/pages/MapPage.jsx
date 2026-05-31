import { useEffect, useState } from 'react'
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

export default function MapPage() {
  const [aciLogs, setAciLogs] = useState([])
  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    const { data: nodeData } = await supabase
      .from('nodes')
      .select('*')
      .eq('is_active', true)

    const { data: detectionData } = await supabase
      .from('detections')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(50)

    const { data: aciData } = await supabase
      .from('aci_logs')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(10)

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

  const latestAci = aciLogs[0]?.aci_score ?? null
  const aciLabel = latestAci === null ? '—' :
    latestAci > 0.65 ? 'High' :
    latestAci > 0.50 ? 'Moderate' : 'Low'

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px',
        marginBottom: '20px'
      }}>
        {[
          { label: 'Active nodes', value: nodes.length, sub: 'online now' },
          { label: 'Detections', value: detections.length, sub: 'last 50 shown' },
          { label: 'Latest ACI', value: latestAci ? latestAci.toFixed(3) : '—', sub: `${aciLabel} activity` },
          { label: 'Last updated', value: aciLogs[0] ? toMountainTime(aciLogs[0].recorded_at, false) : '—', sub: 'auto-refreshes 30s' },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{
            background: '#fff', border: '0.5px solid #d3d1c7',
            borderRadius: '8px', padding: '12px 14px'
          }}>
            <div style={{ fontSize: '11px', color: '#5f5e5a', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: '500', color: '#2c2c2a' }}>{value}</div>
            <div style={{ fontSize: '11px', color: '#888780', marginTop: '2px' }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: '#e8e4da', borderRadius: '12px', height: '280px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '0.5px solid #d3d1c7', marginBottom: '20px', position: 'relative'
      }}>
        <div style={{ textAlign: 'center', color: '#5f5e5a' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🗺️</div>
          <div style={{ fontSize: '14px', fontWeight: '500' }}>Interactive map coming soon</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            {nodes.length} node{nodes.length !== 1 ? 's' : ''} registered
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: '500' }}>Live acoustic activity</span>
          <span style={{ fontSize: '11px', color: '#888780' }}>Refreshes every 30s</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          {aciLogs.map(log => (
            <div key={log.id} style={{
              background: '#fff', border: '0.5px solid #d3d1c7',
              borderRadius: '8px', padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: '12px'
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                background: '#f5f0e8', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '16px', flexShrink: 0
              }}>🦟</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '500' }}>
                  {log.aci_score > 0.65 ? 'High' : log.aci_score > 0.50 ? 'Moderate' : 'Low'} insect activity
                </div>
                <div style={{ fontSize: '11px', color: '#888780', marginTop: '1px' }}>
                  {toMountainTime(log.recorded_at)} · {log.time_category} · ACI {log.aci_score}
                </div>
              </div>
              <div style={{ flex: 0, width: '80px' }}>
                <div style={{ height: '6px', background: '#f1efe8', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${log.aci_score * 100}%`, height: '100%', background: '#854f0b', borderRadius: '3px' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: '500' }}>Recent bird detections</span>
        <span style={{ fontSize: '11px', color: '#888780' }}>Live from Supabase</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888780' }}>Loading...</div>
      ) : detections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888780' }}>No detections yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {detections.map(d => (
            <div key={d.id} style={{
              background: '#fff', border: '0.5px solid #d3d1c7',
              borderRadius: '8px', padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: '12px'
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                background: '#eaf3de', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '16px', flexShrink: 0
              }}>🐦</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '500' }}>{d.species_name || d.raw_label || 'Unknown'}</div>
                <div style={{ fontSize: '11px', color: '#888780', marginTop: '1px' }}>
                  {toMountainTime(d.detected_at)} · {d.is_dawn_chorus ? 'Dawn chorus' : 'Standard detection'}
                </div>
              </div>
              <div style={{
                fontSize: '12px', fontWeight: '500', padding: '3px 8px',
                borderRadius: '4px',
                background: d.confidence > 0.5 ? '#eaf3de' : '#faeeda',
                color: d.confidence > 0.5 ? '#27500a' : '#633806'
              }}>
                {d.confidence ? d.confidence.toFixed(2) : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}