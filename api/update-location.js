export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lat, lon, node_name = 'birdnode1' } = req.body

  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' })

  const response = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/nodes?name=eq.${encodeURIComponent(node_name)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ location: `POINT(${lon} ${lat})` }),
    }
  )

  if (!response.ok) {
    const detail = await response.text()
    console.error('Supabase error:', detail)
    return res.status(502).json({ error: 'Supabase update failed' })
  }

  return res.status(200).json({ ok: true, node: node_name, lat: parseFloat(lat), lon: parseFloat(lon) })
}
