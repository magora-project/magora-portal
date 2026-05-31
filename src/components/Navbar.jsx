import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const location = useLocation()

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-brand">
          <img src="/icons/icon-512.png.webp" alt="Magora" style={{
            width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
          }} />
          <div>
            <div style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: '20px', fontWeight: '600',
              color: '#f0ede8', letterSpacing: '-0.3px', lineHeight: 1.2,
            }}>
              Magora Bird Project
            </div>
            <div style={{ fontSize: '12px', color: '#7aad8a' }}>
              Acoustic detection · American West
            </div>
          </div>
        </div>

        <div className="navbar-links">
          {[
            { path: '/', label: '🐦 Live Feed' },
            { path: '/dashboard', label: '📊 Dashboard' },
            { path: '/register', label: '＋ Add Node' },
          ].map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={location.pathname === path ? 'active' : ''}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
