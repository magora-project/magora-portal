/* global process */
// Report Share Cards v1 — the og:image renderer. An edge function that turns a node_reports row
// into a ~1200×630 landscape social card (Satori / @vercel/og). Grounded ONLY in the report row
// (payload + narrative): node/place, the node's own CLOSING OPEN-WONDERING as the hero line, and
// one supporting stat. No person data. Public / unauthenticated (reads the public report).
//
// Written with Satori's OBJECT/VDOM element form (no JSX) so it lives in a plain `.js` file — Vercel
// auto-detects api/*.js as functions (not .jsx for this Vite project). The template is built so the
// deferred 1:1 / 9:16 crops are a straightforward added output of the same pipeline (size + reflow).
// The image URL is content-addressed on generated_at (?v=...) so a regenerated report yields a NEW
// URL — social platforms cache og:image by URL, not by bytes.

import { ImageResponse } from '@vercel/og'

export const config = { runtime: 'edge' }

const C = { bg: '#0d2818', accent: '#5DCAA5', text: '#f0ede8', sub: '#c8e6d0', muted: '#7aad8a' }
const el = (type, style, children) => ({ type, props: { style, children } })

function periodLabel(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(`${key}T00:00:00.000Z`)
    return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  const s = /^(\d{4})-(winter|spring|summer|autumn)$/.exec(key)
  if (s) return `${s[2][0].toUpperCase()}${s[2].slice(1)} ${s[1]}`
  return key
}

// The node's closing open-wondering = the last sentence of the narrative. The on-brand hero line.
function heroLine(narrative) {
  const t = String(narrative || '').trim()
  if (!t) return null
  const sentences = t.split(/(?<=[.?!])\s+/).filter(Boolean)
  let last = sentences[sentences.length - 1] || t
  if (last.length > 220) last = last.slice(0, 217).trimEnd() + '…'
  return last
}

async function fetchReport(nodeId, periodKey) {
  const cadence = /^\d{4}-\d{2}-\d{2}$/.test(periodKey) ? 'daily'
    : /^(\d{4})-(winter|spring|summer|autumn)$/.test(periodKey) ? 'seasonal'
    : /^\d{4}$/.test(periodKey) ? 'annual' : null
  if (!cadence) return null
  const res = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/node_reports?node_id=eq.${nodeId}&cadence=eq.${cadence}&period_key=eq.${encodeURIComponent(periodKey)}&select=payload,narrative,generated_at`,
    { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` } },
  )
  if (!res.ok) return null
  const rows = await res.json()
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url)
    const nodeId = searchParams.get('node_id')
    const periodKey = searchParams.get('period_key')
    if (!nodeId || !periodKey) return new Response('missing node_id / period_key', { status: 400 })

    const row = await fetchReport(nodeId, periodKey)
    const payload = row?.payload || {}
    const place = payload.node?.place_label || payload.node?.name || 'This place'
    const hero = heroLine(row?.narrative) || 'A place, listening to itself.'
    const act = payload.activity || {}
    const stat = act.total_detections > 0
      ? `${Number(act.total_detections).toLocaleString()} detections · ${act.distinct_species} species`
      : 'a quiet stretch'
    const period = periodLabel(periodKey)

    const card = el('div', {
      width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', background: C.bg, padding: '64px 72px', color: C.text,
    }, [
      el('div', { display: 'flex', fontSize: '24px', letterSpacing: '4px', color: C.accent, textTransform: 'uppercase', fontWeight: 700 }, 'Every place is speaking'),
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el('div', { display: 'flex', fontSize: '58px', fontWeight: 800, color: C.text, lineHeight: 1.05 }, place),
        el('div', { display: 'flex', fontSize: '30px', color: C.muted, marginTop: '8px' }, `Its own record of ${period}`),
      ]),
      el('div', { display: 'flex', fontSize: '40px', fontStyle: 'italic', color: C.sub, lineHeight: 1.35, maxWidth: '1056px' }, hero),
      el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }, [
        el('div', { display: 'flex', fontSize: '28px', color: C.sub }, stat),
        el('div', { display: 'flex', fontSize: '30px', fontWeight: 800, color: C.accent, letterSpacing: '2px' }, 'Magora'),
      ]),
    ])

    // The URL is pinned to generated_at (?v=), so the image for a given URL is immutable — cache it
    // hard at the CDN. A regenerated report is a NEW URL (new v=), which social platforms re-fetch.
    return new ImageResponse(card, {
      width: 1200,
      height: 630,
      headers: { 'cache-control': 'public, immutable, no-transform, max-age=31536000' },
    })
  } catch (e) {
    return new Response(`og render error: ${e.message}`, { status: 500 })
  }
}
