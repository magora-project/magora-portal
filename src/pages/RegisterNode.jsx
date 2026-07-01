import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const HARDWARE_OPTIONS = [
  { id: 'rpi-zero-2w', name: 'Raspberry Pi Zero 2W', sub: 'Recommended · ~$15' },
  { id: 'rpi-4', name: 'Raspberry Pi 4', sub: 'More power · ~$55' },
  { id: 'rpi-3b', name: 'Raspberry Pi 3B+', sub: 'Good balance · ~$35' },
  { id: 'other', name: 'Other / custom', sub: 'Linux SBC' },
]

const HABITAT_OPTIONS = [
  'montane-scrub', 'forest', 'grassland', 'wetland',
  'desert', 'urban-garden', 'farmland', 'coastal', 'other'
]

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const IMAGE_URL = 'https://github.com/magora-project/magora-acoustic-biodiversity/releases/latest/download/magora-node.img.xz'

export default function RegisterNode() {
  const { user, openSignIn } = useAuth()
  const [step, setStep] = useState(1)
  const [hardware, setHardware] = useState('rpi-zero-2w')
  const [form, setForm] = useState({
    nodeName: '', wifi_ssid: '', wifi_password: '',
    lat: '', lon: '', elevation: '', habitat: 'montane-scrub',
  })
  const [nodeId, setNodeId]       = useState(null)
  const [nodeEmail, setNodeEmail] = useState(null)
  const [nodePassword, setNodePassword] = useState(null)
  const [registeredAt, setRegisteredAt] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [nodeLive, setNodeLive]   = useState(false)
  const [timedOut, setTimedOut]   = useState(false)
  const [pollNonce, setPollNonce] = useState(0)
  const [configDownloaded, setConfigDownloaded] = useState(false)
  const [whitelist, setWhitelist] = useState(null)
  const [ebirdStatus, setEbirdStatus] = useState('idle') // idle | loading | ready | error
  const pollRef = useRef(null)
  const ebirdRef = useRef(null)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  useEffect(() => {
    const lat = parseFloat(form.lat)
    const lon = parseFloat(form.lon)
    if (!form.lat || !form.lon || isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return
    }
    clearTimeout(ebirdRef.current)
    setEbirdStatus('loading')
    ebirdRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/regional-species?lat=${lat}&lon=${lon}`)
        const data = await r.json()
        if (!r.ok || !data.species?.length) { setEbirdStatus('error'); return }
        setWhitelist(data.species)
        setEbirdStatus('ready')
      } catch {
        setEbirdStatus('error')
      }
    }, 800)
    return () => clearTimeout(ebirdRef.current)
  }, [form.lat, form.lon])

  async function registerNode() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision-node`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-provision-secret': import.meta.env.VITE_PROVISION_SECRET,
          },
          body: JSON.stringify({
            name: form.nodeName,
            hardware_type: hardware,
            lat: parseFloat(form.lat),
            lon: parseFloat(form.lon),
            elevation_m: parseFloat(form.elevation) || null,
            habitat_type: form.habitat,
            species_whitelist: whitelist || undefined,
            // Links the node to the signed-in steward so it appears on their
            // field journal (nodes.owner_id → auth.users).
            owner_id: user?.id,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Provisioning failed')
      setNodeId(data.node_id)
      setNodeEmail(data.email)
      setNodePassword(data.password)
      setRegisteredAt(new Date().toISOString())
      setStep(3)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (step !== 4 || !nodeId || !registeredAt) return
    setTimedOut(false)
    setNodeLive(false)
    let polls = 0
    // ~30 min at 5s — covers the up-to-25-min BirdNET install before we surface
    // the troubleshooting panel (which restarts this via pollNonce on "Try again")
    const MAX_POLLS = 360
    pollRef.current = setInterval(async () => {
      polls++
      if (polls >= MAX_POLLS) {
        clearInterval(pollRef.current)
        setTimedOut(true)
        return
      }
      const { data } = await supabase
        .from('aci_logs')
        .select('id')
        .eq('node_id', nodeId)
        .gt('recorded_at', registeredAt)
        .limit(1)
      if (data?.length > 0) {
        setNodeLive(true)
        clearInterval(pollRef.current)
      }
    }, 5000)
    return () => clearInterval(pollRef.current)
  }, [step, nodeId, registeredAt, pollNonce])

  function generateConfig() {
    return JSON.stringify({
      node_id:          nodeId,
      node_name:        form.nodeName,
      node_email:       nodeEmail,
      node_password:    nodePassword,
      supabase_url:     import.meta.env.VITE_SUPABASE_URL,
      supabase_anon_key: import.meta.env.VITE_SUPABASE_ANON_KEY,
      lat:              parseFloat(form.lat),
      lon:              parseFloat(form.lon),
      wifi_ssid:        form.wifi_ssid,
      wifi_password:    form.wifi_password,
    }, null, 2)
  }

  function downloadConfig() {
    const blob = new Blob([generateConfig()], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'magora-config.json'
    a.click()
    URL.revokeObjectURL(url)
    setConfigDownloaded(true)
  }

  const card = {
    background: C.card, border: `1px solid ${C.border}`,
    borderRadius: '20px', padding: '24px',
  }
  const label = {
    display: 'block', fontSize: '12px', fontWeight: '700',
    color: C.textMuted, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: '6px',
  }
  const field = { marginBottom: '14px' }
  const inp = {
    width: '100%', background: C.bg, border: `1px solid ${C.border}`,
    borderRadius: '8px', padding: '10px 12px', color: C.text,
    fontSize: '14px', boxSizing: 'border-box',
  }
  const btn = {
    width: '100%', background: C.accent, color: '#fff',
    border: 'none', padding: '13px', borderRadius: '12px',
    fontSize: '15px', fontWeight: '700', cursor: 'pointer', marginTop: '4px',
  }

  const steps = ['Hardware', 'Location', 'Flash', 'Live!']

  // A node is registered to its steward's account, so require sign-in first.
  if (!user) {
    return (
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '48px 20px', textAlign: 'center' }}>
        <h2 style={{ color: C.text, fontSize: '1.6rem', margin: '0 0 12px' }}>Add a listening post</h2>
        <p style={{ color: C.textMuted, lineHeight: 1.7, marginBottom: '22px' }}>
          Sign in to register a node. It&apos;ll be linked to your account and appear on your field journal.
        </p>
        <button onClick={openSignIn} style={{
          background: C.accent, color: '#fff', border: 'none', borderRadius: '10px',
          padding: '12px 24px', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          Sign in
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Step indicator */}
      <div style={{ display: 'flex', marginBottom: '24px' }}>
        {steps.map((s, i) => {
          const done   = step > i + 1
          const active = step === i + 1
          return (
            <div key={s} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '50%', margin: '0 auto 4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '13px', fontWeight: '700',
                background: done ? C.accent : active ? C.card : C.bg,
                border: `1.5px solid ${done ? C.accent : active ? C.accentLight : C.border}`,
                color: done ? '#fff' : active ? C.accentLight : '#4a7a58',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: active ? C.accentLight : '#4a7a58' }}>{s}</div>
            </div>
          )
        })}
      </div>

      {/* Step 1 — Hardware */}
      {step === 1 && (
        <div style={card}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Choose your hardware</div>
          <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '20px' }}>Select your compute board</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {HARDWARE_OPTIONS.map(hw => (
              <div key={hw.id} onClick={() => setHardware(hw.id)} style={{
                border: `1.5px solid ${hardware === hw.id ? C.accent : C.border}`,
                background: hardware === hw.id ? '#1a4a28' : C.bg,
                borderRadius: '12px', padding: '12px', cursor: 'pointer', textAlign: 'center',
              }}>
                <div style={{ fontSize: '22px', marginBottom: '6px' }}>🖥️</div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>{hw.name}</div>
                <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '2px' }}>{hw.sub}</div>
              </div>
            ))}
          </div>
          <div style={field}>
            <label style={label}>Node name</label>
            <input style={inp} placeholder="e.g. backyard-node" value={form.nodeName} onChange={e => update('nodeName', e.target.value)} />
          </div>
          <button style={{ ...btn, opacity: form.nodeName ? 1 : 0.5 }} onClick={() => form.nodeName && setStep(2)}>
            Continue
          </button>
        </div>
      )}

      {/* Step 2 — Location + WiFi + register */}
      {step === 2 && (
        <div style={card}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Location & network</div>
          <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '20px' }}>Where is your node and what WiFi will it connect to?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={field}><label style={label}>Latitude</label><input style={inp} placeholder="38.83" value={form.lat} onChange={e => update('lat', e.target.value)} /></div>
            <div style={field}><label style={label}>Longitude</label><input style={inp} placeholder="-104.82" value={form.lon} onChange={e => update('lon', e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={field}><label style={label}>Elevation (m)</label><input style={inp} placeholder="2400" value={form.elevation} onChange={e => update('elevation', e.target.value)} /></div>
            <div style={field}><label style={label}>Habitat type</label>
              <select style={inp} value={form.habitat} onChange={e => update('habitat', e.target.value)}>
                {HABITAT_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div style={field}>
            <label style={label}>WiFi network name (SSID)</label>
            <input style={inp} placeholder="MyHomeNetwork" value={form.wifi_ssid} onChange={e => update('wifi_ssid', e.target.value)} />
          </div>
          <div style={field}>
            <label style={label}>WiFi password</label>
            <input style={inp} type="password" placeholder="••••••••" value={form.wifi_password} onChange={e => update('wifi_password', e.target.value)} />
          </div>
          {ebirdStatus === 'loading' && (
            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px' }}>Checking regional species...</div>
          )}
          {ebirdStatus === 'ready' && whitelist && (
            <div style={{ fontSize: '12px', color: C.accentLight, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ background: '#1a4a28', border: `1px solid ${C.accent}`, borderRadius: '20px', padding: '2px 10px', fontWeight: '700' }}>
                {whitelist.length} species in your area · eBird
              </span>
              <span style={{ color: C.textMuted }}>Whitelist filters out species that can't occur here</span>
            </div>
          )}
          {ebirdStatus === 'error' && (
            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px' }}>Couldn't load regional species, so the node will run without filtering</div>
          )}
          {error && <div style={{ color: '#f87171', fontSize: '13px', marginBottom: '10px' }}>{error}</div>}
          <button
            style={{ ...btn, opacity: (form.lat && form.lon && form.wifi_ssid && form.wifi_password) ? 1 : 0.5 }}
            onClick={registerNode}
            disabled={loading || !form.lat || !form.lon || !form.wifi_ssid || !form.wifi_password}
          >
            {loading ? 'Registering node...' : 'Register & continue'}
          </button>
        </div>
      )}

      {/* Step 3 — Flash + copy config */}
      {step === 3 && (
        <div style={card}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Flash your SD card</div>
          <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '20px' }}>
            Three steps, no terminal or SSH needed.
          </div>

          {/* A: Download image */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
              background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: '700', color: '#fff',
            }}>1</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Download the Magora Node image</div>
              <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px', lineHeight: '1.6' }}>
                This is a pre-built SD card image, about 500 MB, and takes a minute to download.
              </div>
              <a
                href={IMAGE_URL}
                style={{ display: 'block', textAlign: 'center', background: C.border, color: C.accentLight, padding: '10px', borderRadius: '10px', fontSize: '13px', fontWeight: '700', textDecoration: 'none', border: `1px solid ${C.accent}` }}
              >
                Download magora-node.img.xz
              </a>
            </div>
          </div>

          {/* B: Flash with Pi Imager */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
              background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: '700', color: '#fff',
            }}>2</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Flash with Raspberry Pi Imager</div>
              <div style={{ fontSize: '12px', color: C.textMuted, lineHeight: '1.7' }}>
                Open <strong style={{ color: C.text }}>Raspberry Pi Imager</strong>
                {' '}(download free at raspberrypi.com/software if needed).<br />
                • Click <strong style={{ color: C.text }}>Choose OS</strong> → <strong style={{ color: C.text }}>Use custom image from file</strong> → select <strong style={{ color: C.text }}>magora-node.img.xz</strong><br />
                • Click <strong style={{ color: C.text }}>Choose Storage</strong> → select your SD card<br />
                • Click <strong style={{ color: C.text }}>Next</strong> → when asked about customisation, click <strong style={{ color: C.text }}>No</strong><br />
                • Wait for flashing to finish (~3 min)
              </div>
            </div>
          </div>

          {/* C: Copy config */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
              background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: '700', color: '#fff',
            }}>3</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: C.text, marginBottom: '4px' }}>Copy your config file to the SD card</div>
              <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '10px', lineHeight: '1.6' }}>
                After flashing, a small drive called <strong style={{ color: C.text }}>bootfs</strong> appears in File Explorer.
                Download your config file and copy it there. That's it.
              </div>
              <button
                style={{ ...btn, marginTop: 0, background: configDownloaded ? '#1a4a28' : C.accent }}
                onClick={downloadConfig}
              >
                {configDownloaded ? '✓ magora-config.json downloaded' : 'Download magora-config.json'}
              </button>
              {configDownloaded && (
                <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '8px', lineHeight: '1.5' }}>
                  Copy this file to the <strong style={{ color: C.text }}>bootfs</strong> drive, then eject the SD card and insert it into your Pi.
                </div>
              )}
            </div>
          </div>

          <button style={{ ...btn, opacity: configDownloaded ? 1 : 0.5 }} onClick={() => configDownloaded && setStep(4)}>
            Config copied, power on my Pi
          </button>
        </div>
      )}

      {/* Step 4 — Live polling */}
      {step === 4 && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
          {nodeLive ? (
            <>
              <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
              <div style={{ fontSize: '22px', fontWeight: '700', color: C.text, marginBottom: '8px' }}>
                {form.nodeName} is live!
              </div>
              <div style={{ fontSize: '14px', color: C.textMuted, marginBottom: '28px', lineHeight: '1.6' }}>
                First acoustic data received. Your node is on the map and listening.
              </div>
              <a href="/" style={{ display: 'block', background: C.accent, color: '#fff', padding: '13px', borderRadius: '12px', fontSize: '15px', fontWeight: '700', textDecoration: 'none' }}>
                View on map
              </a>
            </>
          ) : timedOut ? (
            <>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏱️</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: C.text, marginBottom: '10px' }}>
                Still waiting for {form.nodeName}
              </div>
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', textAlign: 'left', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#f97316', marginBottom: '8px' }}>Troubleshooting checklist</div>
                {[
                  'SD card is fully seated in the Pi',
                  'magora-config.json is on the bootfs drive (not inside a folder)',
                  'Pi has power, green LED should be on',
                  'WiFi SSID and password in the config are correct',
                  'Pull the SD card and check magora-status.txt for diagnostic info',
                ].map((s, i) => (
                  <div key={i} style={{ fontSize: '12px', color: C.textMuted, marginBottom: '6px' }}>· {s}</div>
                ))}
              </div>
              <button style={btn} onClick={() => setPollNonce(n => n + 1)}>
                Keep waiting
              </button>
            </>
          ) : (
            <>
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', border: `3px solid ${C.border}`, borderTop: `3px solid ${C.accent}`, margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: '18px', fontWeight: '700', color: C.text, marginBottom: '10px' }}>
                Waiting for {form.nodeName}...
              </div>
              <div style={{ fontSize: '13px', color: C.textMuted, marginBottom: '16px' }}>
                Checking every 5 seconds. Keep this tab open.
              </div>
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', textAlign: 'left' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: C.accentLight, marginBottom: '8px' }}>What's happening on the Pi</div>
                {[
                  '0–3 min, booting and connecting to WiFi',
                  '3–25 min, automatically installing BirdNET',
                  '25 min+, listening and posting data here',
                ].map((s, i) => (
                  <div key={i} style={{ fontSize: '12px', color: C.textMuted, marginBottom: '4px' }}>· {s}</div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
