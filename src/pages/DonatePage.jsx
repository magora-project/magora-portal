import { Link } from 'react-router-dom'

const ZEFFY_URL = 'https://www.zeffy.com/en-US/donation-form/magora'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  red: '#c0392b', accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const WAYS = [
  {
    icon: '📡',
    title: 'Sponsor a listening post',
    body: 'Each node is low-cost, off-the-shelf hardware. Sponsoring one helps a new place get a voice, a backyard, a schoolyard, a reserve, added to the ecological record.',
  },
  {
    icon: '🔓',
    title: 'Keep the data open',
    body: "Support keeps the code, the hardware designs, and the biodiversity data free and public. The ecological record of Earth shouldn't sit behind a paywall.",
  },
  {
    icon: '🌱',
    title: 'Deploy your own',
    body: 'The most direct way to grow the network is to add a place yourself. If you can run a node, that is the biggest contribution of all.',
  },
]

export default function DonatePage() {
  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '56px' }}>

      {/* Hero */}
      <h1 style={{
        fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
        fontSize: 'clamp(2.2rem, 8vw, 3.2rem)', color: C.text, textTransform: 'uppercase',
        letterSpacing: '-0.01em', lineHeight: 1.03, margin: '0 0 18px',
      }}>
        Build the commons<br />with us.
      </h1>
      <p style={{ fontSize: '17px', color: C.textSub, lineHeight: 1.7, margin: '0 0 14px' }}>
        Magora isn't a product. It's shared infrastructure for listening to the living world, and
        it stays free and open because people choose to support it. Your contribution keeps nodes
        recording, data public, and the network growing.
      </p>
      <div style={{ borderLeft: `4px solid ${C.red}`, paddingLeft: '18px', margin: '24px 0 34px' }}>
        <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: '22px', color: C.text, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          Every place is speaking. Help us keep listening.
        </span>
      </div>

      {/* Ways to take part */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
        {WAYS.map(w => (
          <div key={w.title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>{w.icon}</span>
              <h2 style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: '18px', color: C.text, textTransform: 'uppercase', letterSpacing: '0.02em', margin: 0 }}>
                {w.title}
              </h2>
            </div>
            <p style={{ fontSize: '14px', color: C.textSub, lineHeight: 1.65, margin: 0 }}>{w.body}</p>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '28px' }}>
        <a
          href={ZEFFY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, minWidth: '200px', textAlign: 'center', padding: '15px 22px',
            background: C.accent, color: '#fff', borderRadius: '10px', textDecoration: 'none',
            fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '1.05rem', fontWeight: 700,
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}
        >
          ♥ Support the project
        </a>
        <Link
          to="/register"
          style={{
            flex: 1, minWidth: '200px', textAlign: 'center', padding: '13px 22px',
            background: 'transparent', color: C.text, border: `2px solid ${C.border}`,
            borderRadius: '10px', textDecoration: 'none',
            fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '1.05rem', fontWeight: 700,
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}
        >
          Add a listening post
        </Link>
      </div>

      <p style={{ fontSize: '13px', color: C.textMuted, lineHeight: 1.6, textAlign: 'center' }}>
        Community-owned, open source, and built to last. Thank you for keeping it alive.
      </p>

    </div>
  )
}
