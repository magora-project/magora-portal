import { Link, useLocation } from 'react-router-dom'

const TABS = [
  { path: '/',          src: '/icons/live_feed.svg',  label: 'Live Feed'  },
  { path: '/dashboard', src: '/icons/dashboard.svg',  label: 'Dashboard'  },
  { path: '/register',  src: '/icons/add_node.svg',   label: 'Add Node'   },
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
          <div className="brand-sub">Citizen Science BioAcoustics</div>
        </div>
      </div>

      <div className="navbar-links">
        {TABS.map(({ path, src, label }) => (
          <Link
            key={path}
            to={path}
            className={location.pathname === path ? 'active' : ''}
          >
            <span className="tab-icon">
              <img src={src} alt={label} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
            </span>
            <span className="tab-label">{label}</span>
          </Link>
        ))}
        <a
          href="https://www.zeffy.com/en-US/donation-form/magora"
          target="_blank"
          rel="noopener noreferrer"
          className="donate-tab"
        >
          <span className="tab-icon">
            <img src="/icons/donate.svg" alt="Donate" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          </span>
          <span className="tab-label">Donate</span>
        </a>
      </div>
    </nav>
  )
}
