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
        <div>
          <div className="brand-title">Magora Bird Project</div>
          <div className="brand-sub">Acoustic detection · American West</div>
        </div>
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
