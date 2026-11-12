// Self-test for scripts/review/severity.mjs (spec §5.6 defaults). Pure; fixtures are live bot
// comments trimmed into fixtures/bot-formats.json, plus synthetic variants marked as such.
// Run: node scripts/review/severity.test.mjs
import { readFileSync } from 'node:fs'
import { severityOf } from './severity.mjs'

const fx = JSON.parse(readFileSync(new URL('./fixtures/bot-formats.json', import.meta.url), 'utf8'))
let pass = 0, fail = 0
const ok = (n, c) => {
  if (c !== null && typeof c === 'object' && typeof c.then === 'function') { fail++; console.log('  FAIL', n, '(unawaited Promise)'); return }
  if (c === true) pass++; else { fail++; console.log('  FAIL', n) }
}

const CODEX = 'chatgpt-codex-connector[bot]', CR = 'coderabbitai[bot]'
const codexBody = (p) => `**<sub><sub>![${p} Badge](https://img.shields.io/badge/${p}-yellow?style=flat)</sub></sub>  A finding**\n\nBody.`
const crBody = (label) => `<!-- coderabbit-ai-generated:v1 -->\n\n**<picture><img src="x.svg" alt=""></picture> ${label}** · **Functional Correctness** · **Quick win**\n\n**A finding.**\n\nBody.`

// --- live fixtures ---
const codexP2 = severityOf(fx.codexP2)
ok('Codex P2 badge (live) -> blocking, label P2', codexP2.blocking === true && codexP2.label === 'P2')
const crMajor = severityOf(fx.crMajorInline)
ok('CodeRabbit Major (live) -> blocking, label Major', crMajor.blocking === true && crMajor.label === 'Major')
const crMinor = severityOf(fx.crMinorInline)
ok('CodeRabbit Minor (live) -> nit, label Minor', crMinor.blocking === false && crMinor.label === 'Minor')

// --- synthetic: the labels no live comment carries ---
ok('Codex P3 -> nit', (() => { const s = severityOf({ login: CODEX, body: codexBody('P3') }); return s.blocking === false && s.label === 'P3' })())
ok('Codex P0 -> blocking', severityOf({ login: CODEX, body: codexBody('P0') }).blocking === true)
ok('Codex P1 -> blocking', severityOf({ login: CODEX, body: codexBody('P1') }).blocking === true)
ok('CodeRabbit Critical -> blocking', (() => { const s = severityOf({ login: CR, body: crBody('Critical') }); return s.blocking === true && s.label === 'Critical' })())
ok('CodeRabbit Trivial -> nit', (() => { const s = severityOf({ login: CR, body: crBody('Trivial') }); return s.blocking === false && s.label === 'Trivial' })())
ok('CodeRabbit Nitpick -> nit', (() => { const s = severityOf({ login: CR, body: crBody('Nitpick') }); return s.blocking === false && s.label === 'Nitpick' })())
ok('CodeRabbit emoji-prefixed label parses', (() => { const s = severityOf({ login: CR, body: '**🟠 Major** · **Security**\n\nx' }); return s.label === 'Major' && s.blocking === true })())

// --- unparseable -> blocking (§5.6) ---
const isUnparseable = (s) => s.label === null && s.blocking === true
ok('a CodeRabbit body with no recognizable label -> blocking', isUnparseable(severityOf({ login: CR, body: 'hmm' })))
ok('an empty body -> blocking', isUnparseable(severityOf({ login: CODEX, body: '' })))
ok('a missing body -> blocking', isUnparseable(severityOf({ login: CODEX })))
ok('a Codex comment with no badge -> blocking', isUnparseable(severityOf({ login: CODEX, body: 'Looks fine to me.' })))
ok('another login -> blocking, even with a Codex badge', isUnparseable(severityOf({ login: 'mallory', body: codexBody('P3') })))
ok('a Codex badge in a CodeRabbit comment is not read', isUnparseable(severityOf({ login: CR, body: codexBody('P3') })))
ok('a severity word in prose, not in the header, is not read', isUnparseable(severityOf({ login: CR, body: 'This is only a Minor concern.' })))
ok('a badge quoted later in a Codex body is not read', isUnparseable(severityOf({ login: CODEX, body: `Quoting an old comment: ${codexBody('P3')}` })))
ok('a CodeRabbit reply (no header) is unparseable', isUnparseable(severityOf({ login: CR, body: '<!-- coderabbit-ai-generated:v1 -->\n\n@someone Thanks, this addresses the finding.' })))

if (fail) { console.log(`severity: ${fail} FAILED, ${pass} passed`); process.exit(1) }
console.log(`severity: ${pass} passed`)
