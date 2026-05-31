import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const location = useLocation()

  return (
    <nav style={{
        background: '#0d2818',
        borderBottom: '1px solid #1f5230',
        padding: '0 24px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/icons/icon-512.png.webp" alt="Magora" style={{
              width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
            }} />
            <span style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: '20px', fontWeight: '600',
              color: '#f0ede8', letterSpacing: '-0.3px',
            }}>
              Magora Bird Project
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#7aad8a', paddingLeft: '21px', marginTop: '1px' }}>
            Acoustic detection · American West
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { path: '/', label: '🐦 Live Feed' },
            { path: '/dashboard', label: '📊 Dashboard' },
            { path: '/register', label: '+ Add Node' },
          ].map(({ path, label }) => {
            const active = location.pathname === path
            return (
              <Link key={path} to={path} style={{
                color: active ? '#fff' : '#7aad8a',
                background: active ? '#1D9E75' : '#163d22',
                border: `1px solid ${active ? '#1D9E75' : '#1f5230'}`,
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: '700',
                padding: '7px 16px',
                borderRadius: '20px',
                transition: 'all .15s',
              }}>
                {label}
              </Link>
            )
          })}
        </div>
    </nav>
  )
}
