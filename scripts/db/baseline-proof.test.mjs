// Tests for scripts/db/baseline-proof.mjs (pure functions; no database).
// Run: node scripts/db/baseline-proof.test.mjs
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listMigrationFiles } from './apply-migrations.mjs'
import { selectFiles, parseArgs, BASELINE, LAST_ON_PRODUCTION, MIGRATIONS, DEFAULT_ALLOWLIST } from './baseline-proof.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }
const throws = (f) => { try { f(); return null } catch (e) { return String(e.message) } }

const P = (...names) => names.map((n) => join('/m', n))
const files = P(BASELINE, '20260626_a.sql', '20260727_b.sql', '20261106_c.sql', '20261201_grants.sql')

ok('through a stem keeps it and everything before', selectFiles(files, '20261106_c').length === 4)
ok('through accepts the .sql name', selectFiles(files, '20261106_c.sql').length === 4)
ok('through the last file keeps all', selectFiles(files, '20261201_grants').length === 5)
ok('the baseline stays first', selectFiles(files, '20260626_a')[0] === files[0])
ok('an unknown through is refused', /no such migration/.test(throws(() => selectFiles(files, '20261107_typo'))))
ok('a missing baseline is refused', /must be the first/.test(throws(() => selectFiles(files.slice(1), '20261106_c'))))
ok('a file sorting before the baseline is refused', /must be the first/.test(throws(() => selectFiles(P('20260101_early.sql', ...files.map((f) => f.slice(3))), '20261106_c'))))

ok('parseArgs needs --prod-snapshot', /required/.test(throws(() => parseArgs([]))))
ok('parseArgs defaults', (() => { const o = parseArgs(['--prod-snapshot', 'p.json']); return o.through === LAST_ON_PRODUCTION && o.allowlist === DEFAULT_ALLOWLIST })())
ok('parseArgs --through', parseArgs(['--prod-snapshot', 'p.json', '--through', 'x']).through === 'x')
ok('parseArgs refuses an unknown flag', /unknown/.test(throws(() => parseArgs(['--prod-snapshot', 'p.json', '--nope']))))
ok('parseArgs refuses a flag with no value', /incomplete/.test(throws(() => parseArgs(['--prod-snapshot']))))

// The real tree: the baseline sorts first, LAST_ON_PRODUCTION names a real file, and the allowlist exists.
const real = listMigrationFiles(MIGRATIONS)
ok('the real baseline sorts first', throws(() => selectFiles(real, LAST_ON_PRODUCTION)) === null)
ok('the real allowlist exists', existsSync(DEFAULT_ALLOWLIST))

console.log(`baseline-proof: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
