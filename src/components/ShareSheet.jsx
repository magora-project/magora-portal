import { useRef, useState } from 'react'
import html2canvas from 'html2canvas'

const PAPER = '#f0ebe0'
const INK = '#1a1a1a'
const FOREST = '#0d2818'
const ACCENT = '#c0392b'

function fmtDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Waveform({ color = INK }) {
  return (
    <svg width="56" height="16" viewBox="0 0 56 16" fill="none" aria-hidden="true">
      <path d="M1 8 C6 1 11 15 16 8 S26 1 31 8 S41 15 46 8 S54 4 55 8"
        stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export default function ShareSheet({ d, node, photo, moment, onClose }) {
  const cardRef = useRef(null)
  const [format, setFormat] = useState('square') // 'square' | 'story'
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState(null)

  const species = d.species_name || d.raw_label || 'A species'
  const sci = d.raw_label?.split('_')[1] || ''
  const habitat = node?.habitat_type ? node.habitat_type.replace(/-/g, ' ') : null
  const fromNode = node?.name ? ` from ${node.name}` : ''
  const date = fmtDate(d.detected_at)
  const url = node?.id ? `${window.location.origin}/node/${node.id}` : window.location.origin

  const caption =
    `${species}${sci ? ` (${sci})` : ''} recorded ${moment}${fromNode}${habitat ? ` — ${habitat}` : ''}.\n\n` +
    `Heard by an open-source acoustic node on the Magora Network. Every place is speaking.\n\n` +
    `#birding #biodiversity #birdnet #naturesounds #ecology\n${url}`

  const slug = `magora-${species.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  const W = 320
  const H = format === 'story' ? Math.round((W * 16) / 9) : W
  const photoH = format === 'story' ? '58%' : '52%'
  const scale = Math.round((1080 / W) * 100) / 100 // ~3.375 → ~1080px output

  async function render() {
    if (document.fonts?.ready) { try { await document.fonts.ready } catch { /* ignore */ } }
    const canvas = await html2canvas(cardRef.current, {
      useCORS: true, backgroundColor: PAPER, scale, logging: false,
    })
    return new Promise(res => canvas.toBlob(res, 'image/png', 0.95))
  }

  function triggerDownload(blob) {
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${slug}-${format}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return true
    } catch {
      return false
    }
  }

  async function handleShareImage() {
    setBusy(true)
    setNote(null)
    try {
      const blob = await render()
      const file = new File([blob], `${slug}.png`, { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await copyCaption() // caption ready to paste — share sheets rarely carry text into IG/FB
        await navigator.share({ files: [file], text: caption })
      } else {
        triggerDownload(blob)
        await copyCaption()
        setNote('Saved the image and copied the caption — open Instagram or Facebook and post it.')
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.warn('share image failed', e)
        setNote("Couldn't generate the image. Try Download instead.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    setBusy(true)
    setNote(null)
    try {
      triggerDownload(await render())
      await copyCaption()
      setNote('Image saved and caption copied.')
    } catch (e) {
      console.warn('download failed', e)
      setNote("Couldn't generate the image.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={e => e.stopPropagation()} style={S.sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#f0ede8' }}>Share this detection</div>
          <button onClick={onClose} style={S.close}>✕</button>
        </div>

        {/* Format toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', justifyContent: 'center' }}>
          {[['square', 'Square 1:1'], ['story', 'Story 9:16']].map(([k, label]) => (
            <button key={k} onClick={() => setFormat(k)} style={S.toggle(format === k)}>{label}</button>
          ))}
        </div>

        {/* Preview = capture target */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
          <div ref={cardRef} style={{ width: W, height: H, background: PAPER, position: 'relative', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}>
            {/* Photo */}
            <div style={{ height: photoH, width: '100%', position: 'relative', background: `linear-gradient(135deg, ${FOREST}, #163d22)` }}>
              {photo
                ? <img src={photo} crossOrigin="anonymous" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64px' }}>🐦</div>}
              <div style={{ position: 'absolute', top: 0, left: 0, height: '6px', width: '100%', background: ACCENT }} />
            </div>

            {/* Content */}
            <div style={{ position: 'absolute', top: photoH, left: 0, right: 0, bottom: 0, padding: '18px 18px 0', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, textTransform: 'uppercase', color: INK, lineHeight: 1.02, letterSpacing: '-0.01em', fontSize: format === 'story' ? '30px' : '26px' }}>
                {species}
              </div>
              {sci && <div style={{ fontStyle: 'italic', color: '#6b6157', fontSize: '13px', marginTop: '3px' }}>{sci}</div>}
              <div style={{ color: '#3a352f', fontSize: '13px', lineHeight: 1.5, marginTop: '10px' }}>
                Recorded {moment}{fromNode}
              </div>
              {(habitat || date) && (
                <div style={{ color: '#7a7060', fontSize: '12px', marginTop: '2px' }}>
                  {[habitat, date].filter(Boolean).join(' · ')}
                </div>
              )}

              {/* Footer */}
              <div style={{ marginTop: 'auto', paddingBottom: '16px' }}>
                <div style={{ height: '1px', background: '#cdc6b6', marginBottom: '10px' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Waveform />
                    <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, color: INK, letterSpacing: '0.06em', fontSize: '16px' }}>MAGORA</span>
                  </div>
                  <span style={{ fontStyle: 'italic', color: '#6b6157', fontSize: '11px' }}>Every place is speaking.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={handleShareImage} disabled={busy} style={S.primary(busy)}>
            {busy ? 'Preparing…' : '↗ Share image'}
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleDownload} disabled={busy} style={S.secondary}>⬇ Download</button>
            <button onClick={copyCaption} style={S.secondary}>{copied ? '✓ Caption copied' : '⧉ Copy caption'}</button>
          </div>
          <div style={{ fontSize: '11px', color: '#7aad8a', textAlign: 'center', marginTop: '4px', lineHeight: 1.5 }}>
            {note || 'Instagram accepts images only — share or download the card, then paste the caption.'}
          </div>
        </div>
      </div>
    </div>
  )
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    overflowY: 'auto',
  },
  sheet: {
    background: '#0d2818', border: '1px solid #1f5230', borderRadius: '18px',
    padding: '18px', width: '100%', maxWidth: '380px', maxHeight: '92vh', overflowY: 'auto',
  },
  close: {
    background: 'none', border: 'none', color: '#7aad8a', fontSize: '16px', cursor: 'pointer', padding: '4px 8px',
  },
  toggle: (active) => ({
    flex: 1, padding: '8px', borderRadius: '9px', cursor: 'pointer',
    fontSize: '12px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
    background: active ? '#1D9E75' : '#163d22',
    border: `1px solid ${active ? '#1D9E75' : '#1f5230'}`,
    color: active ? '#fff' : '#c8e6d0',
  }),
  primary: (busy) => ({
    width: '100%', padding: '13px', borderRadius: '11px', cursor: busy ? 'default' : 'pointer',
    fontSize: '15px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
    background: busy ? '#1f5230' : '#1D9E75', border: 'none', color: '#fff',
  }),
  secondary: {
    flex: 1, padding: '11px', borderRadius: '11px', cursor: 'pointer',
    fontSize: '13px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
    background: '#163d22', border: '1px solid #1f5230', color: '#c8e6d0',
  },
}
