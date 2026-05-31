import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function MapPage() {
  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: nodeData } = await supabase
        .from('nodes')
        .select('*')
        .eq('is_active', true)

      const { data: detectionData } = await supabase
        .from('detections')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(20)

      setNodes(nodeData || [])
      setDetections(detectionData || [])
      setLoading(false)
    }
    fetchData()
  }, [])

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
          { label: 'Detections today', value: detections.length, sub: 'last 20 shown' },
          { label: 'Avg ACI', value: detections.length ? (detections.reduce((a,b) => a, 0)).toFixed(2) : '—', sub: 'acoustic complexity' },
          { label: 'Network', value: '1', sub: 'location monitored' },
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
        {nodes.map(node => (
          <div key={node.id} style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)'
          }}>
            <div style={{
              width: '14px', height: '14px', borderRadius: '50%',
              background: '#3b6d11', border: '2.5px solid #fff'
            }} title={node.name} />
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: '500' }}>Recent detections</span>
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
                  {new Date(d.detected_at).toLocaleTimeString()} · {d.is_dawn_chorus ? 'Dawn chorus' : 'Standard detection'}
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