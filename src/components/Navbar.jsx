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
      {/* Brand row */}
      <div className="navbar-brand">
        <span className="brand-dot" />
        <div>
          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: '22px', fontWeight: '600',
            color: '#f0ede8', letterSpacing: '-0.3px', lineHeight: 1.2,
          }}>
            Magora Bird Project
          </div>
          <div style={{ fontSize: '13px', color: '#7aad8a' }}>
            Acoustic detection · American West
          </div>
        </div>
      </div>

      {/* Tab row */}
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
