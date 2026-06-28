import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  AMBER, BUCKET, RECORD_SECONDS, MAX_OPEN_SECONDS, DURATIONS, HABITATS, CANOPY, DISTURBANCE,
  pickAudioMime, reverseGeocode, getPosition, formatClock,
} from '../lib/listen'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

// Wait at most this long for the worker before letting the user close with a
// "still working" note (the result will still land in their feed via realtime).
const RESULT_TIMEOUT_MS = 90000

export default function ListenModal({ onClose }) {
  const { user } = useAuth()
  const [step, setStep] = useState('ready') // ready | recording | pending | results | error
  const [place, setPlace] = useState(null)
  const [coords, setCoords] = useState(null)
  const [locError, setLocError] = useState(null)
  const [durationSecs, setDurationSecs] = useState(RECORD_SECONDS) // null = open-ended
  const [elapsed, setElapsed] = useState(0)
  const [species, setSpecies] = useState([])
  const [errorMsg, setErrorMsg] = useState(null)

  // Optional ecological metadata (Results step)
  const [habitat, setHabitat] = useState(null)
  const [canopy, setCanopy] = useState(null)
  const [water, setWater] = useState(null)
  const [disturbance, setDisturbance] = useState(null)
  const [notes, setNotes] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(null)
  const countdownRef = useRef(null)
  const channelRef = useRef(null)
  const timeoutRef = useRef(null)
  const detectionIdRef = useRef(null)

  // ── Cleanup everything (recorder, audio graph, realtime, timers) ────────────
  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch { /* ignore */ }
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
    }
    if (channelRef.current) supabase.removeChannel(channelRef.current)
  }, [])

  useEffect(() => () => teardown(), [teardown])

  // ── Step 1: get location for the Ready screen ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    getPosition()
      .then(async ({ lat, lon }) => {
        if (cancelled) return
        setCoords({ lat, lon })
        setPlace(await reverseGeocode(lat, lon))
      })
      .catch(() => { if (!cancelled) setLocError('Location access is needed to place your recording on the map.') })
    return () => { cancelled = true }
  }, [])

  // ── Waveform drawing during recording ───────────────────────────────────────
  function drawWaveform(analyser) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const render = () => {
      rafRef.current = requestAnimationFrame(render)
      analyser.getByteTimeDomainData(buf)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth = 2
      ctx.strokeStyle = AMBER.light
      ctx.beginPath()
      const slice = canvas.width / buf.length
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 128.0) * (canvas.height / 2)
        const x = i * slice
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    render()
  }

  // ── Step 2: record ──────────────────────────────────────────────────────────
  async function beginListening() {
    setErrorMsg(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const { mime } = pickAudioMime()
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || 'audio/webm' })
        uploadAndProcess(blob)
      }

      // Live waveform
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const audioCtx = new AudioCtx()
      audioCtxRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      audioCtx.createMediaStreamSource(stream).connect(analyser)

      const cap = durationSecs ?? MAX_OPEN_SECONDS // hard stop (fixed length, or the open-ended safety cap)
      setStep('recording')
      setElapsed(0)
      recorder.start(1000) // emit chunks every 1s so long recordings don't buffer one huge blob
      requestAnimationFrame(() => drawWaveform(analyser))

      countdownRef.current = setInterval(() => {
        setElapsed((e) => {
          const next = e + 1
          if (next >= cap) { clearInterval(countdownRef.current); stopRecording(); return cap }
          return next
        })
      }, 1000)
    } catch {
      setErrorMsg('Microphone access was blocked. Enable it in your browser settings to Listen.')
      setStep('error')
    }
  }

  function stopRecording() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  // ── Step 3: upload + create row + subscribe for the result ──────────────────
  async function uploadAndProcess(blob) {
    if (!coords) { setErrorMsg('We could not read your location, so this recording can’t be placed.'); setStep('error'); return }
    setStep('pending')

    const { ext } = pickAudioMime()
    const id = crypto.randomUUID()
    detectionIdRef.current = id
    const path = `${user.id}/${id}.${ext}`

    try {
      // Contract: upload the audio FIRST, then insert the row — the DB trigger
      // enqueues the inference job on insert, so the audio must already exist.
      const up = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: blob.type, upsert: false,
      })
      if (up.error) throw up.error

      const ins = await supabase.from('mobile_detections').insert({
        id,
        user_id: user.id,
        lat: coords.lat,
        lon: coords.lon,
        status: 'pending',
        audio_path: path,
        device_info: { ua: navigator.userAgent },
      })
      if (ins.error) throw ins.error

      subscribeForResult(id)
    } catch (e) {
      setErrorMsg(e.message || 'Upload failed. Please try again.')
      setStep('error')
    }
  }

  function finishWithResult(row) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    if (row.status === 'failed') {
      setErrorMsg('We couldn’t identify anything in that recording. Try again somewhere quieter.')
      setStep('error')
      return
    }
    setSpecies(Array.isArray(row.species) ? row.species : [])
    setStep('results')
  }

  function subscribeForResult(id) {
    const channel = supabase
      .channel(`md-${id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mobile_detections', filter: `id=eq.${id}` },
        (payload) => {
          const s = payload.new.status
          if (s === 'complete' || s === 'failed') finishWithResult(payload.new)
        },
      )
      .subscribe()
    channelRef.current = channel

    // Fallback: if realtime misses the update, poll the row once after a while.
    timeoutRef.current = setTimeout(async () => {
      const { data } = await supabase.from('mobile_detections').select('*').eq('id', id).single()
      if (data && (data.status === 'complete' || data.status === 'failed')) finishWithResult(data)
      else { setErrorMsg('Still identifying — your recording will appear in your feed shortly.'); setStep('error') }
    }, RESULT_TIMEOUT_MS)
  }

  // ── Step 4: publish (with optional metadata) or discard ─────────────────────
  async function publishListen() {
    setSavingMeta(true)
    await supabase.from('mobile_detections').update({
      habitat_type: habitat?.toLowerCase() ?? null,
      canopy_cover: canopy?.toLowerCase() ?? null,
      water_present: water === null ? null : water === 'Yes',
      disturbance_level: disturbance?.toLowerCase() ?? null,
      observer_notes: notes.trim() || null,
      published: true,
    }).eq('id', detectionIdRef.current)
    setSavingMeta(false)
    onClose()
  }

  async function discardListen() {
    setSavingMeta(true)
    await supabase.from('mobile_detections').delete().eq('id', detectionIdRef.current)
    setSavingMeta(false)
    onClose()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={e => e.stopPropagation()} style={S.sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: AMBER.light, fontWeight: 700, fontSize: '15px' }}>
            <span style={{ fontSize: '18px' }}>〰</span> Listen
          </div>
          <button onClick={onClose} style={S.close} aria-label="Close">✕</button>
        </div>

        {step === 'ready' && (
          <>
            <h2 style={S.h2}>Every place is speaking.</h2>
            <p style={S.sub}>
              Record 15 seconds of the world around you. We’ll listen for the birds, then you decide whether to post it to the map.
            </p>
            <div style={S.locBox}>
              {locError
                ? <span style={{ color: '#fb7a6a' }}>{locError}</span>
                : place
                  ? <><span style={{ color: C.textMuted }}>You’re near</span> <strong style={{ color: C.text }}>{place}</strong></>
                  : <span style={{ color: C.textMuted }}>Finding your location…</span>}
            </div>

            <label style={S.metaLabel}>Recording length</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
              {DURATIONS.map(opt => {
                const active = durationSecs === opt.secs
                return (
                  <button key={opt.label} onClick={() => setDurationSecs(opt.secs)}
                    style={{
                      padding: '6px 14px', borderRadius: '14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${active ? AMBER.base : C.border}`,
                      background: active ? AMBER.base : 'transparent',
                      color: active ? C.bg : C.textSub,
                    }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: '11px', color: C.textMuted, margin: '0 0 16px' }}>
              {durationSecs === null
                ? `Records until you tap stop (up to ${MAX_OPEN_SECONDS / 60} min).`
                : 'Longer clips can pick up more species.'}
            </p>

            <button onClick={beginListening} disabled={!coords} style={S.amberBtn(!coords)}>
              {coords ? 'Begin listening' : 'Waiting for location…'}
            </button>
          </>
        )}

        {step === 'recording' && (() => {
          const isOpen = durationSecs === null
          const remaining = isOpen ? null : Math.max(0, durationSecs - elapsed)
          const progress = isOpen ? (elapsed / MAX_OPEN_SECONDS) * 100 : (elapsed / durationSecs) * 100
          return (
            <div style={{ textAlign: 'center' }}>
              <canvas ref={canvasRef} width={320} height={90} style={S.canvas} />
              <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '2.6rem', fontWeight: 900, color: AMBER.light, lineHeight: 1 }}>
                {isOpen ? formatClock(elapsed) : `${remaining}s`}
              </div>
              <div style={{ height: '5px', background: C.border, borderRadius: '3px', margin: '14px 0', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: AMBER.base, transition: 'width 1s linear' }} />
              </div>
              <p style={S.sub}>
                {isOpen
                  ? `Listening to ${place || 'this place'}… tap stop when you’re done`
                  : `Listening to ${place || 'this place'}…`}
              </p>
              <button onClick={stopRecording} style={isOpen ? S.amberBtn(false) : S.ghostBtn}>
                {isOpen ? 'Stop & identify' : 'Stop early'}
              </button>
            </div>
          )
        })()}

        {step === 'pending' && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={S.pulse}>〰</div>
            <h2 style={S.h2}>Got your recording</h2>
            <p style={S.sub}>Identifying species… nothing is posted automatically. Stay here to review it and choose whether to post.</p>
            <button onClick={onClose} style={S.ghostBtn}>Cancel</button>
          </div>
        )}

        {step === 'results' && (
          <>
            <h2 style={S.h2}>{species.length ? 'Here’s what we heard' : 'No birds this time'}</h2>
            <p style={S.sub}>
              {species.length === 0
                ? 'No confident bird IDs in that clip. Nothing’s been posted — discard it, or post it as a Listen anyway.'
                : 'Nothing’s posted yet. Add a little about the place if you like, then post it to the map — or discard it.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '6px 0 16px' }}>
              {species.map((s, i) => (
                <div key={i} style={S.speciesRow}>
                  <div>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: '14px' }}>{s.common_name}</div>
                    <div style={{ color: C.textMuted, fontSize: '12px', fontStyle: 'italic' }}>{s.scientific_name}</div>
                  </div>
                  <div style={{ color: AMBER.light, fontWeight: 700, fontSize: '13px' }}>{Math.round(s.confidence * 100)}%</div>
                </div>
              ))}
            </div>

            <details style={S.details}>
              <summary style={S.summary}>Tell us about this place (optional)</summary>
              <div style={{ marginTop: '12px' }}>
                <Chips label="Habitat" options={HABITATS} value={habitat} onPick={setHabitat} />
                <Chips label="Canopy cover" options={CANOPY} value={canopy} onPick={setCanopy} />
                <Chips label="Water nearby?" options={['Yes', 'No']} value={water} onPick={setWater} />
                <Chips label="Disturbance" options={DISTURBANCE} value={disturbance} onPick={setDisturbance} />
                <label style={S.metaLabel}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  placeholder="Anything you noticed…" style={S.textarea} />
              </div>
            </details>

            <button onClick={publishListen} disabled={savingMeta} style={S.amberBtn(savingMeta)}>
              {savingMeta ? 'Posting…' : 'Post to the map'}
            </button>
            <button onClick={discardListen} disabled={savingMeta} style={S.ghostBtn}>
              Discard
            </button>
          </>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <p style={{ ...S.sub, color: '#fb7a6a' }}>{errorMsg}</p>
            <button onClick={onClose} style={S.ghostBtn}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Chips({ label, options, value, onPick }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={S.metaLabel}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {options.map(o => (
          <button key={o} onClick={() => onPick(value === o ? null : o)}
            style={{
              padding: '6px 12px', borderRadius: '14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${value === o ? AMBER.base : C.border}`,
              background: value === o ? AMBER.base : 'transparent',
              color: value === o ? C.bg : C.textSub,
            }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

const S = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' },
  sheet: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: '18px', padding: '22px', width: '100%', maxWidth: '400px' },
  close: { background: 'none', border: 'none', color: C.textMuted, fontSize: '16px', cursor: 'pointer', padding: '4px 8px' },
  h2: { fontFamily: "'Big Shoulders Display', sans-serif", fontSize: '1.5rem', fontWeight: 900, color: C.text, textTransform: 'uppercase', letterSpacing: '-0.01em', margin: '0 0 8px' },
  sub: { fontSize: '13px', color: C.textMuted, lineHeight: 1.6, margin: '0 0 16px' },
  locBox: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 },
  amberBtn: (busy) => ({ width: '100%', padding: '13px', borderRadius: '10px', background: busy ? C.border : AMBER.base, border: 'none', color: busy ? C.textMuted : AMBER.ink, fontSize: '15px', fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: "'DM Sans', sans-serif" }),
  ghostBtn: { width: '100%', marginTop: '10px', padding: '10px', borderRadius: '10px', background: 'transparent', border: `1px solid ${C.border}`, color: C.textSub, fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  canvas: { width: '100%', maxWidth: '320px', height: '90px', background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', marginBottom: '12px' },
  pulse: { fontSize: '40px', color: AMBER.light, animation: 'pulse 1.4s ease-in-out infinite', marginBottom: '6px' },
  speciesRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px 12px' },
  details: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' },
  summary: { cursor: 'pointer', color: C.textSub, fontSize: '13px', fontWeight: 700 },
  metaLabel: { display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' },
  textarea: { width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: '8px', color: C.text, padding: '8px 10px', fontFamily: "'DM Sans', sans-serif", fontSize: '13px', resize: 'vertical' },
}
