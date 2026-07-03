import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { updateListener, uploadListenerAvatar } from '../lib/listener'
import { setFollowsPublic } from '../lib/journalFollows'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

// Edit-your-profile form as an app-root modal, opened from the navbar account
// menu. Reads the current listener from context, so it works from any page.
export default function ProfileEditorModal({ onClose }) {
  const { listener, refreshListener, openSignIn } = useAuth()
  const [displayName, setDisplayName] = useState(listener?.display_name || '')
  const [homeRegion, setHomeRegion] = useState(listener?.home_region || '')
  const [bio, setBio] = useState(listener?.bio || '')
  const [avatar, setAvatar] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Follow-visibility consent — default OFF (the DB column defaults to false), so
  // opting in is always a deliberate act. Saved immediately on toggle.
  const [followsPublic, setFollowsPublicState] = useState(!!listener?.follows_public)
  const [visBusy, setVisBusy] = useState(false)

  async function toggleFollowsPublic() {
    const next = !followsPublic
    setVisBusy(true)
    setFollowsPublicState(next) // optimistic
    try {
      await setFollowsPublic(next)
      await refreshListener()
    } catch (err) {
      console.warn('Follow-visibility save failed:', err)
      setFollowsPublicState(!next) // revert
      setError(err.message || 'Unable to update follow visibility right now.')
    } finally {
      setVisBusy(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // The avatar upload and the listeners UPDATE are RLS-gated on auth.uid();
      // a lapsed session would fail with a cryptic "new row violates row-level
      // security policy". getSession() refreshes a valid one, else prompt re-auth.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Your session has expired. Please sign in again to save your profile.')
        openSignIn()
        return
      }
      const uid = session.user.id

      let avatar_path = listener?.avatar_path ?? null
      if (avatar) {
        avatar_path = await uploadListenerAvatar(uid, avatar)
      }
      await updateListener(uid, {
        display_name: displayName || null,
        bio: bio || null,
        home_region: homeRegion || null,
        avatar_path,
      })
      await refreshListener()
      onClose()
    } catch (err) {
      console.warn('Profile save failed:', err)
      setError(err.message || 'Unable to save your profile right now.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={e => e.stopPropagation()} style={S.sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.text }}>Edit your profile</div>
          <button onClick={onClose} style={S.close} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
          <label style={S.label}>
            Display name
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" style={S.input} />
          </label>
          <label style={S.label}>
            Home region
            <input value={homeRegion} onChange={e => setHomeRegion(e.target.value)} placeholder="E.g. Rocky Mountains" style={S.input} />
          </label>
          <label style={S.label}>
            Bio
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="A short sentence about why you listen." style={S.textarea} />
          </label>
          <label style={S.label}>
            Profile avatar
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAvatar(e.target.files?.[0] || null)} style={S.fileInput} />
          </label>
          {/* Follow-visibility consent. Default OFF and shown as such, so making
              your follows public is always a deliberate opt-in. */}
          <div style={S.toggleRow}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>Show the nodes I follow to others</div>
              <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '4px', lineHeight: 1.5 }}>
                {followsPublic
                  ? 'On — your name can appear in a node’s follower list.'
                  : 'Off — your follows stay private. Only a node’s total follower count includes you.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={followsPublic}
              aria-label="Show the nodes I follow to others"
              onClick={toggleFollowsPublic}
              disabled={visBusy}
              style={S.switch(followsPublic, visBusy)}
            >
              <span style={S.switchKnob(followsPublic)} />
            </button>
          </div>

          {error && <div style={S.error}>{error}</div>}
          <button type="submit" disabled={saving} style={S.primaryButton(saving)}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
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
    padding: '22px', width: '100%', maxWidth: '420px',
  },
  close: { background: 'none', border: 'none', color: C.textMuted, fontSize: '16px', cursor: 'pointer', padding: '4px 8px' },
  label: { display: 'flex', flexDirection: 'column', gap: '8px', color: C.textMuted, fontSize: '13px' },
  input: {
    background: '#0f2918', border: `1px solid ${C.border}`, borderRadius: '12px', color: C.text,
    padding: '12px 14px', fontSize: '14px', width: '100%', boxSizing: 'border-box',
  },
  textarea: {
    background: '#0f2918', border: `1px solid ${C.border}`, borderRadius: '12px', color: C.text,
    padding: '12px 14px', fontSize: '14px', width: '100%', boxSizing: 'border-box',
  },
  fileInput: { color: C.textMuted, fontSize: '13px', marginTop: '6px' },
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px',
    background: '#0f2918', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px',
  },
  switch: (on, busy) => ({
    flexShrink: 0, width: '46px', height: '26px', borderRadius: '999px', position: 'relative',
    cursor: busy ? 'default' : 'pointer', padding: 0, opacity: busy ? 0.7 : 1,
    background: on ? C.accent : C.border, border: `1px solid ${on ? C.accent : C.border}`,
    transition: 'background 0.15s ease',
  }),
  switchKnob: (on) => ({
    position: 'absolute', top: '2px', left: on ? '22px' : '2px', width: '20px', height: '20px',
    borderRadius: '50%', background: '#fff', transition: 'left 0.15s ease',
  }),
  error: { color: '#fb7a6a', fontSize: '13px', background: '#3e1f16', borderRadius: '12px', padding: '10px' },
  primaryButton: (busy) => ({
    background: busy ? '#1a3a28' : C.accentLight, color: C.bg,
    border: 'none', borderRadius: '12px', padding: '12px 18px', cursor: busy ? 'default' : 'pointer', fontWeight: 700,
  }),
}
