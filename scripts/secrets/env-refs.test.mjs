// Tests for env/staging.env: references only, parsed the way `op run --env-file` does.
// Run: node scripts/secrets/env-refs.test.mjs
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const parse = (text) => text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
const raw = readFileSync(new URL('../../env/staging.env', import.meta.url), 'utf8')
const lines = parse(raw)
const RE = /^[A-Z][A-Z0-9_]*=op:\/\/Magora Staging\/[^/]+\/[A-Z][A-Z0-9_]*$/

ok('has lines', lines.length > 0)
ok('every line is a staging reference', lines.every((l) => RE.test(l)))
ok('no production vault', !raw.includes('Magora Project'))
const crlf = parse(raw.replace(/\n/g, '\r\n'))
ok('CRLF parses the same, no CR', JSON.stringify(crlf) === JSON.stringify(lines) && crlf.every((l) => !l.includes('\r')))
const names = lines.map((l) => l.split('=')[0])
for (const n of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VERCEL_AUTOMATION_BYPASS_SECRET']) ok(`has ${n}`, names.includes(n))
ok('no duplicate names', new Set(names).size === names.length)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
