// No-hex guard (portal v4 spec §1 criterion 5, §6; plan Task 6). Every six- and eight-digit hex colour
// under src/ comes from src/styles/tokens.css, so such a literal in any other .js, .jsx or .css file
// under src/ fails `npm test`. Three-digit hexes (#fff) and rgba() values are not checked: spec §6 names
// `#[0-9a-fA-F]{6}`. Image assets (.svg, .png, …) and tests (.mjs) are not scanned.
// Run: node scripts/ci/no-hex-literals.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXEMPT = 'src/styles/tokens.css'
const SCANNED = /\.(js|jsx|css)$/
const HEX = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g

// Every hex literal in <root>/src/**/*.{js,jsx,css} except the exact path src/styles/tokens.css.
// Paths are `/`-joined and relative to root. A symlink is refused, because it could hide a file.
export function findHexLiterals(root) {
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`symlinks are not supported: ${rel}`)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && SCANNED.test(entry.name) && rel !== EXEMPT) {
        readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
          for (const [match] of text.matchAll(HEX)) hits.push({ file: rel, line: i + 1, match })
        })
      }
    }
  }
  walk(join(root, 'src'))
  return hits
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'no-hex-selftest-'))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}

function withFixture(files, fn) {
  const root = fixture(files)
  try { fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('the repo has no six-digit literal outside tokens.css', () => {
  assert.deepEqual(findHexLiterals(REPO_ROOT), [])
})

test('a literal in a .jsx is found', () => {
  withFixture({ 'src/a.jsx': "const x = '#abcdef'\n" }, (root) => {
    assert.deepEqual(findHexLiterals(root), [{ file: 'src/a.jsx', line: 1, match: '#abcdef' }])
  })
})

test('an eight-digit literal is found', () => {
  withFixture({ 'src/a.css': 'a { color: #abcdef80; }\n' }, (root) => {
    assert.deepEqual(findHexLiterals(root), [{ file: 'src/a.css', line: 1, match: '#abcdef80' }])
  })
})

test('a tokens.css elsewhere is scanned', () => {
  withFixture({ 'src/other/tokens.css': ':root { --x: #abcdef; }\n', 'src/styles/tokens.css': ':root { --y: #abcdef; }\n' }, (root) => {
    assert.deepEqual(findHexLiterals(root), [{ file: 'src/other/tokens.css', line: 1, match: '#abcdef' }])
  })
})

test('images are not scanned', () => {
  withFixture({ 'src/assets/x.svg': '<svg fill="#abcdef"/>\n' }, (root) => {
    assert.deepEqual(findHexLiterals(root), [])
  })
})
