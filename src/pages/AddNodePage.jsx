import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { buildDocHtml, buildDocSource } from '../generated/build-doc'

// The Add Node experience. The invitation and the payoff live here; the parts list and the
// walkthrough do NOT — they are rendered from BUILD.md in the firmware repo, vendored at build
// time by scripts/vendor-build-doc.mjs. Never paste build content into this file: a second copy
// of the parts list is exactly the drift this page is structured to avoid.

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

export default function AddNodePage() {
  const { user, openSignIn } = useAuth()

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '48px 20px 96px' }}>

        {/* ── Invitation ───────────────────────────────────────────────── */}
        <header style={{ marginBottom: '40px' }}>
          <p style={{
            color: C.accentLight, fontSize: '13px', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px',
          }}>
            Add a place
          </p>
          <h1 style={{
            fontSize: 'clamp(32px, 6vw, 48px)', lineHeight: 1.1,
            margin: '0 0 20px', fontWeight: 800,
          }}>
            Every place is already speaking.
          </h1>
          <p style={{ fontSize: '19px', lineHeight: 1.6, color: C.textSub, margin: '0 0 16px' }}>
            A Magora node is a small computer with a microphone that listens to one place,
            continuously, and publishes what it hears. Not a gadget you check — a place that
            keeps its own record.
          </p>
          <p style={{ fontSize: '17px', lineHeight: 1.6, color: C.textMuted, margin: 0 }}>
            You don't need to solder anything, and you don't need to have used a terminal before.
            About an hour of assembly and roughly $130–165 in parts. What you get back is a page
            that fills itself in — your place, in its own voice, from the first bird it hears.
          </p>
        </header>

        {/* ── Primary action ───────────────────────────────────────────── */}
        <section style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: '20px', padding: '24px', marginBottom: '40px',
        }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px', fontWeight: 700 }}>
            Ready when you are
          </h2>
          <p style={{ color: C.textSub, fontSize: '15px', lineHeight: 1.6, margin: '0 0 18px' }}>
            Registering takes a minute and gives you the config file your node needs. You can do it
            before the parts arrive — the guide below picks up from there.
          </p>
          {user ? (
            <Link
              to="/register"
              style={{
                display: 'inline-block', background: C.accent, color: '#fff',
                padding: '13px 22px', borderRadius: '12px', fontWeight: 700,
                textDecoration: 'none', fontSize: '15px',
              }}
            >
              Register your place
            </Link>
          ) : (
            <button
              onClick={openSignIn}
              style={{
                background: C.accent, color: '#fff', border: 'none',
                padding: '13px 22px', borderRadius: '12px', fontWeight: 700,
                fontSize: '15px', cursor: 'pointer',
              }}
            >
              Sign in to register a place
            </button>
          )}
        </section>

        {/* ── The build guide, rendered from BUILD.md ──────────────────── */}
        <article className="build-doc" dangerouslySetInnerHTML={{ __html: buildDocHtml }} />

        {/* ── Payoff ──────────────────────────────────────────────────── */}
        <section style={{
          marginTop: '48px', paddingTop: '32px', borderTop: `1px solid ${C.border}`,
        }}>
          <h2 style={{ fontSize: '22px', margin: '0 0 12px', fontWeight: 800 }}>
            And then it speaks for itself
          </h2>
          <p style={{ color: C.textSub, fontSize: '16px', lineHeight: 1.7, margin: '0 0 16px' }}>
            Once your node is listening, its page starts filling in on its own — the species it
            hears, when the dawn chorus starts where you are, how the soundscape shifts through the
            season. You don't write any of it. The place does.
          </p>
          {/* The public-map guard (a node appears only after its first plausible detection) is
              framed as the moment of arrival rather than as a wait. */}
          <p style={{ color: C.textSub, fontSize: '16px', lineHeight: 1.7, margin: '0 0 16px' }}>
            Your page is yours from the moment you register. The <em>map</em> is different: your
            place joins it the moment it speaks — its first confirmed bird is what puts the pin
            there. Nothing to wait for and nothing to claim. It arrives by being heard.
          </p>
          <p style={{ color: C.textMuted, fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
            The guide above is maintained alongside the firmware it describes.{' '}
            <a href={buildDocSource} target="_blank" rel="noreferrer" style={{ color: C.accentLight }}>
              Read or improve it on GitHub
            </a>.
          </p>
        </section>
      </div>
    </div>
  )
}
