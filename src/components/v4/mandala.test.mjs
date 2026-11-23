import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mandalaShapes, MANDALA_DOT } from './mandala.js'

// First 40 characters of each path from `python3 design/brand/mandala.py`.
const PY_PREFIX = [
  'M50.00 3.00 L50.41 3.38 L50.81 3.70 L51.',
  'M50.00 26.00 L50.23 23.45 L50.48 22.60 L',
  'M50.00 26.50 L50.20 26.63 L50.41 26.75 L',
  'M50.00 35.50 L50.13 35.55 L50.25 35.60 L',
]

test('the outer ring starts at the top tip', () => {
  assert.ok(mandalaShapes()[0].d.startsWith('M50.00 3.00'))
})

test('each ring has 720 points', () => {
  const shapes = mandalaShapes()
  assert.equal(shapes.length, 4)
  for (const s of shapes) assert.equal(s.d.split(' L').length - 1, 719)
})

test('shapes match the Python source', () => {
  mandalaShapes().forEach((s, i) => assert.equal(s.d.slice(0, 40), PY_PREFIX[i]))
})

test('strokes are the mark variables, width 2.3', () => {
  assert.deepEqual(mandalaShapes().map((s) => s.stroke), ['var(--mk1)', 'var(--mk2)', 'var(--mk3)', 'var(--mk4)'])
  for (const s of mandalaShapes()) assert.equal(s.strokeWidth, 2.3)
  assert.deepEqual(MANDALA_DOT, { cx: 50, cy: 50, r: 3, fill: 'var(--mk4)' })
})

test('no literal colours', () => {
  for (const s of [...mandalaShapes(), MANDALA_DOT]) {
    assert.doesNotMatch(JSON.stringify(s), /#[0-9a-f]{6}/i)
  }
})
