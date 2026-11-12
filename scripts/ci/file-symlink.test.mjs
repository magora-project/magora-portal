// Self-test for scripts/ci/file-symlink.mjs. The symlink call is a stub; nothing touches disk.
// Run: node scripts/ci/file-symlink.test.mjs
import { fileSymlinkOrSkip } from './file-symlink.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const throwing = (code) => () => { const e = new Error(code); e.code = code; throw e }
const quiet = () => {}
const run = (opts) => { try { return fileSymlinkOrSkip('t', 'p', { log: quiet, ...opts }) } catch (e) { return `threw ${e.code}` } }

ok('link created -> true', run({ symlink: () => {} }) === true)
ok('Windows EPERM outside CI -> false (skip)', run({ platform: 'win32', env: {}, symlink: throwing('EPERM') }) === false)
ok('Windows EPERM in CI -> rethrows (CI never skips)', run({ platform: 'win32', env: { CI: 'true' }, symlink: throwing('EPERM') }) === 'threw EPERM')
ok('EPERM on Linux -> rethrows', run({ platform: 'linux', env: {}, symlink: throwing('EPERM') }) === 'threw EPERM')
ok('EPERM on macOS -> rethrows', run({ platform: 'darwin', env: {}, symlink: throwing('EPERM') }) === 'threw EPERM')
ok('other Windows error -> rethrows', run({ platform: 'win32', env: {}, symlink: throwing('ENOENT') }) === 'threw ENOENT')
let said = ''
fileSymlinkOrSkip('t', 'p', { platform: 'win32', env: {}, symlink: throwing('EPERM'), log: (s) => { said = s } })
ok('a skip says so', /SKIP/.test(said) && /Developer Mode/.test(said))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
