// Fixture answers for the app's own /api/* functions and the few third-party APIs the pages call
// (Wikipedia, GBIF, iNaturalist, Nominatim). handle({ method, url, headers, body }) ->
// { status, headers, body }. Nothing here reaches a network. An endpoint nobody answers is recorded in
// `unknown`, and fails the capture.
//
// Species photos, iNaturalist photos and Xeno-canto recordings are deliberately absent: each would be one
// more host to serve, so the cards show their placeholder art and "No recording".

export const unknown = new Set()

const CORS = { 'access-control-allow-origin': '*' }
const json = (status, value) => ({
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(value),
})

const taxon = (id, name, common, iconic, count) => ({
  id, name, common, iconic, rank: 'species', count, threatened: false, photo: null, photo_attribution: null, wikipedia: null,
})
const AVES = [
  taxon(1, 'Turdus migratorius', 'American Robin', 'Aves', 120),
  taxon(2, 'Poecile atricapillus', 'Black-capped Chickadee', 'Aves', 80),
  taxon(3, 'Pica hudsonia', 'Black-billed Magpie', 'Aves', 60),
]
const PLANTAE = [taxon(4, 'Pinus ponderosa', 'Ponderosa Pine', 'Plantae', 40), taxon(5, 'Rosa woodsii', 'Woods’ Rose', 'Plantae', 30)]
const MAMMALIA = [taxon(6, 'Odocoileus hemionus', 'Mule Deer', 'Mammalia', 25)]

export function handle({ method, url }) {
  const u = new URL(url)
  const p = u.pathname

  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: { ...CORS, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' },
      body: '',
    }
  }

  if (u.hostname === 'en.wikipedia.org') {
    const m = p.match(/^\/api\/rest_v1\/page\/summary\/(.+)$/)
    if (m) {
      const name = decodeURIComponent(m[1])
      return json(200, { title: name, extract: `The ${name} is a fixture species. It lives only in test data, and sings on cue.` })
    }
  } else if (u.hostname === 'api.gbif.org') {
    if (p === '/v1/species/match') return json(200, { usageKey: 2490719, speciesKey: 2490719 })
  } else if (u.hostname === 'api.inaturalist.org') {
    return json(200, { total_results: 0, results: [] })
  } else if (u.hostname === 'give.themethodproject.org') {
    return {
      status: 200, headers: { ...CORS, 'content-type': 'text/javascript; charset=utf-8' },
      body: '/* fixture: the donation widget is not loaded */',
    }
  } else if (u.hostname === 'nominatim.openstreetmap.org') {
    return json(200, { name: 'Fixtureville', address: { city: 'Fixtureville', state: 'Colorado' } })
  } else {
    if (p === '/api/insight') {
      return json(200, { insight: 'A fixture insight: the soundscape here is busy at dawn, and the robin is leading it.' })
    }
    if (p === '/api/pulse-ondemand') {
      return json(200, {
        pulse: null, selection: null,
        selected: { kind: 'activity_spike', evidence: { ratio: 1.6, window_count: 42, baseline_days: 14 } },
      })
    }
    if (p === '/api/narrative-ondemand') {
      return json(200, {
        pulse: { kind: 'activity_spike' }, voice: 'node',
        narrative: { text: 'I have been busier than usual this week. The dawn belongs to the robins.', voice: 'node' },
      })
    }
    if (p === '/api/report-ondemand') {
      return json(200, {
        report: {
          narrative: 'This morning the meadow woke early. A robin sang before the light.',
          payload: { period_key: '2026-11-20' },
        },
      })
    }
    if (p === '/api/inat-nearby') {
      const taxa = [...AVES, ...PLANTAE, ...MAMMALIA]
      return json(200, {
        location: { lat: 40.0, lon: -105.3, radius_km: 5 }, total_species: 1234, returned: taxa.length, taxa,
        groups: { Aves: AVES, Plantae: PLANTAE, Mammalia: MAMMALIA }, source: 'iNaturalist',
        attribution: 'Research-grade observations © the iNaturalist community (CC-licensed)',
      })
    }
    if (p === '/api/xeno-canto') return json(404, { error: 'no recording in fixtures' })
    if (p === '/api/regional-species') return json(200, { species: ['American Robin', 'Black-capped Chickadee'] })
  }

  unknown.add(`${method} ${u.hostname}${p}`)
  return json(404, {})
}
