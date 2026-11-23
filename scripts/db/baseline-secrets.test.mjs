// The pre-history baseline must carry no secret (Spec 2 plan Task 12 Step 2, spec §5.2). It is derived
// from production's schema-only dump, which holds no rows, but a function body, default or comment
// could still embed a key or a project URL. Checks the fixtures below, then the real file.
// Run: node scripts/db/baseline-secrets.test.mjs
import { readFileSync } from 'node:fs'
import { PRODUCTION_REF, STAGING_REF } from '../lib/targets.mjs'
import { sqlSegments } from './sql-lex.mjs'

const BASELINE = new URL('../../supabase/migrations/20260625_baseline_prehistory.sql', import.meta.url)

// Every string literal in sql, from the lexer in sql-lex.mjs, so a comment or quoted identifier is
// skipped only where it really is one: a line starting `--` inside a multi-line literal stays part of
// the literal, `--` inside "a--b" is part of the name, and an apostrophe in a comment never opens a
// literal. A dollar-quoted string that follows AS or DO is a function or DO body: code, not a value,
// so it is not itself a literal, but the literals inside it are, at any depth.
export function stringLiterals(sql) {
  const out = []
  let before = '' // the code just before the current segment (comments do not reset it)
  for (const s of sqlSegments(sql)) {
    if (s.kind === 'code') { before = s.text; continue }
    if (s.kind === 'comment') continue
    if (s.kind === 'string') out.push(s.text)
    else if (s.kind === 'dollar') {
      if (/\b(as|do)\s*$/i.test(before)) out.push(...stringLiterals(s.body))
      else out.push(s.text)
    }
    before = ''
  }
  return out
}
// A URL with a scheme, or a bare *.supabase.co / *.supabase.com host.
const URLISH = /[a-z][a-z0-9+.-]*:\/\/[^\s'"()]+|[a-z0-9.-]+\.supabase\.com?\b[^\s'"()]*/gi

export function findSecrets(sql) {
  const found = []
  if (/eyJ[A-Za-z0-9_-]{20,}/.test(sql)) found.push('a JWT (eyJ...)')
  for (const marker of ['sk-', 'xoxb-', 'hooks.slack.com']) if (sql.includes(marker)) found.push(marker)
  if (stringLiterals(sql).some((s) => s.includes('service_role'))) found.push('service_role inside a string literal')
  for (const u of sql.match(URLISH) ?? []) {
    for (const [label, ref] of [['production', PRODUCTION_REF], ['staging', STAGING_REF]]) {
      if (u.includes(ref)) found.push(`a ${label} ref inside a URL`)
    }
  }
  return found
}

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const flags = (name, sql, expected) => ok(`${name} -> ${expected}`, findSecrets(sql).includes(expected))

// Each pattern fires on its own.
flags('JWT', "select 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x'", 'a JWT (eyJ...)')
flags('OpenAI-style key', "create function f() returns text language sql as $$ select 'sk-abc' $$", 'sk-')
flags('Slack bot token', "-- xoxb-123", 'xoxb-')
flags('Slack webhook', "select 'https://hooks.slack.com/services/T/B/x'", 'hooks.slack.com')
flags('service_role in a literal', "select auth.role() = 'service_role'", 'service_role inside a string literal')
flags('service_role in a literal inside a body', "as $$ begin if auth.role() = 'service_role' then null; end if; end $$", 'service_role inside a string literal')
flags('service_role in a dollar-quoted literal', 'select $$service_role$$', 'service_role inside a string literal')
flags('service_role in a tagged dollar-quoted literal', 'select auth.role() = $q$service_role$q$', 'service_role inside a string literal')
flags('service_role in a dollar-quoted literal inside a body', 'create function f() returns bool language plpgsql as $fn$ begin return auth.role() = $$service_role$$; end $fn$', 'service_role inside a string literal')
flags('service_role in a dollar-quoted literal inside a DO block', 'do $$ begin perform set_config($c$role$c$, $v$service_role$v$, true); end $$', 'service_role inside a string literal')
flags('service_role on a `--` line inside a multi-line dollar-quoted literal', 'select $q$\n-- service_role\n$q$', 'service_role inside a string literal')
flags('service_role on a `--` line inside a multi-line quoted literal', "select 'a\n-- service_role\n'", 'service_role inside a string literal')
flags('service_role after an E-string with an escaped quote', "select E'it\\'s', 'service_role'", 'service_role inside a string literal')
flags('service_role after a quoted identifier holding `--`', 'comment on column public.t."x--y" is \'service_role\';', 'service_role inside a string literal')
flags('service_role after a quoted identifier holding an escaped quote and an apostrophe', 'comment on column public.t."a""b\'c" is \'service_role\';', 'service_role inside a string literal')
flags('production API URL', `select 'https://${PRODUCTION_REF}.supabase.co/rest/v1'`, 'a production ref inside a URL')
flags('production pooler URL', `-- postgresql://postgres.${PRODUCTION_REF}@aws-0-us.pooler.supabase.com:5432/postgres`, 'a production ref inside a URL')
flags('staging bare host', `select '${STAGING_REF}.supabase.co'`, 'a staging ref inside a URL')

// And not on the things the baseline legitimately holds.
ok('TO service_role (a role, not a literal) is clean', findSecrets('create policy p on public.t to service_role using (true);').length === 0)
ok('GRANT ... TO service_role is clean', findSecrets('grant all on table public.t to service_role;').length === 0)
ok('a function body that grants to service_role (a role, not a literal) is clean', findSecrets('create function f() returns void language plpgsql as $$ begin grant select on public.t to service_role; end $$;').length === 0)
ok('a DO body naming service_role as a role is clean', findSecrets('do $$ begin grant usage on schema s to service_role; end $$;').length === 0)
ok('a short eyJ is clean', findSecrets("select 'eyJabc'").length === 0)
ok('an apostrophe in a comment does not pair with code', findSecrets("-- elevation_m's unit\ncreate policy p on t to service_role using (true);\nselect 'x';").length === 0)
ok('an apostrophe in a comment inside a function body does not pair with code', findSecrets("create function f() returns void language plpgsql as $$ begin -- don't\n grant select on t to service_role; perform 'x'; end $$;").length === 0)
ok('an apostrophe in a block comment does not pair with code', findSecrets("/* it's /* nested */ still */ grant all on t to service_role; select 'x';").length === 0)
ok('an E-string escaped quote does not pair with code', findSecrets("select E'\\''; grant all on t to service_role; select 'x';").length === 0)
ok('service_role quoted inside a comment is not a literal', findSecrets("-- 'service_role'\nselect 1;").length === 0)
ok('a bare ref outside a URL is clean', findSecrets(`-- project ${PRODUCTION_REF}`).length === 0)

// The real file.
let text = null
try { text = readFileSync(BASELINE, 'utf8') } catch (e) { ok(`baseline file readable (${e.code})`, false) }
if (text !== null) {
  const found = findSecrets(text)
  ok(`baseline carries no secret${found.length ? `: ${found.join(', ')}` : ''}`, found.length === 0)
}

console.log(`baseline-secrets: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
