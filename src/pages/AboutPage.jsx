const C = {
  bg:        '#0d2818',
  card:      '#163d22',
  border:    '#1f5230',
  red:       '#c0392b',
  text:      '#f0ede8',
  textSub:   '#c8e6d0',
  textMuted: '#7aad8a',
}

const Section = ({ title, children }) => (
  <div style={{ marginBottom: '32px' }}>
    <div style={{
      fontFamily: "'Big Shoulders Display', sans-serif",
      fontSize: '22px', fontWeight: '900',
      color: C.red, textTransform: 'uppercase',
      letterSpacing: '0.04em', marginBottom: '12px',
    }}>
      {title}
    </div>
    {children}
  </div>
)

const P = ({ children, style }) => (
  <p style={{
    fontSize: '16px', color: C.textSub,
    lineHeight: 1.75, marginBottom: '14px',
    ...style,
  }}>
    {children}
  </p>
)

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '48px' }}>

      {/* Title */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontFamily: "'Big Shoulders Display', sans-serif",
          fontSize: '38px', fontWeight: '900',
          color: C.text, textTransform: 'uppercase',
          letterSpacing: '0.02em', lineHeight: 1.1,
          marginBottom: '24px',
        }}>
          What Is Magora<br />Bird Project?
        </h1>

        {/* Intro */}
        <P style={{ fontSize: '17px', fontStyle: 'italic', color: C.text }}>
          Right now, outside your window, birds are talking. Defending territory,
          calling for mates, warning each other about predators. They've been doing
          this for millions of years. Until now, nobody was listening at scale.
        </P>

        {/* Pull quote */}
        <div style={{
          borderLeft: `4px solid ${C.red}`,
          paddingLeft: '18px',
          margin: '24px 0',
        }}>
          <span style={{
            fontFamily: "'Big Shoulders Display', sans-serif",
            fontSize: '28px', fontWeight: '900',
            color: C.text, textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}>
            Magora changes that.
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: C.border, marginBottom: '32px' }} />

      <Section title="What It Is">
        <P>
          Small listening devices — about the size of a deck of cards — installed
          outdoors and left running. Each one listens 24 hours a day, identifies
          every bird species it hears using AI, and sends that data to a shared
          platform anyone can explore.
        </P>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: '12px', padding: '16px 20px',
          margin: '16px 0',
        }}>
          <P style={{ marginBottom: 0, fontStyle: 'italic', color: C.text }}>
            A neighborhood watch for ecosystems. Except instead of watching for
            trouble, we're listening for life.
          </P>
        </div>
      </Section>

      <Section title="Why It Matters">
        <P>
          Birds are the most sensitive indicators of ecosystem health on the planet.
          Three billion have disappeared from North America since 1970.
        </P>
        <div style={{
          fontFamily: "'Big Shoulders Display', sans-serif",
          fontSize: '52px', fontWeight: '900',
          color: C.red, lineHeight: 1, margin: '16px 0',
        }}>
          3,000,000,000.
        </div>
        <P>
          Magora nodes never sleep, never need a scientist present, and cost under
          $40 to build. Over years and decades, the data they collect becomes the
          kind of long-term ecological record that researchers desperately need but
          rarely have.
        </P>
      </Section>

      <Section title="Who It's For">
        <P>
          You don't need to be a scientist. You just need to be curious about the
          living world around you.
        </P>
        <P>
          Your backyard matters. Your forest edge matters. Your urban rooftop
          matters. Every location adds to a picture no single researcher could
          ever paint alone.
        </P>
        <div style={{
          borderLeft: `4px solid ${C.red}`,
          paddingLeft: '18px',
          marginTop: '24px',
        }}>
          <span style={{
            fontFamily: "'Big Shoulders Display', sans-serif",
            fontSize: '24px', fontWeight: '900',
            color: C.text, textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}>
            Welcome to the network.
          </span>
        </div>
      </Section>

    </div>
  )
}
