import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const location = useLocation()

  return (
    <nav style={{
      background: '#2c2c2a',
      padding: '0 24px',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '50%',
          background: '#3b6d11', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '14px'
        }}>🌿</div>
        <span style={{ color: '#f7f5f0', fontSize: '15px', fontWeight: '500' }}>
          Magora Network
        </span>
        <span style={{ color: '#888780', fontSize: '11px', marginLeft: '4px' }}>
          by the Magora Project
        </span>
      </div>

      <div style={{ display: 'flex', gap: '4px' }}>
        {[
          { path: '/', label: 'Network map' },
          { path: '/dashboard', label: 'My dashboard' },
          { path: '/register', label: 'Add a node' },
        ].map(({ path, label }) => (
          <Link key={path} to={path} style={{
            color: location.pathname === path ? '#f7f5f0' : '#b4b2a9',
            background: location.pathname === path ? '#444441' : 'none',
            textDecoration: 'none',
            fontSize: '12px',
            padding: '6px 12px',
            borderRadius: '6px',
            transition: 'all .15s'
          }}>
            {label}
          </Link>
        ))}
      </div>

      <button style={{
        background: '#3b6d11', color: '#c0dd97', border: 'none',
        padding: '6px 14px', borderRadius: '6px', fontSize: '12px',
        fontWeight: '500'
      }}>
        Sign in
      </button>
    </nav>
  )
}