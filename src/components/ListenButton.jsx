import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { AMBER } from '../lib/listen'
import ListenModal from './ListenModal'

// Survives the sign-in step (incl. the Google OAuth full-page redirect) so a
// signed-out user who taps Listen lands straight in the recorder afterward.
const PENDING_KEY = 'magora:pendingListen'

// Amber "Listen" CTA. Opens the recording modal; prompts sign-in first if needed
// (a Listen needs a user_id). `variant`: 'hero' (homepage) | 'pill' (compact).
export default function ListenButton({ variant = 'pill' }) {
  const { user, openSignIn } = useAuth()
  const [open, setOpen] = useState(false)

  function handleClick() {
    if (!user) {
      // Remember the intent through sign-in, then continue into the recorder.
      sessionStorage.setItem(PENDING_KEY, '1')
      openSignIn()
      return
    }
    setOpen(true)
  }

  // Once signed in, resume a pending Listen. Clear the flag before opening so that
  // with two ListenButtons mounted (homepage hero + navbar) only one opens. The
  // trigger is an external auth-state change (from AuthProvider), so reacting in
  // an effect is the right place despite the set-state-in-effect lint.
  useEffect(() => {
    if (user && sessionStorage.getItem(PENDING_KEY) === '1') {
      sessionStorage.removeItem(PENDING_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true)
    }
  }, [user])

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
