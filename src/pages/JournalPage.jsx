import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'
import { useAuth } from '../lib/auth'
import { useEcosystemInsight } from '../lib/useEcosystemInsight'
import MobileDetectionCard from '../components/MobileDetectionCard'
import {
  validateHandle,
  createListener,
  getListenerByHandle,
  getListenerByUser,
  getListenerAvatarUrl,
  uploadListenerAvatar,
} from '../lib/listener'

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

function MapController({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 10)
    } else {
      map.fitBounds(points, { padding: [30, 30] })
    }
  }, [points, map])
  return null
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Same gate the public feed applies (see MobileDetectionCard): drop low-confidence
// guesses and sounds we never surface (human noise, dogs, insects). The journal is
// public, so it must not leak species/sounds the rest of the app deliberately hides.
function visibleSpecies(entry) {
  return (entry.species || [])
    .filter(s => s?.common_name && s.confidence >= MIN_CONFIDENCE && !isHiddenSpecies(s.common_name))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
}

export default function JournalPage() {
  const { handle: rawHandle } = useParams()
  const handle = rawHandle?.toLowerCase() || ''
  const navigate = useNavigate()
  const { user, loading: authLoading, listener, refreshListener, openSignIn } = useAuth()
  const [profile, setProfile] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [claimHandle, setClaimHandle] = useState('')
  const [claimDisplayName, setClaimDisplayName] = useState('')
  const [claimHomeRegion, setClaimHomeRegion] = useState('')
  const [claimBio, setClaimBio] = useState('')
  const [claimError, setClaimError] = useState(null)
  const [claimAvatar, setClaimAvatar] = useState(null)
  const [avatarBust, setAvatarBust] = useState(null)
  const [nodes, setNodes] = useState([])
  const mobileInsight = useEcosystemInsight()

  // Section anchors so the Life list / Places / Listens stat buttons can scroll
  // straight to their content (the journal is one page, like the live feed).
  const lifeListRef = useRef(null)
  const placesRef = useRef(null)
  const listensRef = useRef(null)
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const isMeRoute = handle === 'me'
  const isClaiming = isMeRoute && user && !listener?.handle && !profile?.handle

  useEffect(() => {
    async function loadProfile() {
      setLoading(true)
      setNotFound(false)
      setError(null)

      if (isMeRoute) {
        if (authLoading) {
          setLoading(true)
          return
        }
        if (!user) {
          setProfile(null)
          setEntries([])
          setLoading(false)
          return
        }
        if (listener?.handle) {
          navigate(`/journal/${listener.handle}`, { replace: true })
          return
        }

        const own = await getListenerByUser(user.id)
        if (own?.handle) {
          navigate(`/journal/${own.handle}`, { replace: true })
          return
        }
        setProfile(own)
        setLoading(false)
        return
      }

      const publicProfile = await getListenerByHandle(handle)
      if (!publicProfile) {
        setNotFound(true)
        setProfile(null)
        setEntries([])
        setLoading(false)
        return
      }
      setProfile(publicProfile)
      setLoading(false)
    }

    loadProfile().catch((err) => {
      console.warn('Journal load failed:', err)
      setError('Unable to load this journal right now.')
      setLoading(false)
    })
  }, [handle, authLoading, user, listener, navigate, isMeRoute])

  useEffect(() => {
    async function loadEntries() {
      if (!profile?.handle) {
        setEntries([])
        return
      }
      setLoading(true)
      const { data, error } = await supabase
        .from('public_mobile_detections')
        .select('id, detected_at, lat, lon, species, habitat_type, canopy_cover, water_present, disturbance_level, insight')
        .eq('listener_handle', profile.handle)
        .order('detected_at', { ascending: false })
        .limit(100)

      if (error) {
        console.warn('Journal entries failed:', error)
        setError('Unable to load your Listens right now.')
        setEntries([])
      } else {
        setEntries(data || [])
      }
      setLoading(false)
    }

    loadEntries()
  }, [profile])

  // Listening posts: nodes (hardware stations) this Listener stewards, via
  // nodes.owner_id = their auth uid (= the listener id). Public-readable.
  useEffect(() => {
    async function loadNodes() {
      if (!profile?.id) { setNodes([]); return }
      const { data, error } = await supabase
        .from('nodes')
        .select('id, name, hardware_type, habitat_type, is_active')
        .eq('owner_id', profile.id)
        .order('name')
      if (error) { console.warn('Journal nodes failed:', error); setNodes([]) }
      else setNodes(data || [])
    }
    loadNodes()
  }, [profile])

  // The profile editor now lives in the navbar and refreshes `listener`. For the
  // owner's own journal, bust the avatar cache so a re-uploaded image (same
  // storage path) shows immediately; the header text refreshes via loadProfile.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (listener && user && listener.id === user.id) setAvatarBust(Date.now())
  }, [listener, user])

  const speciesTotals = useMemo(() => {
    const map = {}
    for (const entry of entries) {
      for (const item of visibleSpecies(entry)) {
        map[item.common_name] = (map[item.common_name] || 0) + 1
      }
    }
    return map
  }, [entries])

  const mapPoints = useMemo(
    () => entries.filter(e => e.lat != null && e.lon != null).map(e => [e.lat, e.lon]),
    [entries],
  )

  const lifeListCount = Object.keys(speciesTotals).length
  const placeCount = new Set(entries
    .filter(entry => entry.lat != null && entry.lon != null)
    .map(entry => `${entry.lat.toFixed(3)}|${entry.lon.toFixed(3)}`)
  ).size

  // Full life list (every species, most-recorded first) for the Life list section.
  const allSpecies = Object.entries(speciesTotals).sort((a, b) => b[1] - a[1])

  async function handleClaimSubmit(event) {
    event.preventDefault()
    if (!user) return
    const normalized = claimHandle.toLowerCase().trim()
    const validation = validateHandle(normalized)
    if (validation) {
      setClaimError(validation)
      return
    }

    setSaving(true)
    setClaimError(null)

    try {
      // Same guard as the profile editor: the avatar upload and the listeners
      // INSERT are RLS-gated on auth.uid(). If the session has lapsed the request
      // goes out as anon and Postgres rejects it with a confusing "new row
      // violates row-level security policy". getSession() refreshes a valid
      // session; if it can't, prompt a fresh sign-in.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setClaimError('Your session has expired. Please sign in again to claim your journal.')
        openSignIn()
        return
      }
      const uid = session.user.id

      let avatar_path = null
      if (claimAvatar) {
        avatar_path = await uploadListenerAvatar(uid, claimAvatar)
      }
      const created = await createListener({
        id: uid,
        handle: normalized,
        display_name: claimDisplayName || null,
        bio: claimBio || null,
        home_region: claimHomeRegion || null,
        avatar_path,
      })
      await refreshListener()
      navigate(`/journal/${created.handle}`)
    } catch (err) {
      console.warn('Claim failed:', err)
      setClaimError(err.message || 'Could not claim that handle. Try another.')
    } finally {
      setSaving(false)
    }
  }

  const headerName = profile?.display_name || (profile ? `@${profile.handle}` : 'Listener')
  const baseAvatarUrl = getListenerAvatarUrl(profile?.avatar_path)
  const avatarUrl = baseAvatarUrl && avatarBust ? `${baseAvatarUrl}?v=${avatarBust}` : baseAvatarUrl

  if (loading) {
    return (
      <div style={{ padding: '60px', color: C.textMuted, textAlign: 'center' }}>
        Loading journal…
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={{ padding: '60px', color: C.textMuted, textAlign: 'center' }}>
        Listener not found.
        <div style={{ marginTop: '18px' }}>
          <Link to="/" style={{ color: C.accentLight, textDecoration: 'none' }}>Back to the network</Link>
        </div>
      </div>
    )
  }

  if (isMeRoute && !user) {
    return (
      <div style={{ padding: '60px', color: C.textMuted, textAlign: 'center' }}>
        <div style={{ marginBottom: '14px' }}>Sign in to claim your Listener field journal.</div>
        <button onClick={openSignIn} style={S.button}>Sign in</button>
      </div>
    )
  }

  if (isClaiming) {
    return (
      <div style={{ padding: '32px', maxWidth: '760px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px', color: C.textMuted }}>
          Claim a public handle for your Listener field journal. Once it is set, people can visit your journal at <strong>/journal/&lt;handle&gt;</strong>.
        </div>
        <form onSubmit={handleClaimSubmit} style={{ display: 'grid', gap: '18px' }}>
          <label style={S.label}>
            Handle
            <input
              value={claimHandle}
              onChange={(e) => setClaimHandle(e.target.value.toLowerCase())}
              placeholder="your_handle"
              style={S.input}
            />
          </label>
          <label style={S.label}>
            Display name
            <input
              value={claimDisplayName}
              onChange={(e) => setClaimDisplayName(e.target.value)}
              placeholder="Your name or nickname"
              style={S.input}
            />
          </label>
          <label style={S.label}>
            Home region
            <input
              value={claimHomeRegion}
              onChange={(e) => setClaimHomeRegion(e.target.value)}
              placeholder="E.g. Northern Colorado"
              style={S.input}
            />
          </label>
          <label style={S.label}>
            Bio
            <textarea
              value={claimBio}
              onChange={(e) => setClaimBio(e.target.value)}
              rows={3}
              placeholder="A short sentence about why you listen."
              style={S.textarea}
            />
          </label>
          <label style={S.label}>
            Avatar (optional)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setClaimAvatar(e.target.files?.[0] || null)}
              style={S.fileInput}
            />
          </label>
          {claimError && <div style={S.error}>{claimError}</div>}
          <button type="submit" disabled={saving} style={S.primaryButton(saving)}>
            {saving ? 'Claiming…' : 'Claim my journal'}
          </button>
        </form>
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{ padding: '60px', color: C.textMuted, textAlign: 'center' }}>
        No journal profile found yet.
      </div>
    )
  }

  return (
    // No horizontal padding here — the parent .main-content already provides the
    // page gutter (16px on mobile); adding more double-pads and cramps small screens.
    <div style={{ padding: '4px 0 40px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ width: '90px', height: '90px', borderRadius: '22px', background: '#162e20', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={headerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: '32px', color: C.textMuted }}>{profile.display_name?.[0] || profile.handle?.[0] || 'L'}</span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '2rem', color: C.text }}>{profile.display_name || `@${profile.handle}`}</h1>
            <span style={{ color: C.accentLight, fontSize: '14px' }}>@{profile.handle}</span>
          </div>
          {profile.home_region && <div style={{ marginTop: '6px', color: C.textMuted }}>{profile.home_region}</div>}
          {profile.bio && <p style={{ marginTop: '12px', color: C.textSub, lineHeight: 1.8 }}>{profile.bio}</p>}
        </div>
      </div>

      {error && <div style={{ ...S.error, marginBottom: '20px' }}>{error}</div>}

      {/* Stat buttons — tap to scroll to that section (the journal is one page,
          like the live feed). auto-fit keeps them 3-across on phones and shrinks
          instead of clipping. */}
      <div style={{ display: 'grid', gap: '12px', marginBottom: '32px', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' }}>
        <button style={S.statButton} onClick={() => scrollTo(lifeListRef)}>
          <span style={S.statValue}>{lifeListCount}</span>
          <span style={S.statLabel}>Life list</span>
        </button>
        <button style={S.statButton} onClick={() => scrollTo(placesRef)}>
          <span style={S.statValue}>{placeCount}</span>
          <span style={S.statLabel}>Places</span>
        </button>
        <button style={S.statButton} onClick={() => scrollTo(listensRef)}>
          <span style={S.statValue}>{entries.length}</span>
          <span style={S.statLabel}>Listens</span>
        </button>
      </div>

      {/* Places — the map of where they've listened. Kept near the top, right
          under the stat buttons. */}
      <section ref={placesRef} style={S.section}>
        <h2 style={S.sectionLabel}>Places</h2>
        {mapPoints.length > 0 ? (
          <div style={{ height: '340px', minHeight: '280px' }}>
            <MapContainer style={{ width: '100%', height: '100%', borderRadius: '16px' }} center={mapPoints[0]} zoom={6} scrollWheelZoom={false}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapController points={mapPoints} />
              {entries.filter(e => e.lat != null && e.lon != null).map((entry) => (
                <CircleMarker
                  key={entry.id}
                  center={[entry.lat, entry.lon]}
                  radius={10}
                  pathOptions={{ color: C.accentLight, fillColor: C.accent, fillOpacity: 0.9, weight: 2 }}
                >
                  <Popup>
                    <div style={{ color: '#0f2718' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>{formatDate(entry.detected_at)}</div>
                      <div>{visibleSpecies(entry).length} species</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        ) : (
          <div style={{ color: C.textMuted, minHeight: '120px', display: 'flex', alignItems: 'center' }}>
            No published Listens yet.
          </div>
        )}
      </section>

      {/* Listening posts — nodes (hardware stations) this Listener stewards. */}
      {nodes.length > 0 && (
        <section style={S.section}>
          <h2 style={S.sectionLabel}>Listening posts</h2>
          <div style={{ display: 'grid', gap: '10px' }}>
            {nodes.map((n) => (
              <Link key={n.id} to={`/node/${n.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px',
                padding: '14px 16px', textDecoration: 'none',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: C.text, fontWeight: 700, fontSize: '15px' }}>{n.name}</div>
                  <div style={{ color: C.textMuted, fontSize: '12px', marginTop: '2px', textTransform: 'capitalize' }}>
                    {[n.habitat_type, n.hardware_type].filter(Boolean).join(' · ') || 'Listening post'}
                  </div>
                </div>
                <span style={{
                  flexShrink: 0, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '12px',
                  color: n.is_active ? C.accentLight : C.textMuted,
                  background: n.is_active ? 'rgba(29,158,117,0.15)' : 'transparent',
                  border: `1px solid ${n.is_active ? C.accent : C.border}`,
                }}>
                  {n.is_active ? 'Active' : 'Offline'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Life list — every species this Listener has recorded */}
      <section ref={lifeListRef} style={S.section}>
        <h2 style={S.sectionLabel}>Life list</h2>
        {allSpecies.length > 0 ? (
          <div style={{ display: 'grid', gap: '10px' }}>
            {allSpecies.map(([name, count]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', color: C.text }}>
                <span>{name}</span>
                <span style={{ color: C.textMuted }}>{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: C.textMuted }}>No species published yet.</div>
        )}
      </section>

      {/* Listens — the feed, rendered exactly like the live feed (edge-to-edge
          MobileDetectionCards via .detection-grid). */}
      <section ref={listensRef} style={S.section}>
        <h2 style={S.sectionLabel}>Listens</h2>
        {entries.length > 0 ? (
          <div className="detection-grid">
            {entries.map((entry) => (
              <MobileDetectionCard
                key={entry.id}
                d={entry}
                insight={mobileInsight.insights[entry.id]}
                onGenerate={() => mobileInsight.requestInsight(entry)}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: C.textMuted, padding: '24px', border: `1px solid ${C.border}`, borderRadius: '16px' }}>
            This Listener has not published any Listens yet.
          </div>
        )}
      </section>

    </div>
  )
}

const S = {
  label: { display: 'flex', flexDirection: 'column', gap: '8px', color: C.textMuted, fontSize: '13px' },
  input: {
    background: '#0f2918', border: `1px solid ${C.border}`, borderRadius: '12px', color: C.text,
    padding: '12px 14px', fontSize: '14px', width: '100%', boxSizing: 'border-box',
  },
  textarea: {
    background: '#0f2918', border: `1px solid ${C.border}`, borderRadius: '12px', color: C.text,
    padding: '12px 14px', fontSize: '14px', width: '100%', boxSizing: 'border-box',
  },
  fileInput: {
    color: C.textMuted, fontSize: '13px', marginTop: '6px'
  },
  error: {
    color: '#fb7a6a', fontSize: '13px', background: '#3e1f16', borderRadius: '12px', padding: '10px',
  },
  primaryButton: (busy) => ({
    background: busy ? '#1a3a28' : C.accentLight,
    color: C.bg,
    border: 'none', borderRadius: '12px', padding: '12px 18px', cursor: busy ? 'default' : 'pointer',
    fontWeight: 700,
  }),
  button: {
    background: 'transparent', border: `1px solid ${C.accentLight}`, color: C.accentLight,
    padding: '10px 18px', borderRadius: '12px', cursor: 'pointer',
  },
  statButton: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
    background: '#0d2818', border: `1px solid ${C.border}`, borderRadius: '16px',
    padding: '16px 10px', cursor: 'pointer', color: C.text,
  },
  statValue: {
    fontSize: '28px', fontWeight: 800, color: C.text, lineHeight: 1,
  },
  statLabel: {
    fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted,
  },
  section: {
    marginBottom: '32px', scrollMarginTop: '72px',
  },
  sectionLabel: {
    margin: '0 0 14px', fontSize: '14px', fontWeight: 700, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
}
