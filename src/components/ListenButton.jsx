import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { AMBER } from '../lib/listen'
import ListenModal from './ListenModal'

// Amber "Listen" CTA. Opens the recording modal; prompts sign-in first if needed
// (a Listen needs a user_id).
// `variant`: 'hero' (homepage, labelled) | 'pill' (labelled) | 'icon' (compact 〰
// only — used in the cramped navbar brand row so it doesn't crowd the wordmark).
export default function ListenButton({ variant = 'pill' }) {
  const { user, openSignIn } = useAuth()
  const [open, setOpen] = useState(false)

  function handleClick() {
    if (!user) { openSignIn(); return }
    setOpen(true)
  }

  const style = variant === 'hero' ? heroStyle : variant === 'icon' ? iconStyle : pillStyle

  return (
    <>
      <button onClick={handleClick} style={style} title="Listen" aria-label="Listen">
        <span aria-hidden="true" style={{ fontSize: variant === 'hero' ? '1.1em' : '1em' }}>〰</span>
        {variant !== 'icon' && 'Listen'}
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

const iconStyle = {
  width: '32px',
  height: '32px',
  flexShrink: 0,
  background: AMBER.base,
  color: AMBER.ink,
  border: 'none',
  borderRadius: '8px',
  fontSize: '16px',
  fontWeight: 800,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
