export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' })

  const ebirdKey = process.env.EBIRD_API_KEY
  if (!ebirdKey) return res.status(500).json({ error: 'eBird API key not configured' })

  try {
    const r = await fetch(
      `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat}&lng=${lon}&dist=50&maxResults=10000&back=30`,
      { headers: { 'X-eBirdApiToken': ebirdKey } }
    )
    if (!r.ok) return res.status(502).json({ error: `eBird error: ${r.status}` })
    const obs = await r.json()
    if (!Array.isArray(obs) || obs.length === 0) {
      return res.status(200).json({ species: [], count: 0 })
    }
    const seen = new Map()
    for (const o of obs) {
      if (o.speciesCode && o.comName && !seen.has(o.speciesCode)) {
        seen.set(o.speciesCode, o.comName)
      }
    }
    const species = [...seen.values()]
    return res.status(200).json({ species, count: species.length })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
