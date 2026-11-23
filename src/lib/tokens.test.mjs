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

// v4 brand block (plan Task 8). DESIGN.md light values, the Rationale's named inks, the mandala inks and white.
const V4 = ':root[data-brand="v4"]'
const V4_PALETTE = new Set(
  ('#494E3A #2E3226 #F3EFE4 #FFFDF7 #111111 #E0502A #D1D1A7 #3F7350 #24503A #000000 #D9CFB6 #C0392B #838F63 #4E1623' +
    ' #55594A #C9CBA6 #5C8D68 #0F2A1A #FFFFFF').toLowerCase().split(' '),
)

// name -> raw value for the declarations in the rule whose selector is exactly `selector`.
function blockValues(cssText, selector) {
  const out = new Map()
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.trim() !== selector) continue
    for (const [, name, value] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(name, value.trim())
  }
  return out
}

// Third-party logo colours are not brand tokens; under v4 they inherit their :root values; plan deviation D-1.
const THIRD_PARTY_MARKS = ['c-google-yellow', 'c-google-red', 'c-google-green', 'c-google-blue']

test('v4 sets every :root colour token', () => {
  const css = readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8')
  const v4 = definedTokens(css, V4)
  assert.ok(v4.size > 0, 'v4 block is missing')
  const root = definedTokens(css, ':root')
  for (const n of THIRD_PARTY_MARKS) {
    assert.ok(root.has(n), `${n} is not defined in :root`)
    assert.ok(!v4.has(n), `${n} must not be set in v4`)
  }
  assert.deepEqual([...root].filter((n) => !v4.has(n) && !THIRD_PARTY_MARKS.includes(n)), [])
})

test('v4 colour values come from the v4 palette', () => {
  const css = readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8')
  const v4 = blockValues(css, V4)
  assert.ok(v4.size > 0, 'v4 block is missing')
  const off = [...v4].filter(([n, v]) => /^(c-|mk)/.test(n) && !V4_PALETTE.has(v.toLowerCase()))
  assert.deepEqual(off, [])
  assert.equal(v4.get('font-display'), "'Prodiga', serif")
  assert.equal(v4.get('font-label'), "'Epilogue', sans-serif")
  assert.equal(v4.get('font-body'), "'Epilogue', sans-serif")
  for (const [n, v] of [['mk1', '#5C8D68'], ['mk2', '#3F7350'], ['mk3', '#24503A'], ['mk4', '#0F2A1A']]) {
    assert.equal(v4.get(n), v)
    assert.equal(blockValues(css, ':root').get(n), v)
  }
})

test('no dark mode', () => {
  assert.doesNotMatch(readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8'), /prefers-color-scheme/)
})
