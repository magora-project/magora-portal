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

const C = {
  bg: '#0d2818',
  card: '#163d22',
  border: '#1f5230',
  accent: '#1D9E75',
  accentLight: '#5DCAA5',
  text: '#f0ede8',
  textSub: '#c8e6d0',
  textMuted: '#7aad8a',
  radius: '16px',
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: C.radius, padding: '18px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '36px', fontWeight: '600', color: C.accentLight, lineHeight: 1, marginBottom: '6px' }}>{value}</div>
      <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sub}</div>
    </div>
  )
}

export default function MapPage() {
  const [aciLogs, setAciLogs] = useState([])
  const [detections, setDetections] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    const { data: nodeData } = await supabase
      .from('nodes').select('*').eq('is_active', true)
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

  const latestAci = aciLogs[0]?.aci_score ?? null
  const aciLabel = latestAci === null ? '—' :
    latestAci > 0.65 ? 'High' :
    latestAci > 0.50 ? 'Moderate' : 'Low'

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
        <StatCard label="Active Nodes" value={nodes.length} sub="Online now" />
        <StatCard label="Detections" value={detections.length} sub="Last 50 shown" />
        <StatCard
          label="Latest ACI"
          value={latestAci ? latestAci.toFixed(3) : '—'}
          sub={`${aciLabel} activity`}
        />
        <StatCard
          label="Last Updated"
          value={aciLogs[0] ? toMountainTime(aciLogs[0].recorded_at, false) : '—'}
          sub="Auto-refreshes 30s"
        />
      </div>

      {/* Map placeholder */}
      <div style={{
        background: C.card, borderRadius: '16px', height: '260px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${C.border}`, marginBottom: '20px',
      }}>
        <div style={{ textAlign: 'center', color: C.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🗺️</div>
          <div style={{ fontSize: '14px', fontWeight: '700', color: C.textSub }}>Interactive map coming soon</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            {nodes.length} node{nodes.length !== 1 ? 's' : ''} registered
          </div>
        </div>
      </div>

      {/* ACI feed */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Live acoustic activity</span>
          <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Refreshes every 30s</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {aciLogs.map(log => {
            const level = log.aci_score > 0.65 ? 'High' : log.aci_score > 0.50 ? 'Moderate' : 'Low'
            return (
              <div key={log.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: '20px', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: '14px',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: C.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '20px', flexShrink: 0,
                  border: `1px solid ${C.border}`,
                }}>🦟</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>
                    {level} insect activity
                  </div>
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

      {/* Detections */}
      <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '18px', fontWeight: '700', color: C.text }}>Recent bird detections</span>
        <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live from Supabase</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>Loading...</div>
      ) : detections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>No detections yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {detections.map(d => (
            <div key={d.id} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: '20px', padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: '14px',
            }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: C.bg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '20px', flexShrink: 0,
                border: `1px solid ${C.border}`,
              }}>🐦</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: '700', color: C.text }}>
                  {d.species_name || d.raw_label || 'Unknown'}
                </div>
                <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span>{toMountainTime(d.detected_at)}</span>
                  {d.is_dawn_chorus && (
                    <span style={{ color: '#7dd3fc' }}>🌅 Dawn chorus</span>
                  )}
                </div>
              </div>
              <div style={{
                fontSize: '13px', fontWeight: '700', padding: '4px 12px',
                borderRadius: '20px',
                background: d.confidence > 0.5 ? '#0d2818' : '#1a2810',
                color: d.confidence > 0.5 ? C.accentLight : '#86efac',
                border: `1px solid ${d.confidence > 0.5 ? C.accent : '#22c55e'}`,
              }}>
                {d.confidence ? (d.confidence * 100).toFixed(0) + '%' : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
