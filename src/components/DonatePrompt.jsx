import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function DonatePrompt() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show once per session
    if (sessionStorage.getItem('donate_prompted')) return

    const timer = setTimeout(() => {
      setVisible(true)
      sessionStorage.setItem('donate_prompted', '1')
    }, 60000)

    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 32px',
    }}
      onClick={() => setVisible(false)}
    >
      <div
        style={{
          background: 'var(--c-forest-card)', border: '1px solid var(--c-forest-border)',
          borderRadius: '20px', padding: '28px 24px',
          width: '100%', maxWidth: '420px',
          margin: '0 16px',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🌿</div>
        <div style={{
          fontFamily: 'var(--font-label)',
          fontSize: '18px', fontWeight: '700',
          color: 'var(--c-forest-text)', textAlign: 'center',
          marginBottom: '10px', letterSpacing: '0.02em',
        }}>
          Finding this valuable?
        </div>
        <div style={{
          fontSize: '14px', color: 'var(--c-forest-text-sub)',
          lineHeight: 1.6, textAlign: 'center', marginBottom: '24px',
        }}>
          Magora runs on donated time and hardware.
          If you find this data useful, consider supporting the project.
        </div>

        <Link
          to="/donate"
          style={{
            display: 'block', width: '100%', padding: '14px',
            background: 'var(--c-forest-accent)', border: 'none', borderRadius: '10px',
            color: '#fff', fontSize: '15px', fontWeight: '700',
            textAlign: 'center', textDecoration: 'none',
            marginBottom: '10px',
          }}
          onClick={() => setVisible(false)}
        >
          ♥ See how to help
        </Link>

        <button
          onClick={() => setVisible(false)}
          style={{
            display: 'block', width: '100%', padding: '12px',
            background: 'transparent', border: '1px solid var(--c-forest-border)',
            borderRadius: '10px', color: 'var(--c-forest-text-muted)',
            fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
