// A redraw of Noah's mark (`design/brand/mandala.py`). Replace it with his vector master (plan Task 15).
// Port of `svg(simple=False)`: three rings, then the flower, then the centre dot.

const STEPS = 720
const STROKE_WIDTH = 2.3

function toPath(radiusAt) {
  const pts = []
  for (let i = 0; i < STEPS; i++) {
    const t = (2 * Math.PI * i) / STEPS
    const r = radiusAt(t)
    pts[i] = `${(50 + r * Math.sin(t)).toFixed(2)} ${(50 - r * Math.cos(t)).toFixed(2)}`
  }
  return 'M' + pts.join(' L') + 'Z'
}

function ring(n, rin, rout, rot) {
  return toPath((t) => {
    const c = Math.abs(Math.cos((n * (t - rot)) / 2))
    const g = 0.88 * c ** 0.42 + 0.12 * (1 - Math.abs(Math.sin((n * (t - rot)) / 2))) ** 5
    return rin + (rout - rin) * g
  })
}

function flower(n, R, rot) {
  return toPath((t) => {
    const c = Math.abs(Math.cos((n * (t - rot)) / 2))
    const g = 0.94 * c ** 0.7 + 0.06 * (1 - Math.abs(Math.sin((n * (t - rot)) / 2))) ** 4
    return 6.4 + (R - 6.4) * g
  })
}

// (petals, valley r, tip r, rotation, ink)
const RINGS = [
  [12, 34.0, 47.0, 0.0, 'var(--mk1)'],
  [12, 24.0, 34.0, Math.PI / 12, 'var(--mk2)'],
  [8, 17.0, 23.5, 0.0, 'var(--mk3)'],
]

export const MANDALA_DOT = { cx: 50, cy: 50, r: 3, fill: 'var(--mk4)' }

export function mandalaShapes() {
  return [
    ...RINGS.map(([n, a, b, rot, stroke]) => ({ d: ring(n, a, b, rot), stroke, strokeWidth: STROKE_WIDTH })),
    { d: flower(6, 14.5, 0.0), stroke: 'var(--mk4)', strokeWidth: STROKE_WIDTH },
  ]
}
