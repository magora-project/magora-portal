import { Link } from 'react-router-dom'

const C = {
  bg:        '#0d2818',
  card:      '#163d22',
  border:    '#1f5230',
  red:       '#c0392b',
  accent:    '#1D9E75',
  text:      '#f0ede8',
  textSub:   '#c8e6d0',
  textMuted: '#7aad8a',
}

const Section = ({ title, children }) => (
  <div style={{ marginBottom: '34px' }}>
    <div style={{
      fontFamily: "'Big Shoulders Display', sans-serif",
      fontSize: '22px', fontWeight: '900',
      color: C.red, textTransform: 'uppercase',
      letterSpacing: '0.04em', marginBottom: '12px', lineHeight: 1.1,
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

const Pull = ({ children }) => (
  <div style={{ borderLeft: `4px solid ${C.red}`, paddingLeft: '18px', margin: '24px 0' }}>
    <span style={{
      fontFamily: "'Big Shoulders Display', sans-serif",
      fontSize: '24px', fontWeight: '900',
      color: C.text, textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1.15,
    }}>
      {children}
    </span>
  </div>
)

const Pillar = ({ label, children }) => (
  <div style={{ marginBottom: '14px' }}>
    <span style={{ fontWeight: '700', color: C.text }}>{label}.</span>{' '}
    <span style={{ color: C.textSub }}>{children}</span>
  </div>
)

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '56px' }}>

      {/* Hero */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{
          fontFamily: "'Big Shoulders Display', sans-serif",
          fontSize: 'clamp(2.4rem, 9vw, 3.4rem)', fontWeight: '900',
          color: C.text, textTransform: 'uppercase',
          letterSpacing: '-0.01em', lineHeight: 1.02, marginBottom: '20px',
        }}>
          Every place<br />is speaking.
        </h1>
        <P style={{ fontSize: '17px', color: C.text }}>
          Magora is an open-source ecological intelligence network. Low-cost listening posts
          record the soundscape of a place — the birds, the insects, the wind, the weather,
          the quiet — and turn it into a living record of how that ecosystem is doing, and how
          it changes over time.
        </P>
        <Pull>It starts with birdsong. But it was never only about the birds.</Pull>
      </div>

      <div style={{ height: '1px', background: C.border, marginBottom: '34px' }} />

      <Section title="What we're really listening to">
        <P style={{ fontStyle: 'italic', color: C.text }}>A bird is not just a bird. It's a signal.</P>
        <P>
          Birds sit near the top of the food web, and they respond fast to change — in the
          insects they eat, the plants they shelter in, the water that moves through a
          landscape, the timing of the seasons. When the community of birds at a place shifts,
          it's rarely about the birds themselves. It's the whole ecosystem underneath them,
          moving.
        </P>
        <P>
          So a list of species recorded at a listening post is really a readout of something
          larger: habitat quality, food availability, seasonal timing, the health of a place.
          Birds are the first thing the land tells us. They are an entry point, not the
          destination.
        </P>
      </Section>

      <Section title="Soundscape health">
        <P>
          Species tell us <em>who</em> is here. Soundscape health tells us how alive the whole
          place <em>sounds</em>.
        </P>
        <P>
          Every listening post continuously measures the complexity and richness of its entire
          soundscape — not just the species it can name, but the full acoustic texture of a
          place. We call this soundscape health. A rich, layered soundscape — overlapping
          songs, insects, movement, depth — signals a healthy, active ecosystem. A thinning one
          can signal stress long before any single species disappears.
        </P>
        <P>
          Together, species detections and soundscape health give a fuller picture than either
          could alone: who lives here, how the place is doing, and what is beginning to change.
        </P>
      </Section>

      <Section title="The bigger record">
        <P style={{ fontStyle: 'italic', color: C.text }}>
          Birdsong is the first sensing layer. It is not the last.
        </P>
        <P>
          Magora is built to grow. The same listening posts are designed to take on more senses
          over time — temperature, humidity, light, and other environmental signals — so that a
          node becomes a fuller witness to its place. The longer a post listens, the more it can
          reveal: the shifting timing of the dawn chorus across a season, species arriving
          earlier or ranging into new territory, the slow signatures of a changing climate
          written into the soundscape.
        </P>
        <P>
          This is what turns scattered recordings into ecological memory — a continuous,
          place-based account of a living system, kept over years.
        </P>
      </Section>

      <Section title="Why this matters — and why you">
        <P>
          Most people experience nature as something they visit. Magora is built on a different
          idea: that you are not a visitor to your ecosystem. You are part of it.
        </P>
        <P>
          When you follow a listening post — your backyard, your schoolyard, a wash near where
          you camp, a restoration site you care about — something quietly changes. You start to
          notice the rhythm of a place. You hear it wake up at dawn. You watch the species turn
          over with the seasons. You begin to feel the threads that connect you to the living
          system around you, the one you were always part of but rarely stopped to hear.
        </P>
        <P>
          That's the real work here. Not collecting data. Helping people build a relationship
          with the living world, and discover how deeply they belong to it.
        </P>
      </Section>

      <Section title="Built in the open, built for everyone">
        <P>Magora stands on four commitments:</P>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: '12px', padding: '18px 20px', marginTop: '4px',
        }}>
          <Pillar label="Accessible">
            Listening posts are built from low-cost, off-the-shelf parts. Anyone should be able
            to deploy one — no specialist hardware, no gatekeeping.
          </Pillar>
          <Pillar label="Open source">
            All of it — the code, the hardware designs, the data — is free and open. The
            ecological record of Earth shouldn't be anyone's private property.
          </Pillar>
          <Pillar label="Research-grade">
            The data is rigorous enough to matter to scientists, and contributes to the broader
            record of biodiversity. Citizen science here is real science.
          </Pillar>
          <Pillar label="Community-owned">
            The network grows through the people who tend it. Schools, families, researchers,
            land trusts, restoration projects — each listening post is a place with a steward,
            and the network is the sum of those relationships.
          </Pillar>
        </div>
      </Section>

      <Section title="The invitation">
        <P>
          Every place is speaking. Every listening post helps us hear it. Every steward helps
          build the ecological record of Earth — and, along the way, a deeper bond with the
          living world they're part of.
        </P>
        <P style={{ color: C.text }}>
          You can listen. You can add a place. You can help the network grow.
        </P>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '20px' }}>
          <Link to="/" style={{
            padding: '12px 22px', background: C.accent, color: '#fff',
            borderRadius: '8px', textDecoration: 'none',
            fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '1rem',
            fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Explore the network
          </Link>
          <Link to="/register" style={{
            padding: '10px 22px', background: 'transparent', color: C.text,
            border: `2px solid ${C.border}`, borderRadius: '8px', textDecoration: 'none',
            fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '1rem',
            fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Add a listening post
          </Link>
        </div>
      </Section>

    </div>
  )
}
