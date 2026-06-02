async function dbFetch(supabaseUrl, apiKey, path, asArray = false) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` }
    })
    if (!res.ok) return asArray ? [] : null
    const data = await res.json()
    if (asArray) return Array.isArray(data) ? data : []
    return Array.isArray(data) ? (data[0] || null) : data
  } catch { return asArray ? [] : null }
}

async function getEbirdContext(lat, lon, ebirdKey, detectedSpecies) {
  try {
    const res = await fetch(
      `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat}&lng=${lon}&dist=25&maxResults=50&back=7`,
      { headers: { 'X-eBirdApiToken': ebirdKey } }
    )
    if (!res.ok) return null
    const obs = await res.json()
    if (!obs?.length) return null

    const unique = [...new Map(obs.map(o => [o.speciesCode, o])).values()]
    const norm = detectedSpecies?.toLowerCase()
    const match = unique.find(o => o.comName?.toLowerCase() === norm)
    const daysSince = match?.obsDt
      ? Math.round((Date.now() - new Date(match.obsDt)) / 86400000)
      : null

    return {
      richness: unique.length,
      confirmed: !!match,
      daysSince,
      nearby: unique.filter(o => o.comName?.toLowerCase() !== norm).slice(0, 5).map(o => o.comName),
    }
  } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

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

  // --- Core fetch ---
  const detection = detection_id
    ? await dbFetch(supabaseUrl, apiKey, `detections?id=eq.${detection_id}&select=*`)
    : null

  const speciesName = detection?.species_name || fallbackSpecies
  const nodeId      = detection?.node_id

  // --- Parallel enrichment queries ---
  const [species, node] = await Promise.all([
    speciesName
      ? dbFetch(supabaseUrl, apiKey, `species?common_name=eq.${encodeURIComponent(speciesName)}&select=*`)
      : null,
    nodeId
      ? dbFetch(supabaseUrl, apiKey, `nodes?id=eq.${nodeId}&select=*`)
      : null,
  ])

  const [habitat, coOccurring, longitudinal, recentWindow] = await Promise.all([
    // Habitat context
    nodeId
      ? dbFetch(supabaseUrl, apiKey, `node_habitat?node_id=eq.${nodeId}&select=*`)
      : null,

    // Co-occurring species in same 15-min window
    detection?.detected_at && nodeId ? (async () => {
      const t = new Date(detection.detected_at)
      const lo = new Date(t - 15 * 60000).toISOString()
      const hi = new Date(t + 15 * 60000).toISOString()
      const rows = await dbFetch(supabaseUrl, apiKey,
        `detections?node_id=eq.${nodeId}&detected_at=gte.${lo}&detected_at=lte.${hi}&species_name=neq.${encodeURIComponent(speciesName)}&select=species_name&limit=10`,
        true)
      return [...new Set(rows.map(r => r.species_name).filter(Boolean))]
    })() : Promise.resolve([]),

    // Longitudinal: this species at this node in last 14 days + first ever detection
    speciesName && nodeId ? (async () => {
      const twoWeeks = new Date(Date.now() - 14 * 86400000).toISOString()
      const [recent, first, allRecent] = await Promise.all([
        dbFetch(supabaseUrl, apiKey,
          `detections?node_id=eq.${nodeId}&species_name=eq.${encodeURIComponent(speciesName)}&detected_at=gte.${twoWeeks}&select=detected_at&limit=200`,
          true),
        dbFetch(supabaseUrl, apiKey,
          `detections?node_id=eq.${nodeId}&species_name=eq.${encodeURIComponent(speciesName)}&select=detected_at&order=detected_at.asc&limit=1`),
        dbFetch(supabaseUrl, apiKey,
          `detections?node_id=eq.${nodeId}&detected_at=gte.${twoWeeks}&select=species_name&limit=500`,
          true),
      ])
      const uniqueSpecies = new Set(allRecent.map(d => d.species_name).filter(Boolean)).size
      const firstDate = first?.detected_at
        ? new Date(first.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : null
      return { recentCount: recent.length, firstDate, uniqueSpecies }
    })() : Promise.resolve(null),

    // Most recent window ACI
    nodeId && detection?.detected_at ? (async () => {
      const t = new Date(detection.detected_at)
      const lo = new Date(t - 30 * 60000).toISOString()
      const hi = new Date(t + 5 * 60000).toISOString()
      return dbFetch(supabaseUrl, apiKey,
        `aci_logs?node_id=eq.${nodeId}&recorded_at=gte.${lo}&recorded_at=lte.${hi}&select=aci_score,time_category&order=recorded_at.desc&limit=1`)
    })() : Promise.resolve(null),
  ])

  // eBird (non-blocking, runs in parallel with everything above via the same Promise.all would be ideal
  // but depends on node coords — fetch after node is available)
  const coords = node?.location?.coordinates
  const ebird = (ebirdKey && coords)
    ? await getEbirdContext(coords[1], coords[0], ebirdKey, speciesName)
    : null

  // --- Resolve values ---
  const confPct        = Math.round((detection?.confidence ?? fallbackConf ?? 0) * 100)
  const isDawn         = detection?.dawn_chorus_window ?? detection?.is_dawn_chorus ?? fallbackDawn
  const aciScore       = recentWindow?.aci_score ?? detection?.aci_score ?? null
  const timeCategory   = recentWindow?.time_category ?? null
  const minutesFromSun = detection?.minutes_from_sunrise ?? null
  const season         = detection?.season ?? null
  const phenoWeek      = detection?.phenological_week ?? null
  const sciName        = species?.scientific_name || fallbackSci || ''
  const locationLabel  = habitat?.notes?.split('.')[0] || node?.name || fallbackLocation || 'the American West'

  // --- Build prompt ---
  const timingDesc = (() => {
    if (minutesFromSun != null) {
      const rel = minutesFromSun < 0
        ? `${Math.abs(minutesFromSun)} minutes before sunrise`
        : `${minutesFromSun} minutes after sunrise`
      return `${rel}${isDawn ? ', within the dawn chorus window' : ''}`
    }
    if (isDawn) return 'during the dawn chorus window'
    return timeCategory ? `during the ${timeCategory.toLowerCase()} period` : null
  })()

  const seasonDesc = season && phenoWeek
    ? `${season.replace(/_/g, ' ')} (phenological week ${phenoWeek})`
    : null

  const longitudinalDesc = longitudinal ? [
    longitudinal.recentCount > 0
      ? `This species has been detected ${longitudinal.recentCount} time${longitudinal.recentCount !== 1 ? 's' : ''} at this node in the past 14 days.`
      : `This appears to be a rare or first detection of this species at this node recently.`,
    longitudinal.firstDate ? `First recorded here on ${longitudinal.firstDate}.` : null,
    `${longitudinal.uniqueSpecies} unique species detected at this node in the past 14 days.`,
  ].filter(Boolean).join(' ') : null

  const habitatDesc = [
    node?.elevation_m && `Elevation: ${node.elevation_m}m`,
    habitat?.vegetation_structure && `Vegetation structure: ${habitat.vegetation_structure.replace(/_/g, ' ')}`,
    habitat?.dominant_vegetation && `Dominant plants: ${habitat.dominant_vegetation}`,
    habitat?.water_proximity && `Water proximity: ${habitat.water_proximity.replace(/_/g, ' ')}`,
    habitat?.disturbance_level && `Disturbance level: ${habitat.disturbance_level}`,
    habitat?.aspect && `Aspect: ${habitat.aspect}`,
  ].filter(Boolean).join('; ')

  const speciesDesc = [
    species?.guild && `Foraging guild: ${species.guild.replace(/_/g, ' ')}`,
    species?.migratory_status && `Migratory status: ${species.migratory_status.replace(/_/g, ' ')}`,
    species?.indicator_status && species.indicator_status !== 'none' && `Ecological indicator: ${species.indicator_status.replace(/_/g, ' ')}`,
    species?.sensitivity_flag && `Conservation sensitivity: flagged`,
    species?.family && `Family: ${species.family}`,
    species?.iucn_status && `IUCN: ${species.iucn_status}`,
  ].filter(Boolean).join('; ')

  const soundscapeDesc = [
    aciScore != null && `ACI ${aciScore} (${aciScore > 0.65 ? 'high' : aciScore > 0.5 ? 'moderate' : 'low'} soundscape complexity)`,
    coOccurring.length > 0 && `Co-detected in same window: ${coOccurring.join(', ')}`,
    isDawn && `Dawn chorus active`,
  ].filter(Boolean).join('; ')

  const ebirdDesc = ebird ? [
    `${ebird.richness} species observed within 25km in the past 7 days`,
    ebird.confirmed
      ? `This species confirmed in the area${ebird.daysSince != null ? ` (last eBird report: ${ebird.daysSince} day${ebird.daysSince !== 1 ? 's' : ''} ago)` : ''}`
      : `This species NOT in recent eBird reports for this area — potentially notable`,
    ebird.nearby.length > 0 && `Also recently reported nearby: ${ebird.nearby.join(', ')}`,
  ].filter(Boolean).join('. ') : null

  const prompt = `You are a field ecologist working with the Magora Bird Project — a long-term acoustic biodiversity monitoring initiative based at a node in ${locationLabel}. You've been watching what lives here across seasons. You write for people who are genuinely curious about the natural world but aren't biologists. Your job is to interpret a specific ecological moment — not describe a species in general terms. Think out loud. Be specific. Be curious. Never be generic.

DETECTION
Species: ${speciesName}${sciName ? ` (${sciName})` : ''}
Confidence: ${confPct}%${timingDesc ? `\nTiming: ${timingDesc}` : ''}${seasonDesc ? `\nSeason: ${seasonDesc}` : ''}

${speciesDesc ? `SPECIES PROFILE\n${speciesDesc}` : ''}

${soundscapeDesc ? `SOUNDSCAPE AT THIS MOMENT\n${soundscapeDesc}` : ''}

${habitatDesc ? `THIS PLACE — ${locationLabel}\n${habitatDesc}` : ''}

${ebirdDesc ? `REGIONAL PICTURE (eBird · 25km · last 7 days)\n${ebirdDesc}` : ''}

${longitudinalDesc ? `PATTERN AT THIS NODE\n${longitudinalDesc}` : ''}

Write 3–4 sentences that synthesize these layers into a genuine ecological story about this specific moment. Your response must:
- Infer what this animal is most likely doing RIGHT NOW based on its guild, the time, and the season — be specific and behavioral, not general
- Connect it to at least one concrete plant, insect, soil, or structural habitat relationship relevant to this location
- Assess whether this detection is expected, surprising, or ecologically significant — and briefly say why
- Weave in one thread from the pattern being built at this node over time
- Sound like genuine curiosity and field observation, never a field guide entry
- Never open with the species name or "This detection"`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    console.error('Claude error:', await response.text())
    return res.status(502).json({ error: 'Claude API error' })
  }

  const data = await response.json()
  return res.status(200).json({ insight: data.content[0].text })
}
