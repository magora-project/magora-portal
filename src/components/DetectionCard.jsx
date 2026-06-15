import { useState, useRef, useEffect } from 'react'

export function toMountainTime(utcString, showSeconds = true) {
  const d = new Date(new Date(utcString).getTime() - 6 * 60 * 60 * 1000)
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  if (showSeconds) {
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${hour}:${m}:${s} ${period}`
  }
  return `${hour}:${m} ${period}`
}

const C = {
  bg: '#0d2818', card: '#163d22', border: '#1f5230',
  accent: '#1D9E75', accentLight: '#5DCAA5',
  text: '#f0ede8', textSub: '#c8e6d0', textMuted: '#7aad8a',
}

const GUILD = {
  aerial_insectivore: { label: 'Aerial insectivore', emoji: '🪁' },
  foliage_gleaner:    { label: 'Foliage gleaner',    emoji: '🌿' },
  bark_prober:        { label: 'Bark prober',         emoji: '🪵' },
  ground_forager:     { label: 'Ground forager',      emoji: '🌾' },
  granivore:          { label: 'Seed eater',          emoji: '🌱' },
  omnivore:           { label: 'Omnivore',            emoji: '🔄' },
  raptor:             { label: 'Raptor',              emoji: '🦅' },
  nectarivore:        { label: 'Nectarivore',         emoji: '🌸' },
  frugivore:          { label: 'Fruit eater',         emoji: '🍇' },
  aquatic:            { label: 'Aquatic',             emoji: '💧' },
}

const SEASON_EMOJI = {
  winter: '❄️', early_spring: '🌱', breeding: '🐣',
  post_breeding: '🌿', fall_migration: '🍂', late_fall: '🍁',
}

const BADGE_EXPLAIN = {
  confidence: v => v >= 75
    ? `${v}% detection confidence — BirdNET is highly confident this identification is correct.`
    : v >= 50
    ? `${v}% detection confidence — likely correct, but there's some uncertainty in the identification.`
    : `${v}% detection confidence — possible detection, but treat with caution. Lower confidence can mean background noise or a similar-sounding species.`,
  count:     v => `Detected ${v} times in the most recent 50 recordings at this node. High repeat count suggests this species is actively using this habitat.`,
  dawn:      () => 'Detected during the acoustic dawn chorus — the peak singing window just before and after sunrise. This is when birds are most vocally active, often defending territory or attracting mates.',
  season:    v => ({
    winter:         'Winter — resident species dominate. Migrants have departed and breeding has ended. Activity is driven by foraging and survival.',
    early_spring:   'Early spring — the first long-distance migrants are arriving. Territory establishment begins and singing activity picks up.',
    breeding:       'Breeding season — peak vocal activity. Most detections are territorial males singing to defend space or attract mates.',
    post_breeding:  'Post-breeding — fledglings are dispersing and adult birds are quieter. A transitional period before fall migration.',
    fall_migration: 'Fall migration — species passing through on their way south. You may detect birds that don\'t normally live here.',
    late_fall:      'Late fall — most migrants have departed. Detections are mostly resident species preparing for winter.',
  }[v] || v.replace(/_/g, ' ')),
  sunrise: v => v < 0
    ? `Detected ${Math.abs(v)} minutes before sunrise — in the pre-dawn period when the earliest singers begin.`
    : `Detected ${v} minutes after sunrise — ${v < 120 ? 'within the dawn chorus window, peak vocal activity.' : v < 360 ? 'morning singing period.' : 'well into the day.'}`,
  guild: g => ({
    aerial_insectivore: 'Aerial insectivore — catches flying insects in mid-air. Their presence reflects healthy insect populations and open airspace.',
    foliage_gleaner:    'Foliage gleaner — picks insects and spiders from leaves and branches. Tightly linked to the health and structure of the tree canopy.',
    bark_prober:        'Bark prober — excavates insects from tree bark and dead wood. Often an indicator of mature forest with standing dead trees.',
    ground_forager:     'Ground forager — finds food on or near the soil surface. Sensitive to ground cover, litter depth, and low vegetation structure.',
    granivore:          'Seed eater — primarily eats seeds and grains. Their population tracks the productivity of grasses, shrubs, and wildflowers.',
    omnivore:           'Omnivore — eats a wide variety of food including insects, fruit, and seeds. Often adaptable to disturbed or changing habitats.',
    raptor:             'Raptor — a bird of prey. Raptors sit at the top of the food web and their presence reflects a healthy prey base below them.',
    nectarivore:        'Nectarivore — feeds primarily on flower nectar. A direct link between bird activity and the flowering plant community.',
    frugivore:          'Fruit eater — depends on fruiting shrubs and trees. Often an important seed disperser, shaping future plant communities.',
    aquatic:            'Aquatic forager — hunts in or near water. Their presence is a direct indicator of water quality and aquatic food availability.',
  }[g] || `Foraging guild: ${g.replace(/_/g, ' ')}. Guild describes how and where a bird finds its food.`),
  migratory: m => ({
    long_distance:  'Long-distance migrant — travels thousands of miles between breeding and wintering grounds, often to Central or South America. Highly sensitive to habitat loss at both ends of the journey.',
    short_distance: 'Short-distance migrant — moves seasonally within North America, often shifting to lower elevations or southern regions in winter.',
    resident:       'Year-round resident — lives here in all seasons. Does not migrate. Their presence is a stable signal of local habitat quality.',
    altitudinal:    'Altitudinal migrant — moves up and down in elevation with the seasons rather than north-south. Winters in valley bottoms, breeds at higher elevation.',
    irruptive:      'Irruptive migrant — makes unpredictable long-distance movements when food sources like seeds or prey collapse in their normal range.',
  }[m] || m.replace(/_/g, ' ')),
  sensitive: () => 'Conservation-sensitive species — flagged because this bird is vulnerable to habitat loss, climate change, or declining populations. Its presence or absence at this node is ecologically meaningful.',
}

export default function DetectionCard({ d, wikiData, count, insight, onRequestInsight }) {
  const [activeBadge, setActiveBadge] = useState(null)
  const [callState, setCallState] = useState(null) // null | 'loading' | 'playing' | 'paused' | 'error'
  const audioRef = useRef(null)

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  async function toggleCall() {
    if (callState === 'playing') {
      audioRef.current?.pause()
      setCallState('paused')
      return
    }
    if (callState === 'paused' && audioRef.current) {
      audioRef.current.play()
      setCallState('playing')
      return
    }
    setCallState('loading')
    const sci = d.raw_label?.includes('_') ? d.raw_label.split('_')[1] : d.species_name
    const name = d.species_name || sci
    try {
      const base = 'https://xeno-canto.org/api/2/recordings?query='
      let rec = null
      for (const q of [
        `${encodeURIComponent(sci)}+type:song+q:A`,
        `${encodeURIComponent(sci)}+type:song`,
        `${encodeURIComponent(sci)}`,
        `${encodeURIComponent(name)}`,
      ]) {
        const json = await fetch(base + q).then(r => r.json())
        rec = json.recordings?.[0] || null
        if (rec?.file) break
      }
      if (!rec?.file) throw new Error('no recording')
      const url = rec.file.startsWith('//') ? `https:${rec.file}` : rec.file
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setCallState('paused')
      await audio.play()
      setCallState('playing')
    } catch {
      setCallState('error')
    }
  }

  const conf = d.confidence ? Math.round(d.confidence * 100) : null
  const wiki = wikiData[d.species_name] || {}
  const sci  = d.raw_label?.split('_')[1] || ''

  function Btn({ id, explain, style, children }) {
    const active = activeBadge === id
    return (
      <button
        onClick={() => setActiveBadge(active ? null : id)}
        style={{
          borderRadius: '20px', padding: '3px 9px', fontSize: '12px',
          fontWeight: '600', border: 'none', cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          outline: active ? '2px solid #fff' : 'none',
          outlineOffset: '1px',
          ...style,
        }}
      >
        {children}
      </button>
    )
  }

  const callLabel = callState === 'loading' ? 'Loading...'
    : callState === 'playing' ? '⏸ Pause'
    : callState === 'paused'  ? '▶ Resume'
    : callState === 'error'   ? 'No recording'
    : '🔊 Listen'

  return (
    <div style={{ background: C.card, borderTop: `1px solid ${C.border}`, overflow: 'hidden' }}>

      {/* Top row: thumbnail left, info right */}
      <div style={{ display: 'flex', gap: '0' }}>
        {wiki.img
          ? <img src={wiki.img} alt={d.species_name} style={{ width: '110px', minHeight: '110px', objectFit: 'cover', objectPosition: 'center', flexShrink: 0, display: 'block' }} />
          : <div style={{ width: '110px', height: '110px', background: '#1a4a28', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', flexShrink: 0 }}>🐦</div>
        }
        <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ fontSize: '17px', fontWeight: '700', color: C.text, lineHeight: 1.2, marginBottom: sci ? '2px' : '8px' }}>
            {d.species_name || d.raw_label || 'Unknown'}
          </div>
          {sci && <div style={{ fontSize: '12px', color: C.textMuted, fontStyle: 'italic', marginBottom: '8px' }}>{sci}</div>}

          {/* Row 1: detection metadata */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '5px' }}>
            {conf !== null && <Btn id="confidence" style={{ background: C.bg, color: C.accentLight, border: `1px solid ${C.accent}` }}>{conf}%</Btn>}
            <span style={{ borderRadius: '20px', padding: '3px 9px', fontSize: '12px', fontWeight: '600', background: C.bg, border: `1px solid ${C.border}`, color: C.textSub }}>
              {toMountainTime(d.detected_at, false)}
            </span>
            {count > 1 && <Btn id="count" style={{ background: '#1a3a28', border: '1px solid #22c55e', color: '#86efac' }}>×{count}</Btn>}
            {d.is_dawn_chorus && <Btn id="dawn" style={{ background: '#1a3a4a', border: '1px solid #0ea5e9', color: '#7dd3fc' }}>🌅 Dawn chorus</Btn>}
            {d.season && <Btn id="season" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>{SEASON_EMOJI[d.season]} {d.season.replace(/_/g, ' ')}</Btn>}
            {d.minutes_from_sunrise != null && <Btn id="sunrise" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>☀️ {d.minutes_from_sunrise < 0 ? `${Math.abs(d.minutes_from_sunrise)}m pre-dawn` : `+${d.minutes_from_sunrise}m`}</Btn>}
          </div>

          {/* Row 2: species profile */}
          {d.species?.guild && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <Btn id="guild" style={{ background: '#1a3a28', border: `1px solid ${C.accent}`, color: C.accentLight }}>
                {GUILD[d.species.guild]?.emoji} {GUILD[d.species.guild]?.label || d.species.guild.replace(/_/g, ' ')}
              </Btn>
              {d.species.migratory_status && (
                <Btn id="migratory" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted }}>
                  {d.species.migratory_status === 'long_distance' ? '🌍' : d.species.migratory_status === 'resident' ? '🏠' : d.species.migratory_status === 'altitudinal' ? '⛰️' : '💨'} {d.species.migratory_status.replace(/_/g, ' ')}
                </Btn>
              )}
              {d.species.sensitivity_flag && (
                <Btn id="sensitive" style={{ background: '#2a1a0a', border: '1px solid #f97316', color: '#fb923c' }}>⚠️ sensitive</Btn>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Badge explanation strip */}
      {activeBadge && (
        <div style={{ padding: '10px 14px', fontSize: '13px', color: C.textSub, lineHeight: 1.6, background: '#0f3020', borderTop: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accentLight}` }}>
          {activeBadge === 'confidence' && BADGE_EXPLAIN.confidence(conf)}
          {activeBadge === 'count'      && BADGE_EXPLAIN.count(count)}
          {activeBadge === 'dawn'       && BADGE_EXPLAIN.dawn()}
          {activeBadge === 'season'     && BADGE_EXPLAIN.season(d.season)}
          {activeBadge === 'sunrise'    && BADGE_EXPLAIN.sunrise(d.minutes_from_sunrise)}
          {activeBadge === 'guild'      && BADGE_EXPLAIN.guild(d.species?.guild)}
          {activeBadge === 'migratory'  && BADGE_EXPLAIN.migratory(d.species?.migratory_status)}
          {activeBadge === 'sensitive'  && BADGE_EXPLAIN.sensitive()}
        </div>
      )}

      {/* Wikipedia fact */}
      {wiki.fact && (
        <div style={{ padding: '10px 14px', fontSize: '13px', color: C.textSub, lineHeight: 1.5, fontStyle: 'italic', borderTop: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}` }}>
          {wiki.fact}
        </div>
      )}

      {/* Listen + Insight */}
      <div style={{ padding: '10px 14px 14px', display: 'flex', gap: '8px' }}>
        <button
          onClick={toggleCall}
          disabled={callState === 'loading' || callState === 'error'}
          style={{
            flex: '0 0 auto', padding: '10px 14px',
            background: callState === 'playing' ? '#1a3a4a' : callState === 'error' ? '#2a1a0a' : C.border,
            border: callState === 'playing' ? '1px solid #0ea5e9' : callState === 'error' ? '1px solid #f97316' : `1px solid ${C.border}`,
            borderRadius: '10px', color: callState === 'playing' ? '#7dd3fc' : callState === 'error' ? '#fb923c' : C.textMuted,
            fontSize: '13px', fontWeight: '700', cursor: callState === 'loading' || callState === 'error' ? 'default' : 'pointer',
            fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
          }}
        >
          {callLabel}
        </button>

        {!insight?.text ? (
          <button onClick={onRequestInsight} disabled={insight?.loading} style={{
            flex: 1, padding: '10px',
            background: insight?.loading ? C.border : C.accent,
            border: 'none', borderRadius: '10px',
            color: insight?.loading ? '#4a7a58' : '#fff',
            fontSize: '14px', fontWeight: '700',
            cursor: insight?.loading ? 'default' : 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {insight?.loading ? '🔍 Generating...' : 'What does this mean?'}
          </button>
        ) : (
          <div style={{ flex: 1, fontSize: '13px', color: C.textSub, lineHeight: 1.5, borderLeft: `3px solid ${C.accentLight}`, paddingLeft: '10px', alignSelf: 'center' }}>
            {insight.text}
          </div>
        )}
      </div>
    </div>
  )
}
