export default async function handler(req, res) {
  const { query } = req.query
  if (!query) return res.status(400).json({ error: 'query param required' })

  try {
    const url = `https://www.xeno-canto.org/api/2/recordings?query=${encodeURIComponent(query)}`
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'magora-portal/1.0 (noahwaldron55@gmail.com)' },
      redirect: 'follow',
    })
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream error' })
    const data = await upstream.json()
    res.setHeader('Cache-Control', 's-maxage=3600')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
