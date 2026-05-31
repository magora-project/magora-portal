export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { species_name, scientific_name, confidence, location, is_dawn_chorus, aci_score } = req.body

  if (!species_name) {
    return res.status(400).json({ error: 'species_name required' })
  }

  const confPct = Math.round((confidence || 0) * 100)
  const prompt = `A bird acoustic monitoring sensor detected a ${species_name}${scientific_name ? ` (${scientific_name})` : ''} in ${location || 'an unknown location'} with ${confPct}% confidence${is_dawn_chorus ? ' during the dawn chorus' : ''}${aci_score ? `. The Acoustic Complexity Index at time of detection was ${aci_score}` : ''}.

Write 2–3 sentences of ecological insight about this detection — what it tells us about the habitat, season, or this species' behavior. Be specific and scientifically grounded but accessible. Don't open with the species name or "This detection".`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    console.error('Claude API error:', err)
    return res.status(502).json({ error: 'Claude API error' })
  }

  const data = await response.json()
  return res.status(200).json({ insight: data.content[0].text })
}
