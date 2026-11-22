// Tokens (portal v4 plan, Task 2). token() reads a CSS custom property for the few sinks that cannot
// resolve var() (Leaflet pathOptions, canvas, html2canvas options, SVG presentation attributes); every
// other colour is a var() string resolved at paint time. These tests also guard every later tokenising
// task: each referenced token must be defined, and token() must never run at module scope, because the
// brand is applied in main.jsx after the imports are evaluated (spec §4.2).
// The source scans read only .js, .jsx and .css. This file is .mjs, so its stub values and the
// deliberately unknown 'nope' name never count.
// Run: node src/lib/tokens.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { definedTokens, token, TOKENS_CSS_PATH } from './tokens.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(exts) {
  return readdirSync(join(ROOT, 'src'), { recursive: true })
    .map((p) => join('src', String(p)).split(sep).join('/'))
    .filter((p) => exts.some((e) => p.endsWith(e)))
}

function stubComputed(values) {
  globalThis.document = { documentElement: {} }
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => values[n] ?? '' })
}

test('token reads the computed custom property', () => {
  stubComputed({ '--c-forest-bg': ' #0d2818 ' })
  assert.equal(token('c-forest-bg'), '#0d2818')
})

test('token throws on an unknown name', () => {
  stubComputed({})
  assert.throws(() => token('nope'), /unknown token --nope/)
})

test('definedTokens reads only the named block', () => {
  const css = ':root { --a: 1; --b: 2 }\n:root[data-brand="v4"] { --a: 3 }\n.x { --c: 4 }'
  assert.deepEqual([...definedTokens(css, ':root')].sort(), ['a', 'b'])
  assert.deepEqual([...definedTokens(css, ':root[data-brand="v4"]')], ['a'])
  assert.deepEqual([...definedTokens(css, '.missing')], [])
})

test('every referenced token is defined in :root', () => {
  const defined = definedTokens(readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8'), ':root')
  const missing = []
  for (const file of sourceFiles(['.js', '.jsx', '.css'])) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const m of text.matchAll(/var\(--([a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.push(`${file}: --${m[1]}`)
    for (const m of text.matchAll(/token\('([a-z0-9-]+)'\)/g)) if (!defined.has(m[1])) missing.push(`${file}: token('${m[1]}')`)
  }
  assert.deepEqual(missing, [])
})

// Lines (1-based) that call token() inside a top-level statement evaluated at import time. A line
// starting at column 0 with an identifier starts a statement; it runs at import time unless it is a
// function declaration or an import. Everything up to the next such line belongs to it, so a call in
// a multi-line `const C = {` object is caught, not only one on the declaration's own line. Conservative:
// an arrow function inside such a statement is flagged too. Comment lines are skipped.
function moduleScopeTokenCalls(text) {
  const lines = []
  let evaluated = false
  text.split('\n').forEach((line, i) => {
    if (/^[A-Za-z_$]/.test(line)) evaluated = !/^((export\s+(default\s+)?)?(async\s+)?function\b|import\b)/.test(line)
    if (evaluated && /\btoken\(/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) lines.push(i + 1)
  })
  return lines
}

test('moduleScopeTokenCalls finds calls that run at import time', () => {
  const src = [
    "import { token } from './tokens'", // 1
    "const A = token('a')", // 2: flagged
    'const C = {', // 3
    "  bg: token('b'),", // 4: flagged (a multi-line object)
    '}', // 5
    'export default function Page() {', // 6
    "  const fill = token('c')", // 7: render time
    '  return fill', // 8
    '}', // 9
    'export const P = {', // 10
    "  // token('d') in a comment", // 11
    '}', // 12
    "setDefault(token('e'))", // 13: flagged
    'function f() {', // 14
    "  return token('f')", // 15: call time
    '}', // 16
  ].join('\n')
  assert.deepEqual(moduleScopeTokenCalls(src), [2, 4, 13])
})

test('token() is never called at module scope', () => {
  const offenders = []
  for (const file of sourceFiles(['.js', '.jsx'])) {
    for (const n of moduleScopeTokenCalls(readFileSync(join(ROOT, file), 'utf8'))) offenders.push(`${file}:${n}`)
  }
  assert.deepEqual(offenders, [])
})

test('the font tokens hold the current families', () => {
  const css = readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8')
  assert.deepEqual([...definedTokens(css, ':root')].filter((n) => n.startsWith('font-')).sort(), ['font-body', 'font-display', 'font-label'])
  // `/`-joined, as sourceFiles() does: on Windows relative() returns `\` separators.
  assert.match(relative(ROOT, join(ROOT, TOKENS_CSS_PATH)).split(sep).join('/'), /^src\/styles\/tokens\.css$/)
})
