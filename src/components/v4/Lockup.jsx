import Mandala from './Mandala.jsx'

// The mockups' `.mark`: 36px mark, 10px gap, 24px MAGORA over spaced PROJECT.
const WRAP = {
  display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1,
  fontFamily: 'var(--font-display)', textTransform: 'uppercase', fontSynthesis: 'none',
  fontWeight: 400, letterSpacing: '.01em',
}
const WORD = { display: 'flex', flexDirection: 'column', fontSize: 24, lineHeight: 0.86 }
const SUB = {
  fontFamily: 'var(--font-body)', fontWeight: 300, fontSize: 7.4,
  letterSpacing: '1.05em', marginTop: 4, opacity: 0.78,
}

export default function Lockup() {
  return (
    <div style={WRAP}>
      <Mandala size={36} />
      <span style={WORD}>
        Magora
        <small style={SUB}>Project</small>
      </span>
    </div>
  )
}
