import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { AMBER } from '../lib/listen'
import ListenModal from './ListenModal'

// Survives the sign-in step (incl. the Google OAuth full-page redirect) so a
// signed-out user who taps Listen lands straight in the recorder afterward.
const PENDING_KEY = 'magora:pendingListen'

// Amber "Listen" CTA. Opens the recording modal; prompts sign-in first if needed
// (a Listen needs a user_id). `variant`: 'hero' (homepage) | 'pill' (compact).
// `label` overrides the button text (e.g. the About page's "Start listening →");
// when set, the leading 〰 glyph is dropped so custom copy reads cleanly.
export default function ListenButton({ variant = 'pill', label }) {
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

  const style = variant === 'badge' ? badgeStyle : variant === 'hero' ? heroStyle : pillStyle

  return (
    <>
      <button onClick={handleClick} style={style} title="Listen" aria-label="Listen">
        {variant === 'badge' ? (
          <img src="/icons/listen.webp" alt="Listen" style={badgeImgStyle} />
        ) : (
          <>
            {label == null && (
              <span aria-hidden="true" style={{ fontSize: variant === 'pill' ? '1em' : '1.1em' }}>〰</span>
            )}
            {label ?? 'Listen'}
          </>
        )}
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

// Circular poster-badge treatment for a standalone primary CTA (top of the feed).
// The button is just a transparent wrapper; the artwork carries the label.
const badgeStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  lineHeight: 0,
  borderRadius: '50%',
}

const badgeImgStyle = {
  display: 'block',
  width: 'clamp(150px, 44vw, 190px)',
  height: 'auto',
  borderRadius: '50%',
  boxShadow: '0 6px 22px rgba(0, 0, 0, 0.38)',
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
