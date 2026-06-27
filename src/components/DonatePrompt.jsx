import { useState, useEffect } from 'react'

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
          background: '#163d22', border: '1px solid #1f5230',
          borderRadius: '20px', padding: '28px 24px',
          width: '100%', maxWidth: '420px',
          margin: '0 16px',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🌿</div>
        <div style={{
          fontFamily: "'Jost', sans-serif",
          fontSize: '18px', fontWeight: '700',
          color: '#f0ede8', textAlign: 'center',
          marginBottom: '10px', letterSpacing: '0.02em',
        }}>
          Finding this valuable?
        </div>
        <div style={{
          fontSize: '14px', color: '#c8e6d0',
          lineHeight: 1.6, textAlign: 'center', marginBottom: '24px',
        }}>
          Magora runs on donated time and hardware.
          If you find this data useful, consider supporting the project.
        </div>

        <a
          href="https://www.zeffy.com/en-US/donation-form/magora"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block', width: '100%', padding: '14px',
            background: '#1D9E75', border: 'none', borderRadius: '10px',
            color: '#fff', fontSize: '15px', fontWeight: '700',
            textAlign: 'center', textDecoration: 'none',
            marginBottom: '10px',
          }}
          onClick={() => setVisible(false)}
        >
          ♥ Donate to the Magora Project
        </a>

        <button
          onClick={() => setVisible(false)}
          style={{
            display: 'block', width: '100%', padding: '12px',
            background: 'transparent', border: '1px solid #1f5230',
            borderRadius: '10px', color: '#7aad8a',
            fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
