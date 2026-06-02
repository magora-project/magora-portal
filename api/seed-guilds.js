// One-time endpoint to classify all species guild/migratory/indicator data via Claude.
// Call once after deploy, then it's safe to leave (it's idempotent).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const apiKey      = process.env.VITE_SUPABASE_ANON_KEY

  // Fetch all species with missing guild data
  const spRes = await fetch(
    `${supabaseUrl}/rest/v1/species?select=id,common_name,scientific_name,family,order_name&guild=is.null&limit=100`,
    { headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } }
  )
  const species = await spRes.json()

  if (!species.length) {
    return res.status(200).json({ message: 'All species already classified', updated: 0 })
  }

  const speciesList = species
    .map(s => `- ${s.common_name} (${s.scientific_name || 'unknown'})`)
    .join('\n')

  const prompt = `You are a professional ornithologist. Classify each bird species below for a biodiversity monitoring system in the American West (Wyoming/Colorado montane habitat).

For each species return EXACTLY this JSON format — one object per species, in a JSON array:
{
  "common_name": "exact name as given",
  "guild": one of: aerial_insectivore | foliage_gleaner | bark_prober | ground_forager | granivore | omnivore | raptor | nectarivore | frugivore | aquatic | other,
  "migratory_status": one of: resident | short_distance | long_distance | altitudinal | irruptive,
  "indicator_status": one of: climate_sensitive | habitat_specialist | habitat_generalist | disturbance_indicator | old_growth_indicator | none,
  "sensitivity_flag": true or false
}

Rules:
- guild = primary foraging strategy
- migratory_status = movement pattern (altitudinal = moves up/down slope seasonally)
- indicator_status = ecological indicator value (climate_sensitive if range/timing shifting with climate)
- sensitivity_flag = true if conservation concern, specialist, or climate-vulnerable

Species to classify:
${speciesList}

Return only the JSON array, no other text.`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return res.status(502).json({ error: 'Claude API error', detail: err })
  }

  const claudeData = await claudeRes.json()
  const raw = claudeData.content[0].text.trim()

  let classifications
  try {
    const jsonStr = raw.startsWith('[') ? raw : raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
    classifications = JSON.parse(jsonStr)
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse Claude response', raw })
  }

  // Update each species in Supabase
  const results = await Promise.all(
    classifications.map(async c => {
      const match = species.find(s => s.common_name === c.common_name)
      if (!match) return { name: c.common_name, status: 'not_found' }

      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/species?id=eq.${match.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            guild:            c.guild,
            migratory_status: c.migratory_status,
            indicator_status: c.indicator_status,
            sensitivity_flag: c.sensitivity_flag,
            auto_seeded:      true,
          }),
        }
      )
      return {
        name:   c.common_name,
        guild:  c.guild,
        status: updateRes.ok ? 'updated' : `error_${updateRes.status}`,
      }
    })
  )

  const updated = results.filter(r => r.status === 'updated').length
  return res.status(200).json({ updated, total: species.length, results })
}
