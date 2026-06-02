import { Link, useLocation } from 'react-router-dom'

// Stencil-style SVG icons — bold, simplified silhouettes

const BirdIcon = () => (
  <svg viewBox="0 0 28 24" width="28" height="24" fill="currentColor">
    {/* Bold bird in profile — head, beak, body, wing, tail */}
    <circle cx="20" cy="7" r="4" />
    <path d="M24 8 L28 6 L25 10 Z" />
    <ellipse cx="14" cy="13" rx="8" ry="5" />
    <path d="M6 10 L2 7 L5 13 Z" />
    <path d="M6 14 L1 17 L7 16 Z" />
    <circle cx="21.5" cy="5.5" r="1" fill="#163d22" />
  </svg>
)

const WaveformIcon = () => (
  <svg viewBox="0 0 28 24" width="28" height="24" fill="currentColor">
    {/* Acoustic waveform — bold vertical bars, stencil equalizer */}
    <rect x="0"  y="10" width="4" height="10" rx="1" />
    <rect x="6"  y="4"  width="4" height="16" rx="1" />
    <rect x="12" y="1"  width="4" height="22" rx="1" />
    <rect x="18" y="4"  width="4" height="16" rx="1" />
    <rect x="24" y="10" width="4" height="10" rx="1" />
  </svg>
)

const TowerIcon = () => (
  <svg viewBox="0 0 28 28" width="28" height="28" fill="currentColor">
    {/* Broadcast tower — triangle legs + signal arcs */}
    <path d="M14 8 L8 24 L11 24 L14 14 L17 24 L20 24 Z" />
    <circle cx="14" cy="7" r="2.5" />
    {/* Signal arcs — stroke only, rendered as filled wedge shapes */}
    <path d="M7 3 C4 5 4 11 7 13 L8.5 11 C7 10 7 6 8.5 5 Z" />
    <path d="M21 3 C24 5 24 11 21 13 L19.5 11 C21 10 21 6 19.5 5 Z" />
    <path d="M3 0 C-1 4 -1 14 3 18 L4.5 16 C2 13 2 5 4.5 2 Z" />
    <path d="M25 0 C29 4 29 14 25 18 L23.5 16 C26 13 26 5 23.5 2 Z" />
  </svg>
)

const FistIcon = () => (
  <svg viewBox="0 0 24 28" width="22" height="28" fill="currentColor">
    {/* Raised fist — classic solidarity stencil */}
    {/* Four fingers */}
    <rect x="5"  y="1" width="3" height="8" rx="1.5" />
    <rect x="9"  y="0" width="3" height="9" rx="1.5" />
    <rect x="13" y="1" width="3" height="8" rx="1.5" />
    <rect x="17" y="3" width="3" height="6" rx="1.5" />
    {/* Knuckle bar connecting fingers */}
    <rect x="5" y="7" width="15" height="4" rx="1" />
    {/* Palm */}
    <path d="M4 11 L20 11 L19 22 L5 22 Z" />
    {/* Thumb */}
    <path d="M17 8 L21 6 L22 10 L18 11 Z" />
    {/* Wrist */}
    <rect x="6" y="22" width="12" height="5" rx="1" />
  </svg>
)

const TABS = [
  { path: '/', Icon: BirdIcon,    label: 'Live Feed' },
  { path: '/dashboard', Icon: WaveformIcon, label: 'Dashboard' },
  { path: '/register',  Icon: TowerIcon,   label: 'Add Node'  },
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
        {TABS.map(({ path, Icon, label }) => (
          <Link
            key={path}
            to={path}
            className={location.pathname === path ? 'active' : ''}
          >
            <span className="tab-icon"><Icon /></span>
            <span className="tab-label">{label}</span>
          </Link>
        ))}
        <a
          href="https://www.zeffy.com/en-US/donation-form/magora"
          target="_blank"
          rel="noopener noreferrer"
          className="donate-tab"
        >
          <span className="tab-icon"><FistIcon /></span>
          <span className="tab-label">Donate</span>
        </a>
      </div>
    </nav>
  )
}
