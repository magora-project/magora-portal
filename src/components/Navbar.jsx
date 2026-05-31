import { Link, useLocation } from 'react-router-dom'

const TABS = [
  { path: '/', icon: '🐦', label: 'Live Feed' },
  { path: '/dashboard', icon: '📊', label: 'Dashboard' },
  { path: '/register', icon: '📋', label: 'Add Node' },
]

export default function Navbar() {
  const location = useLocation()

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img src="/icons/icon-512.png.webp" alt="Magora" style={{
          width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        }} />
        <div style={{ flex: 1 }}>
          <div className="brand-title">Magora Bird Project</div>
          <div className="brand-sub">Acoustic detection · American West</div>
        </div>
        <a
          href="https://www.zeffy.com/en-US/donation-form/magora"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: '#1D9E75', color: '#fff',
            padding: '6px 12px', borderRadius: '8px',
            fontSize: '13px', fontWeight: '700',
            textDecoration: 'none', flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          ♥ Donate
        </a>
      </div>

      <div className="navbar-links">
        {TABS.map(({ path, icon, label }) => (
          <Link
            key={path}
            to={path}
            className={location.pathname === path ? 'active' : ''}
          >
            <span className="tab-icon">{icon}</span>
            <span className="tab-label">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
