import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createListener, validateHandle } from '../lib/listener'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

// Shown once per sign-in (dismissable) to a signed-in Listener who hasn't claimed
// a handle yet. A handle is what links their Listens to a public field journal
// ("Listened by @you"). Rendered at the app root by AuthProvider; the full claim
// form with avatar/bio/region still lives on /journal/:handle.
export default function HandlePrompt({ onDismiss }) {
  const { user, refreshListener } = useAuth()
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!user || saving) return
    const normalized = handle.toLowerCase().trim()
    const validation = validateHandle(normalized)
    if (validation) { setError(validation); return }

    setSaving(true); setError(null)
    try {
      const created = await createListener({
        id: user.id,
        handle: normalized,
        display_name: displayName.trim() || null,
      })
      await refreshListener()
      onDismiss()
      navigate(`/journal/${created.handle}`)
    } catch (err) {
      console.warn('Handle claim failed:', err)
      // 23505 = unique_violation: someone already took this handle.
      setError(err?.code === '23505'
        ? 'That handle is already taken. Try another.'
        : (err?.message || 'Could not claim that handle. Try another.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onDismiss} style={S.overlay}>
      <div onClick={e => e.stopPropagation()} style={S.sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.text }}>Claim your field journal</div>
          <button onClick={onDismiss} style={S.close} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.6, marginBottom: '18px' }}>
          Pick a handle so your Listens show “Listened by @you” and link to your own field journal. You can change your display name and add a photo later.
        </p>

        <form onSubmit={submit}>
          <label style={S.label}>Handle</label>
          <div style={S.handleWrap}>
            <span style={S.at}>@</span>
            <input
              value={handle}
              onChange={e => setHandle(e.target.value.toLowerCase())}
              placeholder="your_handle"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={S.handleInput}
            />
          </div>

          <label style={S.label}>Display name <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="How your name shows on the journal"
            style={{ marginBottom: '16px' }}
          />

          <button type="submit" disabled={saving} style={S.primary(saving)}>
            {saving ? 'Claiming…' : 'Create my handle'}
          </button>
          <button type="button" onClick={onDismiss} style={S.link}>
            Maybe later
          </button>
        </form>

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
  handleWrap: {
    display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px',
    background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '0 12px',
  },
  at: { color: C.textMuted, fontSize: '15px', fontWeight: 700 },
  handleInput: {
    flex: 1, background: 'none', border: 'none', color: C.text,
    fontSize: '15px', padding: '11px 0', outline: 'none', fontFamily: "'DM Sans', sans-serif",
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
