// Supabase clients and env validation for staging writers. Each validates its target BEFORE any
// client (and so any request) exists. Errors never contain the URL, password or key.
import { createClient } from '@supabase/supabase-js'
import { assertStaging, assertStagingSite } from '../lib/targets.mjs'

const authOpts = { auth: { persistSession: false, autoRefreshToken: false } }

export function stagingAdmin({ url, serviceRoleKey, fetch } = {}) {
  assertStaging(url, 'api')
  return createClient(url, serviceRoleKey, { ...authOpts, ...(fetch ? { global: { fetch } } : {}) })
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

// For integration tests against a local stack: http(s) on localhost/127.0.0.1, allowed ports only.
export function localAdmin({ url, serviceRoleKey, allowedPorts, fetch } = {}) {
  let u = null
  try { u = new URL(String(url)) } catch { /* refused below */ }
  const port = u ? Number(u.port || (u.protocol === 'https:' ? 443 : 80)) : NaN
  if (
    !u ||
    (u.protocol !== 'http:' && u.protocol !== 'https:') ||
    !LOCAL_HOSTS.has(u.hostname) ||
    !Array.isArray(allowedPorts) ||
    !allowedPorts.includes(port)
  ) {
    throw new Error('refusing: local target must be http(s) on localhost or 127.0.0.1 at an allowed port')
  }
  return createClient(url, serviceRoleKey, { ...authOpts, ...(fetch ? { global: { fetch } } : {}) })
}

const need = (env, name) => {
  const v = env[name]
  if (typeof v !== 'string' || v === '') throw new Error(`${name} is required`)
  return v
}

// Assert every staging-side variable the refresh will use, before anything else runs.
export function validateTargets(env) {
  const check = (name, fn) => {
    try { fn(need(env, name)) } catch (e) {
      if (String(e.message).endsWith('is required')) throw e
      throw new Error(`${name}: ${e.message}`, { cause: e })
    }
  }
  check('STAGING_DB_URL', (v) => assertStaging(v, 'db'))
  check('STAGING_SUPABASE_URL', (v) => assertStaging(v, 'api'))
  if (env.STAGING_SITE_URL) check('STAGING_SITE_URL', assertStagingSite)
}
