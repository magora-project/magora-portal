async function supabaseFetch(supabaseUrl, apiKey, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
    }
  })
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data) ? (data[0] || null) : data
}

async function getEbirdContext(lat, lon, ebirdKey, detectedSpecies) {
  try {
    const url = `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat}&lng=${lon}&dist=25&maxResults=50&back=7`
    const res = await fetch(url, { headers: { 'X-eBirdApiToken': ebirdKey } })
    if (!res.ok) return null
    const obs = await res.json()
    if (!obs?.length) return null

    const uniqueSpecies = [...new Map(obs.map(o => [o.speciesCode, o])).values()]
    const speciesRichness = uniqueSpecies.length

    // Check if detected species appears in recent eBird observations
    const normalised = detectedSpecies?.toLowerCase()
    const match = uniqueSpecies.find(o => o.comName?.toLowerCase() === normalised)
    const speciesConfirmed = !!match
    const lastSeen = match?.obsDt
      ? `last reported ${Math.round((Date.now() - new Date(match.obsDt)) / 86400000)} days ago`
      : null

    // Pick 4 co-occurring species (excluding the detected one) as community context
    const coOccurring = uniqueSpecies
      .filter(o => o.comName?.toLowerCase() !== normalised)
      .slice(0, 4)
      .map(o => o.comName)

    return { speciesRichness, speciesConfirmed, lastSeen, coOccurring }
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    detection_id,
    species_name: fallbackSpecies,
    scientific_name: fallbackSci,
    confidence: fallbackConf,
    location: fallbackLocation,
    is_dawn_chorus: fallbackDawn,
  } = req.body

  if (!detection_id && !fallbackSpecies) {
    return res.status(400).json({ error: 'detection_id or species_name required' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const apiKey      = process.env.VITE_SUPABASE_ANON_KEY
  const ebirdKey    = process.env.EBIRD_API_KEY

  // --- Fetch enriched context from Supabase in parallel ---
  const [detection, ...rest] = await Promise.all([
    detection_id
      ? supabaseFetch(supabaseUrl, apiKey, `detections?id=eq.${detection_id}&select=*`)
      : Promise.resolve(null),
  ])

  const speciesName = detection?.species_name || fallbackSpecies

  const [species, node] = await Promise.all([
    speciesName
      ? supabaseFetch(supabaseUrl, apiKey, `species?common_name=eq.${encodeURIComponent(speciesName)}&select=*`)
      : Promise.resolve(null),
    detection?.node_id
      ? supabaseFetch(supabaseUrl, apiKey, `nodes?id=eq.${detection.node_id}&select=*`)
      : Promise.resolve(null),
  ])

  const habitat = detection?.node_id
    ? await supabaseFetch(supabaseUrl, apiKey, `node_habitat?node_id=eq.${detection.node_id}&select=*`)
    : null

  // --- eBird regional context ---
  const coords = node?.location?.coordinates  // [lon, lat]
  const ebird = (ebirdKey && coords)
    ? await getEbirdContext(coords[1], coords[0], ebirdKey, speciesName)
    : null

  // --- Resolve values ---
  const confPct        = Math.round((detection?.confidence ?? fallbackConf ?? 0) * 100)
  const isDawn         = detection?.dawn_chorus_window ?? detection?.is_dawn_chorus ?? fallbackDawn
  const aciScore       = detection?.aci_score ?? null
  const minutesFromSun = detection?.minutes_from_sunrise ?? null
  const season         = detection?.season ?? null
  const phenoWeek      = detection?.phenological_week ?? null
  const sciName        = species?.scientific_name || fallbackSci || ''

  // --- Build prompt sections ---
  const timingLine = minutesFromSun != null
    ? `${Math.abs(minutesFromSun)} min ${minutesFromSun < 0 ? 'before' : 'after'} sunrise${isDawn ? ' · dawn chorus window' : ''}`
    : isDawn ? 'dawn chorus window' : null

  const seasonLine = season && phenoWeek
    ? `${season.replace(/_/g, ' ')} · phenological week ${phenoWeek}`
    : null

  const speciesLines = species ? [
    species.guild            && `Guild: ${species.guild.replace(/_/g, ' ')}`,
    species.migratory_status && `Migratory status: ${species.migratory_status.replace(/_/g, ' ')}`,
    species.indicator_status && species.indicator_status !== 'none'
      && `Indicator: ${species.indicator_status.replace(/_/g, ' ')}`,
    species.family           && `Family: ${species.family}`,
    species.iucn_status      && `IUCN: ${species.iucn_status}`,
  ].filter(Boolean) : []

  const habitatLines = [
    node?.elevation_m              && `Elevation: ${node.elevation_m}m`,
    habitat?.vegetation_structure  && `Vegetation: ${habitat.vegetation_structure.replace(/_/g, ' ')}`,
    habitat?.dominant_vegetation   && `Dominant plants: ${habitat.dominant_vegetation}`,
    habitat?.water_proximity       && `Water: ${habitat.water_proximity.replace(/_/g, ' ')}`,
    habitat?.disturbance_level     && `Disturbance: ${habitat.disturbance_level}`,
    habitat?.aspect                && `Aspect: ${habitat.aspect}`,
  ].filter(Boolean)

  const ebirdLines = ebird ? [
    `Species richness nearby: ${ebird.speciesRichness} species in last 7 days (25km radius)`,
    ebird.speciesConfirmed
      ? `This species: confirmed in area${ebird.lastSeen ? ` · ${ebird.lastSeen}` : ''}`
      : `This species: not in recent eBird reports nearby — notable detection`,
    ebird.coOccurring?.length
      ? `Also active nearby: ${ebird.coOccurring.join(', ')}`
      : null,
  ].filter(Boolean) : []

  const aciLabel = aciScore != null
    ? `${aciScore} (${aciScore > 0.65 ? 'High' : aciScore > 0.5 ? 'Moderate' : 'Low'} soundscape complexity)`
    : null

  const locationName = habitat?.notes?.split('.')[0]
    || node?.name
    || fallbackLocation
    || 'the American West'

  const sections = [
    `You are an ecological field interpreter for the Magora Bird Project — a distributed acoustic biodiversity monitoring network in the American West.`,
    ``,
    `DETECTION`,
    `Species: ${speciesName}${sciName ? ` (${sciName})` : ''}`,
    `Confidence: ${confPct}%`,
    timingLine  && `Timing: ${timingLine}`,
    seasonLine  && `Season: ${seasonLine}`,
    ``,
    speciesLines.length  && `SPECIES PROFILE\n${speciesLines.join('\n')}`,
    ``,
    habitatLines.length  && `HABITAT — ${locationName}\n${habitatLines.join('\n')}`,
    ``,
    aciLabel             && `ACOUSTIC CONTEXT\nACI: ${aciLabel}`,
    ``,
    ebirdLines.length    && `REGIONAL BASELINE (eBird · 25km · last 7 days)\n${ebirdLines.join('\n')}`,
    ``,
    `Write 2–3 sentences of ecological insight about what this detection reveals. Be fun, witty, and a little comical — like a nature documentary narrated by someone with a great sense of humor — but keep every fact accurate and grounded. Draw on the species profile, habitat, timing, season, and regional context when available. If the species wasn't in recent eBird reports, note that as interesting. Don't open with the species name or "This detection".`,
  ]

  const prompt = sections
    .filter(l => l !== false && l != null)
    .join('\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 280,
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
