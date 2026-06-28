import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { AMBER } from '../lib/listen'
import ListenModal from './ListenModal'

// Amber "Listen" CTA. Opens the recording modal; prompts sign-in first if needed
// (a Listen needs a user_id). `variant`: 'hero' (homepage) | 'pill' (compact).
export default function ListenButton({ variant = 'pill' }) {
  const { user, openSignIn } = useAuth()
  const [open, setOpen] = useState(false)

  function handleClick() {
    if (!user) { openSignIn(); return }
    setOpen(true)
  }

  const style = variant === 'hero' ? heroStyle : pillStyle

  return (
    <>
      <button onClick={handleClick} style={style} title="Listen" aria-label="Listen">
        <span aria-hidden="true" style={{ fontSize: variant === 'hero' ? '1.1em' : '1em' }}>〰</span>
        Listen
      </button>
      {open && <ListenModal onClose={() => setOpen(false)} />}
    </>
  )
}

const heroStyle = {
  padding: '11px 22px',
  background: AMBER.base,
  color: AMBER.ink,
  border: 'none',
  borderRadius: '3px',
  fontFamily: "'Big Shoulders Display', sans-serif",
  fontSize: '1rem',
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
}

const pillStyle = {
  padding: '7px 14px',
  background: AMBER.base,
  color: AMBER.ink,
  border: 'none',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 800,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
}
