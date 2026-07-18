/* global process */
// Report Share Cards v1 — per-report OG meta on the permalink. The app is a client-rendered Vite
// PWA, so crawlers (Slack / iMessage / Twitter) read <head> without running JS and see nothing.
// vercel.json rewrites /node/:id/report/:date → here (an INTERNAL rewrite: the browser URL stays
// the permalink, so real users still boot the SPA and its router renders NodeReportPage). This
// function fetches the SPA shell and injects per-report og:/twitter: meta read from the node_reports
// row. Grounded only in the report (place + prose); no person data; public/unauth.

const enc = encodeURIComponent

function cadenceOf(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'daily'
  if (/^\d{4}-(winter|spring|summer|autumn)$/.test(key)) return 'seasonal'
  if (/^\d{4}$/.test(key)) return 'annual'
  return null
}

function periodLabel(key) {
  if (cadenceOf(key) === 'daily') {
    const d = new Date(`${key}T00:00:00.000Z`)
    return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  const s = /^(\d{4})-(winter|spring|summer|autumn)$/.exec(key)
  if (s) return `${s[2][0].toUpperCase()}${s[2].slice(1)} ${s[1]}`
  return key
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function firstLines(narrative, max = 200) {
  const t = String(narrative || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

export default async function handler(req, res) {
  const id = req.query?.id
  const date = req.query?.date
  const origin = `https://${req.headers.host}`

  // Always serve the working SPA shell; layer per-report meta on top when the report exists.
  let html
  try {
    const shell = await fetch(`${origin}/index.html`)
    html = await shell.text()
  } catch {
    return res.status(500).send('shell fetch failed')
  }

  try {
    const cadence = id && date ? cadenceOf(date) : null
    if (cadence) {
      const url = process.env.VITE_SUPABASE_URL
      const key = process.env.VITE_SUPABASE_ANON_KEY
      const r = await fetch(
        `${url}/rest/v1/node_reports?node_id=eq.${id}&cadence=eq.${cadence}&period_key=eq.${enc(date)}&select=payload,narrative,generated_at`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      )
      const row = r.ok ? (await r.json())[0] : null
      if (row?.narrative) {
        const place = row.payload?.node?.place_label || row.payload?.node?.name || 'This place'
        const title = `${place}, ${periodLabel(date)}`
        const desc = firstLines(row.narrative)
        const pageUrl = `${origin}/node/${id}/report/${enc(date)}`
        const img = `${origin}/api/og-report?node_id=${id}&period_key=${enc(date)}&v=${enc(row.generated_at)}`
        const meta = [
          `<meta property="og:type" content="article" />`,
          `<meta property="og:site_name" content="Magora" />`,
          `<meta property="og:title" content="${esc(title)}" />`,
          `<meta property="og:description" content="${esc(desc)}" />`,
          `<meta property="og:url" content="${esc(pageUrl)}" />`,
          `<meta property="og:image" content="${esc(img)}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="${esc(title)}" />`,
          `<meta name="twitter:description" content="${esc(desc)}" />`,
          `<meta name="twitter:image" content="${esc(img)}" />`,
        ].join('\n    ')
        // Replace the default <title> and inject the per-report meta before </head>.
        html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} · Magora</title>`)
        html = html.replace('</head>', `    ${meta}\n  </head>`)
      }
    }
  } catch {
    // On any failure, fall through and serve the un-augmented shell (SPA still works).
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Do NOT cache the shell: it must always emit the CURRENT og:image URL (v=generated_at). A stale
  // shell would emit a stale URL, and platforms cache the image by URL — so a regenerated report
  // would never re-unfurl. The image itself is immutable-cached per versioned URL (see og-report.js).
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(html)
}
