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

export function assertStaging(url, kind) {
  if (kind !== 'db' && kind !== 'api') throw new Error('assertStaging: unknown kind')
  const ref = kind === 'db' ? refFromDbUrl(url) : refFromSupabaseUrl(url)
  if (ref !== STAGING_REF) {
    throw new Error(`refusing: ${kind} target is not the staging project (ref found: ${ref ?? 'no ref'})`)
  }
}

export function assertStagingSite(url) {
  const u = parse(url)
  if (!u || u.origin !== STAGING_SITE_ORIGIN) {
    throw new Error('refusing: site target is not the staging origin')
  }
}
