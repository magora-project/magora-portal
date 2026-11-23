import { mandalaShapes, MANDALA_DOT } from './mandala.js'

const SHAPES = mandalaShapes()

export default function Mandala({ size = 36, title }) {
  const a11y = title ? { 'aria-label': title } : { 'aria-hidden': true }
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      style={{ flex: 'none' }}
      {...a11y}
    >
      {SHAPES.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
      ))}
      <circle cx={MANDALA_DOT.cx} cy={MANDALA_DOT.cy} r={MANDALA_DOT.r} fill={MANDALA_DOT.fill} />
    </svg>
  )
}
