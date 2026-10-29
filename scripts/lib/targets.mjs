// Project-ref guard. Every staging writer calls assertStaging() before its first side effect, so
// anything that is not exactly the staging Supabase project is refused. Error messages name the
// ref found (or "no ref") and never echo the URL, password or key.
export const PRODUCTION_REF = 'wqxmmuwrfltpaxnuddwk'
export const STAGING_REF = 'mujiqtvwtsbaakfcsjkp'
export const STAGING_SITE_ORIGIN = 'https://staging.themagoraportal.org'

// A ref is exactly 20 lowercase letters, matched whole.
const REF = /^[a-z]{20}$/
const API_HOST = /^([a-z]{20})\.supabase\.co$/
const DB_HOST = /^db\.([a-z]{20})\.supabase\.co$/

const parse = (url) => {
  try { return new URL(String(url)) } catch { return null }
}

export function refFromSupabaseUrl(url) {
  const u = parse(url)
  if (!u) return null
  const m = API_HOST.exec(u.hostname)
  return m ? m[1] : null
}

export function refFromDbUrl(url) {
  const u = parse(url)
  if (!u) return null
  let user = u.username
  try { user = decodeURIComponent(user) } catch { /* keep raw */ }
  const dot = user.indexOf('.')
  const fromUser = dot >= 0 && REF.test(user.slice(dot + 1)) ? user.slice(dot + 1) : null
  const m = DB_HOST.exec(u.hostname)
  const fromHost = m ? m[1] : null
  if (fromUser && fromHost && fromUser !== fromHost) throw new Error('ambiguous project ref')
  return fromUser || fromHost
}

const DB_SCHEMES = new Set(['postgres:', 'postgresql:'])
const POOLER_HOST = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/

// Structural checks that the ref extraction alone cannot make. Returns a reason or null.
function shapeProblem(url, kind) {
  const u = parse(url)
  if (!u) return null // unparseable: the ref check reports it
  if (kind === 'api') {
    if (u.protocol !== 'https:') return 'api target must use https'
    if (u.username || u.password) return 'api target must not carry credentials'
    if (u.port) return 'api target must not set a port'
    return null
  }
  if (!DB_SCHEMES.has(u.protocol)) return 'db target must use a postgres scheme'
  // libpq lets query parameters override the authority; only sslmode is allowed.
  for (const key of u.searchParams.keys()) {
    if (key !== 'sslmode') return 'db target carries a query override'
  }
  if (!DB_HOST.test(u.hostname) && !POOLER_HOST.test(u.hostname)) {
    return 'db target host is not a recognised Supabase host'
  }
  return null
}

// Raw-string grammar for db URLs, checked BEFORE any WHATWG parsing. libpq and WHATWG disagree on
// '#', '@' and repeated parameters, so anything outside this exact shape is refused unparsed.
const DB_GRAMMAR = new RegExp(
  '^postgres(?:ql)?://[^@/?#]+@' +
  '(?:db\\.[a-z]{20}\\.supabase\\.co|aws-\\d+-[a-z]+-[a-z]+-\\d+\\.pooler\\.supabase\\.com)' +
  // The /dbname segment is required: a URL with no database path is refused, not defaulted.
  '(?::\\d+)?/[A-Za-z0-9_]+(?:\\?sslmode=(?:require|verify-ca|verify-full))?$',
)

export function assertStaging(url, kind) {
  if (kind !== 'db' && kind !== 'api') throw new Error('assertStaging: unknown kind')
  if (kind === 'db' && !(typeof url === 'string' && DB_GRAMMAR.test(url))) {
    // The WHATWG parse below only labels the message; it never admits a URL.
    let ref = null
    try { ref = refFromDbUrl(url) } catch { /* ambiguous: report no ref */ }
    throw new Error(`refusing: db target does not match the strict URL grammar (ref found: ${ref ?? 'no ref'})`)
  }
  const ref = kind === 'db' ? refFromDbUrl(url) : refFromSupabaseUrl(url)
  if (ref !== STAGING_REF) {
    throw new Error(`refusing: ${kind} target is not the staging project (ref found: ${ref ?? 'no ref'})`)
  }
  const problem = shapeProblem(url, kind)
  if (problem) throw new Error(`refusing: ${problem} (ref found: ${ref})`)
}

export function assertStagingSite(url) {
  const u = parse(url)
  if (!u || u.origin !== STAGING_SITE_ORIGIN) {
    throw new Error('refusing: site target is not the staging origin')
  }
}
