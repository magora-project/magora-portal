// Proxy for the Macaulay Library catalog (Cornell Lab) — same source as Merlin.
// Browser fetches are blocked by CORS so we proxy server-side.
export default async function handler(req, res) {
  const { query } = req.query
  if (!query) return res.status(400).json({ error: 'query param required' })

  try {
    const url = `https://search.macaulaylibrary.org/catalog.json?searchField=species&q=${encodeURIComponent(query)}&mediaType=audio&count=10&sort=rating_rank`
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.macaulaylibrary.org/',
      },
    })
    if (!upstream.ok) return res.status(upstream.status).json({ error: `upstream ${upstream.status}` })
    const data = await upstream.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
