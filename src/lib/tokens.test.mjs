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

test('token() is never called at module scope', () => {
  const offenders = []
  for (const file of sourceFiles(['.js', '.jsx'])) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (/^(export )?const .*token\(/.test(line)) offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
})

test('the font tokens hold the current families', () => {
  const css = readFileSync(join(ROOT, TOKENS_CSS_PATH), 'utf8')
  assert.deepEqual([...definedTokens(css, ':root')].filter((n) => n.startsWith('font-')).sort(), ['font-body', 'font-display', 'font-label'])
  assert.match(relative(ROOT, join(ROOT, TOKENS_CSS_PATH)), /^src\/styles\/tokens\.css$/)
})
