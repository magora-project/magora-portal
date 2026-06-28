import { useState } from 'react'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a', red: '#c0392b',
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.6 24 4.6 13.3 4.6 4.6 13.3 4.6 24S13.3 43.4 24 43.4 43.4 34.7 43.4 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.6 24 4.6 16.3 4.6 9.7 9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.4c5.2 0 9.9-1.7 13.6-4.8l-6.3-5.2c-2.1 1.4-4.7 2.2-7.3 2.2-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 39 16.2 43.4 24 43.4z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.3 5.2c-.4.4 6.8-4.9 6.8-14.6 0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}

export default function AuthModal({ onClose }) {
  const [stage, setStage] = useState('email') // 'email' | 'code'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function sendCode(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setStage('code')
  }

  async function verify(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    onClose() // session arrives via onAuthStateChange
  }

  async function google() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
    // on success the browser redirects to Google, then back to the app
  }

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={e => e.stopPropagation()} style={S.sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.text }}>Sign in to Magora</div>
          <button onClick={onClose} style={S.close} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.6, marginBottom: '18px' }}>
          Follow listening posts and keep track of the places you care about.
        </p>

        <button onClick={google} style={S.google}>
          <GoogleG /> Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0' }}>
          <span style={{ flex: 1, height: '1px', background: C.border }} />
          <span style={{ fontSize: '11px', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>or</span>
          <span style={{ flex: 1, height: '1px', background: C.border }} />
        </div>

        {stage === 'email' ? (
          <form onSubmit={sendCode}>
            <label style={S.label}>Email</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoFocus style={{ marginBottom: '12px' }}
            />
            <button type="submit" disabled={busy} style={S.primary(busy)}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label style={S.label}>Enter the 6-digit code sent to {email}</label>
            <input
              inputMode="numeric" autoComplete="one-time-code" required value={code}
              onChange={e => setCode(e.target.value)} placeholder="123456" autoFocus
              style={{ marginBottom: '12px', letterSpacing: '0.3em', textAlign: 'center', fontSize: '18px' }}
            />
            <button type="submit" disabled={busy} style={S.primary(busy)}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button type="button" onClick={() => { setStage('email'); setCode(''); setError(null) }} style={S.link}>
              Use a different email
            </button>
          </form>
        )}

        {error && <div style={{ fontSize: '13px', color: '#fb7a6a', marginTop: '12px', lineHeight: 1.5 }}>{error}</div>}
      </div>
    </div>
  )
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto',
  },
  sheet: {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: '18px',
    padding: '22px', width: '100%', maxWidth: '380px',
  },
  close: { background: 'none', border: 'none', color: C.textMuted, fontSize: '16px', cursor: 'pointer', padding: '4px 8px' },
  label: { display: 'block', fontSize: '12px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' },
  google: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    padding: '12px', borderRadius: '10px', background: '#fff', color: '#1a1a1a',
    border: 'none', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  primary: (busy) => ({
    width: '100%', padding: '12px', borderRadius: '10px',
    background: busy ? C.border : C.accent, border: 'none', color: '#fff',
    fontSize: '15px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans', sans-serif",
  }),
  link: {
    width: '100%', marginTop: '10px', background: 'none', border: 'none',
    color: C.accentLight, fontSize: '13px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
}
