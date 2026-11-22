// Fixture answers for the screenshot harness: a tiny PostgREST / GoTrue stand-in. Nothing here reaches
// a network. handle({ method, url, headers }) -> { status, headers, body }, where body is a string.
//
// The data is shaped by what the pages read (src/pages/*.jsx, src/lib/*.js, src/lib/auth.jsx) so every
// page renders in its populated state: one active and one offline node; detections in each confidence
// band (>=75, 55-74, <55); a dawn-chorus detection and a sensitive one; a mobile Listen and a Listen
// session by the listener `fixture`; and one signed-in user with a handle and one without.
//
// Every time is derived from NOW, which the capture also installs as the page clock.
// A table or RPC nobody answers is recorded in `unknown`, and fails the capture.

export const NOW = Date.parse('2026-11-20T12:00:00Z')
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString()
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Signed-in users. HANDLE_USER has a listeners row with a handle; NO_HANDLE_USER has a row without one.
export const HANDLE_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' }
export const NO_HANDLE_USER = { id: '00000000-0000-4000-8000-000000000002', email: 'nohandle@example.invalid' }
const OWNER_ID = HANDLE_USER.id

export const unknown = new Set()

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** A fake GoTrue session that expires in 2099, for the localStorage seed. */
export function makeSession(user) {
  const exp = 4070908800 // 2099-01-01
  return {
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp })}.fixture`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'fixture-refresh',
    user: authUser(user),
  }
}

function authUser(user) {
  return {
    id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-03-01T00:00:00Z',
  }
}

const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] })

const NODES = [
  {
    id: 'fixture-node-1', name: 'Fixture Meadow', habitat_type: 'montane-scrub', is_active: true,
    location: point(-105.27, 40.01), elevation_m: 1650, elevation_unit: 'ft', hardware_type: 'rpi-4',
    created_at: '2026-03-01T00:00:00Z', last_seen_at: iso(-10 * 1000), owner_id: OWNER_ID,
    banner_path: null, steward_handle: 'fixture',
    detections: [{ id: 'det-1' }],
  },
  {
    id: 'fixture-node-2', name: 'Fixture Ridge', habitat_type: 'forest', is_active: false,
    location: point(-106.1, 39.4), elevation_m: 2400, elevation_unit: 'ft', hardware_type: 'rpi-zero-2w',
    created_at: '2026-04-10T00:00:00Z', last_seen_at: iso(-3 * DAY), owner_id: '00000000-0000-4000-8000-0000000000aa',
    banner_path: null, steward_handle: null,
    detections: [{ id: 'det-3' }],
  },
]

const ROBIN = 'American Robin_Turdus migratorius'
const CHICKADEE = 'Black-capped Chickadee_Poecile atricapillus'
const TANAGER = 'Western Tanager_Piranga ludoviciana'

function detection(o) {
  return {
    insight: null, range_status: 'plausible', is_dawn_chorus: false, minutes_from_sunrise: null, season: 'late_fall',
    species: { guild: null, migratory_status: null, indicator_status: null, sensitivity_flag: false },
    ...o,
  }
}

const DETECTIONS = [
  // Confidence >= 75, and the dawn-chorus one.
  detection({
    id: 'det-1', node_id: 'fixture-node-1', species_name: 'American Robin', raw_label: ROBIN, confidence: 0.92,
    detected_at: '2026-11-20T07:30:00Z', is_dawn_chorus: true, minutes_from_sunrise: -25,
    species: { guild: 'ground_forager', migratory_status: 'short_distance', indicator_status: null, sensitivity_flag: false },
  }),
  // Second robin today, so the card reads "x2 today".
  detection({
    id: 'det-5', node_id: 'fixture-node-1', species_name: 'American Robin', raw_label: ROBIN, confidence: 0.81,
    detected_at: '2026-11-20T06:05:00Z', minutes_from_sunrise: -90,
  }),
  // Confidence 55-74.
  detection({
    id: 'det-2', node_id: 'fixture-node-1', species_name: 'Black-capped Chickadee', raw_label: CHICKADEE, confidence: 0.64,
    detected_at: '2026-11-20T05:40:00Z', minutes_from_sunrise: 140,
    species: { guild: 'foliage_gleaner', migratory_status: 'resident', indicator_status: null, sensitivity_flag: false },
  }),
  // Confidence < 55, and the sensitive one.
  detection({
    id: 'det-3', node_id: 'fixture-node-2', species_name: 'Western Tanager', raw_label: TANAGER, confidence: 0.41,
    detected_at: '2026-11-20T04:15:00Z', minutes_from_sunrise: 20,
    species: { guild: 'foliage_gleaner', migratory_status: 'long_distance', indicator_status: null, sensitivity_flag: true },
  }),
  // Older robins, in other seasons, for the species page.
  detection({
    id: 'det-6', node_id: 'fixture-node-1', species_name: 'American Robin', raw_label: ROBIN, confidence: 0.88,
    detected_at: '2026-06-02T06:00:00Z', season: 'breeding',
  }),
  detection({
    id: 'det-7', node_id: 'fixture-node-2', species_name: 'American Robin', raw_label: ROBIN, confidence: 0.77,
    detected_at: '2026-10-05T06:00:00Z', season: 'fall_migration',
  }),
]

// A heartbeat every 24 s, newest 10 s before NOW, so node 1 reads "Listening now". Node 2 stopped 3 days ago.
const ACI_LOGS = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `aci-1-${i}`, node_id: 'fixture-node-1', recorded_at: iso(-10 * 1000 - i * 24 * 1000),
    aci_score: [0.72, 0.68, 0.55, 0.61, 0.48, 0.52, 0.7, 0.66, 0.44, 0.58, 0.63, 0.5][i], time_category: 'dawn',
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `aci-2-${i}`, node_id: 'fixture-node-2', recorded_at: iso(-3 * DAY - i * 24 * 1000),
    aci_score: [0.4, 0.45, 0.42][i], time_category: 'midday',
  })),
]

const MOBILE = [{
  id: 'mob-1', detected_at: iso(-35 * MIN), lat: 40.05, lon: -105.2, listener_handle: 'fixture',
  species: [
    { common_name: 'Steller’s Jay', scientific_name: 'Cyanocitta stelleri', confidence: 0.86 },
    { common_name: 'Mountain Chickadee', scientific_name: 'Poecile gambeli', confidence: 0.58 },
  ],
  habitat_type: 'Forest', canopy_cover: 'Partial', water_present: true, disturbance_level: 'Low',
  insight: 'A jay and a chickadee share the same stand of trees this morning.', tz_offset: 0,
}]

const SESSIONS = [{
  id: 'sess-1', started_at: iso(-2 * HOUR), lat: 40.02, lon: -105.3, listener_handle: 'fixture', capture_count: 3,
  species: [
    { common_name: 'Dark-eyed Junco', scientific_name: 'Junco hyemalis', confidence: 0.79 },
    { common_name: 'Pine Siskin', scientific_name: 'Spinus pinus', confidence: 0.47 },
  ],
  habitat_type: 'Grassland', canopy_cover: 'Open', water_present: false, disturbance_level: 'none',
  insight: null,
}]

const LISTENERS = [
  {
    id: HANDLE_USER.id, handle: 'fixture', display_name: 'Fixture Listener', bio: 'Listens to the fixture hills at dawn.',
    home_region: 'Fixture Valley', avatar_path: null, follows_public: false, created_at: '2026-03-02T00:00:00Z',
  },
  {
    id: NO_HANDLE_USER.id, handle: null, display_name: null, bio: null, home_region: null,
    avatar_path: null, follows_public: false, created_at: '2026-05-02T00:00:00Z',
  },
]

const FOLLOWERS = [{
  listener_id: HANDLE_USER.id, handle: 'fixture', display_name: 'Fixture Listener', avatar_path: null,
  created_at: '2026-09-01T00:00:00Z',
}]

const REPORTS = [{
  node_id: 'fixture-node-1', cadence: 'daily', period_key: '2026-11-20', voice: 'node', generated_at: iso(-HOUR),
  narrative: 'This morning the meadow woke early. A robin sang before the light, and a chickadee answered from the scrub.\n\nBy midday the soundscape had settled into a steady hum.',
  payload: {
    node: { place_label: 'Fixture Meadow' }, period_key: '2026-11-20',
    activity: { total_detections: 42, distinct_species: 3 }, new_species: ['Western Tanager'],
  },
}]

const STATUS_EVENTS = [
  { node_id: 'fixture-node-1', status: 'online', at: iso(-2 * DAY), expected_interval_seconds: 24 },
  { node_id: 'fixture-node-2', status: 'offline', at: iso(-3 * DAY), expected_interval_seconds: 24 },
]

const TABLES = {
  nodes: NODES,
  detections: DETECTIONS,
  aci_logs: ACI_LOGS,
  public_mobile_detections: MOBILE,
  public_listen_sessions: SESSIONS,
  listeners: LISTENERS,
  public_journal_followers: FOLLOWERS,
  node_reports: REPORTS,
  node_status_events: STATUS_EVENTS,
  // Tables the pages read that are legitimately empty for these viewers.
  journal_follows: [],
  listener_follows: [],
}

const RPCS = {
  journal_follower_count: 3,
  listener_follower_count: 2,
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-range',
}
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json; charset=utf-8' }

const json = (status, value, extra = {}) => ({
  status, headers: { ...JSON_HEADERS, ...extra }, body: JSON.stringify(value),
})

// One filter: PostgREST `col=op.value`. Unsupported operators and embedded-resource filters
// (`detections.range_status=...`) match everything; the fixture rows already satisfy them.
function matches(row, col, expr) {
  if (col.includes('.')) return true
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const raw = expr.slice(dot + 1)
  const v = row[col]
  const cmp = () => (typeof v === 'number' ? [v, Number(raw)] : [String(v), raw])
  switch (op) {
    case 'eq': return String(v) === raw
    case 'neq': return String(v) !== raw
    case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v))
    case 'gte': { const [a, b] = cmp(); return a >= b }
    case 'gt': { const [a, b] = cmp(); return a > b }
    case 'lte': { const [a, b] = cmp(); return a <= b }
    case 'lt': { const [a, b] = cmp(); return a < b }
    default: return true
  }
}

function query(table, params) {
  let rows = TABLES[table].filter((row) => {
    for (const [col, expr] of params) {
      if (['select', 'order', 'limit', 'offset', 'or', 'and'].includes(col)) continue
      if (!matches(row, col, expr)) return false
    }
    return true
  })
  const order = params.find(([c]) => c === 'order')?.[1]
  if (order) {
    const [col, dir] = order.split('.')
    rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
  }
  const total = rows.length
  const limit = params.find(([c]) => c === 'limit')?.[1]
  if (limit) rows = rows.slice(0, Number(limit))
  return { rows, total }
}

function bearerUser(headers) {
  const token = (headers.authorization || headers.Authorization || '').replace(/^Bearer /, '')
  try {
    const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    return [HANDLE_USER, NO_HANDLE_USER].find((u) => u.id === sub) || null
  } catch {
    return null
  }
}

export function handle({ method, url, headers = {} }) {
  const u = new URL(url)
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))

  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...CORS,
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': lower['access-control-request-headers'] || '*',
        'access-control-max-age': '600',
      },
      body: '',
    }
  }

  if (u.pathname.startsWith('/auth/v1/')) {
    const user = bearerUser(lower)
    if (u.pathname === '/auth/v1/user') {
      return user ? json(200, authUser(user)) : json(401, { code: 401, msg: 'no session' })
    }
    if (u.pathname === '/auth/v1/token') return json(200, makeSession(user || HANDLE_USER))
    if (u.pathname === '/auth/v1/logout') return { status: 204, headers: CORS, body: '' }
    unknown.add(`auth ${u.pathname}`)
    return json(404, {})
  }

  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)/)
  if (rpc) {
    if (rpc[1] in RPCS) return json(200, RPCS[rpc[1]])
    unknown.add(`rpc ${rpc[1]}`)
    return json(200, null)
  }

  if (u.pathname.startsWith('/functions/v1/')) {
    unknown.add(`function ${u.pathname.split('/')[3]}`)
    return json(404, { error: 'not in fixtures' })
  }

  const rest = u.pathname.match(/^\/rest\/v1\/([^/]+)/)
  if (rest) {
    const table = rest[1]
    if (method !== 'GET' && method !== 'HEAD') {
      unknown.add(`write ${method} ${table}`)
      return json(method === 'POST' ? 201 : 200, [])
    }
    if (!(table in TABLES)) {
      unknown.add(`table ${table}`)
      return json(200, [])
    }
    const { rows, total } = query(table, [...u.searchParams.entries()])
    const range = rows.length ? `0-${rows.length - 1}/${total}` : `*/${total}`
    const extra = /count=exact/.test(lower.prefer || '') ? { 'content-range': range } : {}
    if (/application\/vnd\.pgrst\.object\+json/.test(lower.accept || '')) {
      if (rows.length === 1) return json(200, rows[0], extra)
      return json(406, {
        code: 'PGRST116', details: `The result contains ${rows.length} rows`,
        hint: null, message: 'JSON object requested, multiple (or no) rows returned',
      })
    }
    return json(200, rows, extra)
  }

  unknown.add(`path ${u.pathname}`)
  return json(404, {})
}
