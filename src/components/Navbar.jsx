import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const TABS = [
  { path: '/',          src: '/icons/live_feed.svg',  label: 'Network'             },
  { path: '/dashboard', src: '/icons/dashboard.svg',  label: 'Ecological Patterns' },
  { path: '/register',  src: '/icons/add_node.svg',   label: 'Add a Node'          },
  { path: '/about',     src: '/icons/about.svg',      label: 'About the Project', zoom: 1.5 },
]

export default function Navbar() {
  const location = useLocation()
  const { user, signOut, openSignIn } = useAuth()

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img src="/icons/icon-512.png.webp" alt="Magora" style={{
          width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        }} />
        <div>
          <div className="brand-title">Magora</div>
          <div className="brand-sub">Ecological intelligence network</div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {user ? (
            <>
              <span title={user.email} style={{
                width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                background: '#1D9E75', color: '#fff', fontWeight: 700, fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {(user.email || '?')[0].toUpperCase()}
              </span>
              <button onClick={signOut} style={{
                background: 'none', border: 'none', color: '#7aad8a',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '4px',
              }}>
                Sign out
              </button>
            </>
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
        {TABS.map(({ path, src, label, zoom }) => (
          <Link
            key={path}
            to={path}
            className={location.pathname === path ? 'active' : ''}
            style={{ padding: 0 }}
          >
            <img
              src={src}
              alt={label}
              style={{
                width: '100%', height: '100%', display: 'block',
                objectFit: 'contain',
                objectPosition: 'center',
                ...(zoom ? { transform: `scale(${zoom})` } : {}),
              }}
            />
          </Link>
        ))}
        <a
          href="https://www.zeffy.com/en-US/donation-form/magora"
          target="_blank"
          rel="noopener noreferrer"
          className="donate-tab"
          style={{ padding: 0 }}
        >
          <img src="/icons/donate.svg" alt="Donate" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} />
        </a>
      </div>
    </nav>
  )
}
