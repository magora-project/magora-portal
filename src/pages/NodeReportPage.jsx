import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Node Phenology Report v1 — public permalink (read-only). Renders a CACHED node report for
// sharing: /node/:id/report/:date. The node speaks its own daily record in the first person
// ("every place is speaking / the node is the author"). Reads node_reports directly (public-read
// RLS); it never generates and never writes. Place data only — no person data is stored on, or
// read from, node_reports.

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

function prettyDate(periodKey) {
  const d = new Date(`${periodKey}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return periodKey
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function NodeReportPage() {
  const { id, date } = useParams()
  const [report, setReport] = useState(null) // { narrative, payload, ... } | null
  const [node, setNode] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    Promise.all([
      supabase.from('node_reports')
        .select('narrative, payload, voice, generated_at')
        .eq('node_id', id).eq('cadence', 'daily').eq('period_key', date)
        .maybeSingle(),
      supabase.from('nodes').select('name').eq('id', id).maybeSingle(),
    ]).then(([{ data: r }, { data: n }]) => {
      if (cancelled) return
      setReport(r || null)
      setNode(n || null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, date])

  const placeName = report?.payload?.node?.place_label || node?.name || 'This place'
  const act = report?.payload?.activity
  const newSpecies = report?.payload?.new_species || []

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px 64px' }}>
        <Link to={`/node/${id}`} style={{ fontSize: '13px', color: C.accentLight, textDecoration: 'none', fontWeight: 600 }}>
          ← {placeName}
        </Link>

        <p style={{ fontSize: '12px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '28px 0 6px' }}>
          Every place is speaking
        </p>
        <h1 style={{ fontSize: '26px', fontWeight: 700, margin: '0 0 4px', lineHeight: 1.25 }}>{placeName}</h1>
        <p style={{ fontSize: '14px', color: C.textMuted, margin: '0 0 28px' }}>Its own record of {prettyDate(date)}</p>

        {loading ? (
          <p style={{ color: C.textMuted }}>Gathering the day…</p>
        ) : !report?.narrative ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px' }}>
            <p style={{ color: C.textSub, lineHeight: 1.7, margin: 0 }}>
              This place has not published a report for this day yet.
            </p>
          </div>
        ) : (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '22px 24px' }}>
              {report.narrative.split(/\n\n+/).map((para, i) => (
                <p key={i} style={{ fontSize: '16px', color: C.textSub, lineHeight: 1.8, margin: i === 0 ? 0 : '14px 0 0', fontStyle: 'italic' }}>{para}</p>
              ))}
            </div>

            {act && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '18px' }}>
                <Stat label="Detections" value={act.total_detections} />
                <Stat label="Species" value={act.distinct_species} />
                {newSpecies.length > 0 && <Stat label="New here" value={newSpecies.length} />}
              </div>
            )}

            <p style={{ fontSize: '12px', color: C.textMuted, marginTop: '24px' }}>
              A Magora node phenology report. The place is the author.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '10px 16px', minWidth: '84px' }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color: C.text }}>{value}</div>
      <div style={{ fontSize: '11px', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}
