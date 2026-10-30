// Tests for scripts/lib/targets.mjs (the project-ref guard) and scripts/staging/clients.mjs.
// Run: node scripts/lib/targets.test.mjs
import {
  PRODUCTION_REF, STAGING_REF, STAGING_SITE_ORIGIN,
  refFromSupabaseUrl, refFromDbUrl, assertStaging, assertStagingSite,
} from './targets.mjs'
import { stagingAdmin, localAdmin, validateTargets } from '../staging/clients.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const throws = (fn) => { try { fn() } catch { return true } return false }
const messageOf = (fn) => { try { fn() } catch (e) { return String(e && e.message) } return '' }

const STG_API = 'https://mujiqtvwtsbaakfcsjkp.supabase.co'
const PROD_API = 'https://wqxmmuwrfltpaxnuddwk.supabase.co'
const STG_DB = 'postgresql://postgres:pw@db.mujiqtvwtsbaakfcsjkp.supabase.co:5432/postgres'

ok('constants', PRODUCTION_REF === 'wqxmmuwrfltpaxnuddwk' && STAGING_REF === 'mujiqtvwtsbaakfcsjkp' && STAGING_SITE_ORIGIN === 'https://staging.themagoraportal.org')
ok('api: staging ref', refFromSupabaseUrl(STG_API) === STAGING_REF)
ok('api: unparseable -> null', refFromSupabaseUrl('not a url') === null)
ok('api: subdomain of host -> null', refFromSupabaseUrl('https://x.mujiqtvwtsbaakfcsjkp.supabase.co') === null)
ok('api: wrong tld -> null', refFromSupabaseUrl('https://mujiqtvwtsbaakfcsjkp.supabase.com') === null)
ok('db: pooler username carries the ref',
  refFromDbUrl('postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres') === PRODUCTION_REF)
ok('db: direct host carries the ref', refFromDbUrl(STG_DB) === STAGING_REF)
ok('db: username and host agree -> ref', refFromDbUrl('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.mujiqtvwtsbaakfcsjkp.supabase.co/postgres') === STAGING_REF)
ok('db: username and host disagree -> throws', throws(() => refFromDbUrl('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres')))
ok('db: disagree message', messageOf(() => refFromDbUrl('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres')) === 'ambiguous project ref')
ok('db: unparseable -> null', refFromDbUrl('::::') === null)
ok('db: no ref -> null', refFromDbUrl('postgresql://postgres:pw@localhost:54322/postgres') === null)
ok('db: short username suffix is not a ref', refFromDbUrl('postgresql://postgres.abc:pw@localhost/postgres') === null)

ok('assertStaging refuses production (pooler form)', throws(() => assertStaging('postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres', 'db')))
ok('assertStaging refuses a URL with no ref', throws(() => assertStaging('postgresql://postgres:pw@localhost:54322/postgres', 'db')))
ok('assertStaging refuses a lookalike ref', throws(() => assertStaging('https://mujiqtvwtsbaakfcsjkpx.supabase.co', 'api')))
ok('assertStaging refuses unparseable', throws(() => assertStaging('nope', 'api')))
ok('assertStaging refuses an ambiguous db url', throws(() => assertStaging('postgresql://postgres.mujiqtvwtsbaakfcsjkp:pw@db.wqxmmuwrfltpaxnuddwk.supabase.co/postgres', 'db')))
ok('error message never contains the password', messageOf(() => assertStaging('postgresql://postgres.wqxmmuwrfltpaxnuddwk:s3cret@h/postgres', 'db')).includes('s3cret') === false)
ok('error message names the ref found', messageOf(() => assertStaging(PROD_API, 'api')).includes(PRODUCTION_REF))
ok('error message never contains the url', !messageOf(() => assertStaging('https://evil.example/secret-path', 'api')).includes('evil.example'))
ok('assertStaging accepts staging api', !throws(() => assertStaging(STG_API, 'api')))
ok('assertStaging accepts staging db', !throws(() => assertStaging(STG_DB, 'db')))
ok('site: exact origin accepted', !throws(() => assertStagingSite('https://staging.themagoraportal.org/some/path')))
ok('site: lookalike origin refused', throws(() => assertStagingSite('https://staging.themagoraportal.org.evil.example/')))
ok('site: http refused', throws(() => assertStagingSite('http://staging.themagoraportal.org')))
ok('site: unparseable refused', throws(() => assertStagingSite('garbage')))
ok('site: message hides url', !messageOf(() => assertStagingSite('https://evil.example/tok')).includes('evil.example'))

// stagingAdmin
ok('stagingAdmin with production URL makes zero requests', (() => {
  const calls = []; const f = (...a) => { calls.push(a); return Promise.resolve(new Response('{}')) }
  return throws(() => stagingAdmin({ url: PROD_API, serviceRoleKey: 'x', fetch: f })) && calls.length === 0
})())
ok('stagingAdmin accepts staging and returns a client', typeof stagingAdmin({ url: STG_API, serviceRoleKey: 'x', fetch: () => Promise.resolve(new Response('{}')) })?.from === 'function')
ok('stagingAdmin passes injected fetch through', await (async () => {
  const calls = []; const f = (...a) => { calls.push(a); return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } })) }
  const c = stagingAdmin({ url: STG_API, serviceRoleKey: 'x', fetch: f })
  await c.from('t').select('*')
  return calls.length >= 1
})())

// localAdmin
const lf = () => Promise.resolve(new Response('{}'))
ok('localAdmin accepts localhost on allowed port', !throws(() => localAdmin({ url: 'http://localhost:54321', serviceRoleKey: 'x', allowedPorts: [54321], fetch: lf })))
ok('localAdmin accepts 127.0.0.1', !throws(() => localAdmin({ url: 'http://127.0.0.1:54321', serviceRoleKey: 'x', allowedPorts: [54321], fetch: lf })))
ok('localAdmin refuses other port', throws(() => localAdmin({ url: 'http://localhost:9999', serviceRoleKey: 'x', allowedPorts: [54321] })))
ok('localAdmin refuses remote host', throws(() => localAdmin({ url: 'http://example.com:54321', serviceRoleKey: 'x', allowedPorts: [54321] })))
ok('localAdmin refuses staging api', throws(() => localAdmin({ url: STG_API, serviceRoleKey: 'x', allowedPorts: [443] })))
ok('localAdmin refuses non-http scheme', throws(() => localAdmin({ url: 'ftp://localhost:54321', serviceRoleKey: 'x', allowedPorts: [54321] })))
ok('localAdmin refuses unparseable', throws(() => localAdmin({ url: 'x', serviceRoleKey: 'x', allowedPorts: [54321] })))
ok('localAdmin refuses localhost lookalike', throws(() => localAdmin({ url: 'http://localhost.evil.example:54321', serviceRoleKey: 'x', allowedPorts: [54321] })))
ok('localAdmin refuses empty allowedPorts', throws(() => localAdmin({ url: 'http://localhost:54321', serviceRoleKey: 'x', allowedPorts: [] })))
ok('localAdmin message hides url', !messageOf(() => localAdmin({ url: 'http://evil.example:1/tok', serviceRoleKey: 'x', allowedPorts: [1] })).includes('evil.example'))

// validateTargets
const good = { STAGING_DB_URL: STG_DB, STAGING_SUPABASE_URL: STG_API }
ok('validateTargets accepts staging env', !throws(() => validateTargets(good)))
ok('validateTargets accepts staging site', !throws(() => validateTargets({ ...good, STAGING_SITE_URL: STAGING_SITE_ORIGIN })))
ok('validateTargets refuses wrong site', throws(() => validateTargets({ ...good, STAGING_SITE_URL: 'https://themagoraportal.org' })))
ok('validateTargets missing db throws', throws(() => validateTargets({ STAGING_SUPABASE_URL: STG_API })))
ok('validateTargets missing api throws', throws(() => validateTargets({ STAGING_DB_URL: STG_DB })))
ok('validateTargets empty db throws', throws(() => validateTargets({ ...good, STAGING_DB_URL: '' })))
ok('validateTargets prod db throws', throws(() => validateTargets({ ...good, STAGING_DB_URL: 'postgresql://postgres.wqxmmuwrfltpaxnuddwk:pw@h/postgres' })))
ok('validateTargets prod api throws', throws(() => validateTargets({ ...good, STAGING_SUPABASE_URL: PROD_API })))
ok('validateTargets message names variable, not secret', (() => {
  const m = messageOf(() => validateTargets({ ...good, STAGING_DB_URL: 'postgresql://postgres.wqxmmuwrfltpaxnuddwk:s3cret@h/postgres' }))
  return m.includes('STAGING_DB_URL') && !m.includes('s3cret') && m.includes(PRODUCTION_REF)
})())
ok('validateTargets missing message names variable', messageOf(() => validateTargets({ STAGING_SUPABASE_URL: STG_API })).includes('STAGING_DB_URL'))

// Fix round 1: query overrides, host whitelist, scheme checks
const POOL = 'aws-0-us-west-1.pooler.supabase.com'
const STG_USER = 'postgres.mujiqtvwtsbaakfcsjkp'
ok('db: query user override refused', throws(() => assertStaging(`postgresql://${STG_USER}:pw@${POOL}:5432/postgres?user=postgres.${PRODUCTION_REF}`, 'db')))
ok('db: query host override refused', throws(() => assertStaging(`postgresql://postgres:pw@db.${STAGING_REF}.supabase.co/postgres?host=db.${PRODUCTION_REF}.supabase.co`, 'db')))
ok('db: query options override refused', throws(() => assertStaging(`postgresql://postgres:pw@db.${STAGING_REF}.supabase.co/postgres?options=reference%3D${PRODUCTION_REF}`, 'db')))
ok('db: query service override refused', throws(() => assertStaging(`postgresql://postgres:pw@db.${STAGING_REF}.supabase.co/postgres?service=prod`, 'db')))
ok('db: ?sslmode=require accepted', !throws(() => assertStaging(`postgresql://postgres:pw@db.${STAGING_REF}.supabase.co/postgres?sslmode=require`, 'db')))
ok('db: sslmode plus another param refused', throws(() => assertStaging(`postgresql://postgres:pw@db.${STAGING_REF}.supabase.co/postgres?sslmode=require&host=x`, 'db')))
ok('db: staging pooler host with staging username accepted', !throws(() => assertStaging(`postgresql://${STG_USER}:pw@${POOL}:5432/postgres`, 'db')))
ok('db: trailing-dot host refused', throws(() => assertStaging(`postgresql://${STG_USER}:pw@db.${PRODUCTION_REF}.supabase.co./postgres`, 'db')))
ok('db: percent-encoded host refused', throws(() => assertStaging(`postgresql://${STG_USER}:pw@db.%77qxmmuwrfltpaxnuddwk.supabase.co/postgres`, 'db')))
ok('db: comma multi-host refused', throws(() => assertStaging(`postgresql://${STG_USER}:pw@db.${PRODUCTION_REF}.supabase.co,${POOL}/postgres`, 'db')))
ok('db: unknown host refused even with staging username', throws(() => assertStaging(`postgresql://${STG_USER}:pw@evil.example/postgres`, 'db')))
ok('db: bad pooler region refused', throws(() => assertStaging(`postgresql://${STG_USER}:pw@aws-0-us.pooler.supabase.com/postgres`, 'db')))
ok('db: https scheme refused', throws(() => assertStaging(`https://${STG_USER}:pw@x/`, 'db')))
ok('api: http refused', throws(() => assertStaging(`http://${STAGING_REF}.supabase.co`, 'api')))
ok('api: userinfo refused', throws(() => assertStaging(`https://u:p@${STAGING_REF}.supabase.co`, 'api')))
ok('api: explicit port refused', throws(() => assertStaging(`https://${STAGING_REF}.supabase.co:8443`, 'api')))
ok('fix messages hide password', !messageOf(() => assertStaging(`postgresql://${STG_USER}:s3cret@evil.example/p?host=x`, 'db')).includes('s3cret'))

// Fix round 2: strict raw-URL grammar (libpq vs WHATWG parser differentials)
const H_STG = `db.${STAGING_REF}.supabase.co`, H_PROD = `db.${PRODUCTION_REF}.supabase.co`
ok('db: hash-hidden query override refused', throws(() => assertStaging(`postgresql://postgres:PW@${H_STG}/postgres#?host=${H_PROD}&dbname=postgres`, 'db')))
ok('db: hash-hidden userinfo split refused', throws(() => assertStaging(`postgresql://${H_STG}#:PW@${H_PROD}/postgres?user=postgres`, 'db')))
ok('db: two raw @ refused', throws(() => assertStaging(`postgresql://postgres:p@ss@${H_STG}/postgres`, 'db')))
ok('db: duplicate sslmode refused', throws(() => assertStaging(`postgresql://postgres:pw@${H_STG}/postgres?sslmode=require&sslmode=disable`, 'db')))
ok('db: sslmode=disable refused', throws(() => assertStaging(`postgresql://postgres:pw@${H_STG}/postgres?sslmode=disable`, 'db')))
ok('db: trailing hash refused', throws(() => assertStaging(`postgresql://postgres:pw@${H_STG}/postgres#x`, 'db')))
ok('db: percent-encoded @ in password with pooler accepted', !throws(() => assertStaging(`postgresql://${STG_USER}:p%40ss@${POOL}:5432/postgres?sslmode=require`, 'db')))
ok('db: verify-full accepted', !throws(() => assertStaging(`postgres://postgres:pw@${H_STG}/postgres?sslmode=verify-full`, 'db')))
ok('db: dbname with slash refused', throws(() => assertStaging(`postgresql://postgres:pw@${H_STG}/a/b`, 'db')))
ok('db: grammar messages hide password', !messageOf(() => assertStaging(`postgresql://postgres:s3cret@${H_STG}/postgres#x`, 'db')).includes('s3cret'))

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
