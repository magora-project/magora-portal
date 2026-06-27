const NODES = [
  { num: '01', label: 'Sound',            detail: '15 seconds of ambient audio' },
  { num: '02', label: 'Detection',        detail: 'BirdNET identifies species + confidence' },
  { num: '03', label: 'Species',          detail: 'Common name, scientific name, range' },
  { num: '04', label: 'Guild',            detail: 'Functional ecological role' },
  { num: '05', label: 'Behavior',         detail: 'Territorial song, alarm call, flight call' },
  { num: '06', label: 'Ecological story', detail: 'What this means for this place' },
]

export default function EcologicalPipeline() {
  return (
    <section
      className="section-full-bleed"
      style={{ background: '#f0ebe0', padding: '72px 20px', borderTop: '1px solid #ccc7b8' }}
    >
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: "'Big Shoulders Display', sans-serif",
          fontWeight: 900,
          fontSize: 'clamp(1.8rem, 3vw, 2.5rem)',
          color: '#1a1a1a',
          textTransform: 'uppercase',
          letterSpacing: '-0.01em',
          marginBottom: '16px',
        }}>
          From birdsong to ecological insight
        </h2>

        <p style={{
          fontSize: '0.95rem',
          color: '#5a5248',
          lineHeight: 1.7,
          maxWidth: '640px',
          marginBottom: '40px',
        }}>
          A single birdcall is never just a bird. The ecosystem is speaking, through the insects,
          the habitat, the season, the health of a place. Here's how one recording becomes an
          ecological story.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          border: '1px solid #b8b0a0',
        }}>
          {NODES.map((node, i) => (
            <div
              key={node.label}
              style={{
                padding: '28px 24px',
                borderRight: i % 3 < 2 ? '1px solid #b8b0a0' : 'none',
                borderBottom: i < 3 ? '1px solid #b8b0a0' : 'none',
              }}
            >
              <div style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#9a9080',
                letterSpacing: '0.14em',
                marginBottom: '12px',
              }}>
                {node.num}
              </div>
              <div style={{
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontWeight: 700,
                fontSize: '1.05rem',
                color: '#1a1a1a',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '8px',
                lineHeight: 1.2,
              }}>
                {node.label}
              </div>
              <div style={{
                fontSize: '13px',
                color: '#5a5248',
                lineHeight: 1.6,
              }}>
                {node.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
