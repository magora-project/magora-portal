import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase, MIN_CONFIDENCE } from '../lib/supabase'
import { isHiddenSpecies } from '../lib/hiddenSpecies'
import { useAuth } from '../lib/auth'
import {
  validateHandle,
  createListener,
  getListenerByHandle,
  getListenerByUser,
  getListenerAvatarUrl,
  uploadListenerAvatar,
  updateListener,
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

function entryTags(entry) {
  return [
    entry.habitat_type,
    entry.canopy_cover && `${entry.canopy_cover} canopy`,
    entry.water_present ? 'water nearby' : null,
    entry.disturbance_level && entry.disturbance_level !== 'none' ? `${entry.disturbance_level} disturbance` : null,
  ].filter(Boolean)
}

// Owner-only profile editor. Local state is lazily seeded from `profile` on mount
// (the editor only renders once the owner's profile is loaded), so there's no
// prop→state sync effect to keep in step.
function ProfileEditor({ profile, userId, onSaved }) {
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [homeRegion, setHomeRegion] = useState(profile.home_region || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [avatar, setAvatar] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      let avatar_path = profile.avatar_path
      if (avatar) {
        avatar_path = await uploadListenerAvatar(userId, avatar)
      }
      const updated = await updateListener(userId, {
        display_name: displayName || null,
        bio: bio || null,
        home_region: homeRegion || null,
        avatar_path,
      })
      onSaved(updated, Boolean(avatar))
      setAvatar(null)
    } catch (err) {
      console.warn('Profile save failed:', err)
      setError(err.message || 'Unable to save your profile right now.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: '32px', background: C.card, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '22px' }}>
      <div style={{ marginBottom: '18px', fontSize: '15px', fontWeight: 700, color: C.text }}>Edit your profile</div>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
        <label style={S.label}>
          Display name
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" style={S.input} />
        </label>
        <label style={S.label}>
          Home region
          <input value={homeRegion} onChange={e => setHomeRegion(e.target.value)} placeholder="E.g. Rocky Mountains" style={S.input} />
        </label>
        <label style={S.label}>
          Bio
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="A short sentence about why you listen." style={S.textarea} />
        </label>
        <label style={S.label}>
          Profile avatar
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAvatar(e.target.files?.[0] || null)} style={S.fileInput} />
        </label>
        {error && <div style={S.error}>{error}</div>}
        <button type="submit" disabled={saving} style={S.primaryButton(saving)}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  )
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
  const [expandedId, setExpandedId] = useState(null)

  const isMeRoute = handle === 'me'
  const isOwner = profile?.id && user?.id === profile.id
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

  const topSpecies = Object.entries(speciesTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

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
      let avatar_path = null
      if (claimAvatar) {
        avatar_path = await uploadListenerAvatar(user.id, claimAvatar)
      }
      const created = await createListener({
        id: user.id,
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

  function handleProfileSaved(updated, avatarChanged) {
    setProfile(updated)
    // Re-uploads reuse the same storage path, so bust the cache so the owner sees
    // their new avatar immediately instead of the CDN-cached one.
    if (avatarChanged) setAvatarBust(Date.now())
    refreshListener()
  }

  const isLoadedOwner = isOwner && profile
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
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
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

      <div style={{ display: 'grid', gap: '18px', marginBottom: '28px', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
        <div style={S.statCard}>
          <div style={S.statLabel}>Life list</div>
          <div style={S.statValue}>{lifeListCount}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>Places</div>
          <div style={S.statValue}>{placeCount}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>Listens</div>
          <div style={S.statValue}>{entries.length}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '24px', marginBottom: '32px' }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '18px' }}>
          <div style={{ marginBottom: '12px', fontSize: '13px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Journal map
          </div>
          {mapPoints.length > 0 ? (
            <div style={{ height: '340px', minHeight: '280px' }}>
              <MapContainer style={{ width: '100%', height: '100%', borderRadius: '18px' }} center={mapPoints[0]} zoom={6} scrollWheelZoom={false}>
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
                    eventHandlers={{ click: () => setExpandedId(entry.id) }}
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
            <div style={{ color: C.textMuted, minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              No published Listens yet.
            </div>
          )}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '18px' }}>
          <div style={{ marginBottom: '12px', fontSize: '13px', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Top species
          </div>
          {topSpecies.length > 0 ? (
            <div style={{ display: 'grid', gap: '10px' }}>
              {topSpecies.map(([name, count]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', color: C.text }}> 
                  <span>{name}</span>
                  <span style={{ color: C.textMuted }}>{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: C.textMuted }}>No species published yet.</div>
          )}
        </div>
      </div>

      {isLoadedOwner && (
        <ProfileEditor profile={profile} userId={user.id} onSaved={handleProfileSaved} />
      )}

      <div style={{ display: 'grid', gap: '16px' }}>
        {entries.length > 0 ? entries.map((entry) => {
          const seen = visibleSpecies(entry)
          const tags = entryTags(entry)
          const expanded = expandedId === entry.id
          const shownSpecies = expanded ? seen : seen.slice(0, 4)
          const hiddenCount = seen.length - shownSpecies.length
          return (
            <div
              key={entry.id}
              style={S.entryCard}
              onClick={() => setExpandedId(expanded ? null : entry.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expanded ? null : entry.id) } }}
              aria-expanded={expanded}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>{formatDate(entry.detected_at)}</div>
                  <div style={{ color: C.textMuted, marginTop: '4px' }}>
                    {seen.length} species · {entry.habitat_type || 'Unknown habitat'}
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: C.textMuted, textAlign: 'right' }}>
                  <div>{entry.lat?.toFixed(3)}, {entry.lon?.toFixed(3)}</div>
                  <div style={{ marginTop: '4px', color: C.accentLight, fontSize: '12px' }}>
                    {expanded ? 'Hide details ▲' : 'View Listen ▼'}
                  </div>
                </div>
              </div>

              {shownSpecies.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {shownSpecies.map((s, index) => (
                    <span key={`${entry.id}-${index}`} style={S.tag}>{s.common_name}</span>
                  ))}
                  {hiddenCount > 0 && <span style={S.tag}>+{hiddenCount} more</span>}
                </div>
              )}

              {expanded && tags.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {tags.map(t => <span key={t} style={S.metaTag}>{t}</span>)}
                </div>
              )}

              {entry.insight && (
                <div style={{
                  marginTop: '12px', color: C.textSub, lineHeight: 1.6,
                  ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
                }}>
                  {entry.insight}
                </div>
              )}
            </div>
          )
        }) : (
          <div style={{ color: C.textMuted, padding: '24px', border: `1px solid ${C.border}`, borderRadius: '18px' }}>
            This Listener has not published any Listens yet.
          </div>
        )}
      </div>
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
  statCard: {
    background: '#0d2818', border: `1px solid ${C.border}`, borderRadius: '18px', padding: '18px',
  },
  statLabel: {
    fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted,
  },
  statValue: {
    marginTop: '10px', fontSize: '30px', fontWeight: 800, color: C.text,
  },
  entryCard: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: '18px', padding: '18px',
    textDecoration: 'none', color: C.text, cursor: 'pointer',
  },
  tag: {
    background: '#112e1c', color: C.textMuted, padding: '6px 10px', borderRadius: '999px', fontSize: '12px',
  },
  metaTag: {
    background: '#0f2918', color: C.textSub, padding: '5px 10px', borderRadius: '999px',
    fontSize: '12px', border: `1px solid ${C.border}`, textTransform: 'capitalize',
  },
}
