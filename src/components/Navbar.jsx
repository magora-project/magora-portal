import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getListenerAvatarUrl } from '../lib/listener'
import ProfileEditorModal from './ProfileEditorModal'

const TABS = [
  { path: '/',            src: '/icons/live_feed.webp', label: 'Network'    },
  { path: '/journal/me',  src: '/icons/journal.webp',   label: 'Journal', gated: true },
  { path: '/register',    src: '/icons/add_node.webp',  label: 'Add a Node' },
  { path: '/about',       src: '/icons/about.webp',     label: 'About'      },
]

// Collapses the signed-in account controls into a single avatar button that
// opens a small menu — keeps the mobile top bar uncluttered. Closes on outside
// click and whenever the route changes.
function AccountMenu({ user, listener, signOut }) {
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const ref = useRef(null)
  const avatarUrl = getListenerAvatarUrl(listener?.avatar_path)
  const initial = (listener?.display_name || listener?.handle || user.email || '?')[0].toUpperCase()

  // Closing on navigation is already covered: menu items close on click, and
  // tapping a nav tab fires the outside-pointerdown handler below.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        style={{
          width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
          background: '#1D9E75', color: '#fff', fontWeight: 700, fontSize: '14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: open ? '2px solid #5DCAA5' : '2px solid transparent',
          padding: 0, cursor: 'pointer', overflow: 'hidden',
        }}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50,
          minWidth: '170px', background: '#163d22', border: '1px solid #1f5230',
          borderRadius: '12px', padding: '6px', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        }}>
          <Link to="/journal/me" role="menuitem" className="account-menu-item" onClick={() => setOpen(false)}>
            My journal
          </Link>
          {listener?.handle && (
            <button role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); setEditOpen(true) }}>
              Edit profile
            </button>
          )}
          <button role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); signOut() }}>
            Sign out
          </button>
        </div>
      )}
      {editOpen && <ProfileEditorModal onClose={() => setEditOpen(false)} />}
    </div>
  )
}

export default function Navbar() {
  const location = useLocation()
  const { user, listener, signOut, openSignIn } = useAuth()

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img src="/icons/icon-512.png.webp" alt="Magora" style={{
          width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        }} />
        <div className="brand-text">
          <div className="brand-title">Magora</div>
          <div className="brand-sub">Social Ecology</div>
        </div>

        <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user ? (
            <AccountMenu user={user} listener={listener} signOut={signOut} />
          ) : (
            <button onClick={openSignIn} style={{
              background: 'transparent', border: '1px solid #1f5230', color: '#c8e6d0',
              borderRadius: '8px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}>
              Sign in
            </button>
          )}
        </div>
      </div>

      <div className="navbar-links">
        {TABS.map(({ path, src, label, gated }) => (
          <Link
            key={path}
            to={path}
            className={location.pathname === path ? 'active' : ''}
            style={{ padding: 0 }}
            // Journal is gated: signed-out users get the sign-in modal instead of
            // navigating (same openSignIn pattern as the header "Sign in" button).
            onClick={gated && !user ? (e) => { e.preventDefault(); openSignIn() } : undefined}
          >
            <img
              src={src}
              alt={label}
              style={{
                width: '100%', height: '100%', display: 'block',
                objectFit: 'cover',
                objectPosition: 'center',
              }}
            />
          </Link>
        ))}
        <Link
          to="/donate"
          className={`donate-tab${location.pathname === '/donate' ? ' active' : ''}`}
          style={{ padding: 0 }}
        >
          <img src="/icons/donate.webp" alt="Donate" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
        </Link>
      </div>
    </nav>
  )
}
