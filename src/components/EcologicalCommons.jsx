import { Link } from 'react-router-dom'

const btnBase = {
  display: 'inline-block',
  marginTop: '24px',
  padding: '13px 26px',
  background: 'var(--c-editorial-ink)',
  color: 'var(--c-editorial-bg)',
  border: 'none',
  borderRadius: '3px',
  textDecoration: 'none',
  fontFamily: 'var(--font-display)',
  fontSize: '0.95rem',
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

function CommonsCard({ title, text, cta, to, href }) {
  return (
    <div style={{ border: '1px solid var(--c-editorial-rule)', padding: '40px 36px' }}>
      <h3 style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 900,
        fontSize: 'clamp(1.25rem, 2.5vw, 1.65rem)',
        color: 'var(--c-editorial-ink)',
        textTransform: 'uppercase',
        letterSpacing: '-0.01em',
        lineHeight: 1.15,
        marginBottom: '16px',
      }}>
        {title}
      </h3>
      <p style={{ fontSize: '14px', color: 'var(--c-editorial-text)', lineHeight: 1.75 }}>
        {text}
      </p>
      {to ? (
        <Link to={to} style={btnBase}>{cta}</Link>
      ) : (
        <a href={href} style={btnBase}>{cta}</a>
      )}
    </div>
  )
}

export default function EcologicalCommons() {
  return (
    <section
      className="section-full-bleed"
      style={{ background: 'var(--c-editorial-bg)', padding: '72px 20px 80px', borderTop: '1px solid var(--c-editorial-rule)' }}
    >
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: 'clamp(1.8rem, 3vw, 2.5rem)',
          color: 'var(--c-editorial-ink)',
          textTransform: 'uppercase',
          letterSpacing: '-0.01em',
          marginBottom: '40px',
        }}>
          Join the ecological commons
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
        }}>
          <CommonsCard
            title="Add your listening post"
            text="Deploy a node in your backyard, schoolyard, or wilderness. Every place adds a thread to the ecological record."
            cta="Add a node"
            to="/add-node"
          />
          <CommonsCard
            title="Support open ecological infrastructure"
            text="Magora is community-owned and open source. Your support keeps the network growing and the data free."
            cta="Support the project"
            to="/donate"
          />
        </div>
      </div>
    </section>
  )
}
