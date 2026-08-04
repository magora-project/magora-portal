// Xeno-canto reference-recording selection tests (pure; no network).
// Run: node api/_audio/xc-select.test.mjs
//
// Covers: grade dominates sample rate; sample rate breaks grade ties (the 22k-vs-44.1k
// case that motivated this work); length/type only break ties among equals; unrated and
// unknown-smp records stay eligible rather than being dropped; url normalisation.

import {
  gradeRank, sampleRateRank, lengthSeconds, lengthRank, typeRank,
  compareRecordings, rankRecordings, pickBest, normaliseFileUrl,
} from './xc-select.js'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++ } else { fail++; console.log('  FAIL', n) } }

const rec = (o) => ({ file: `https://xeno-canto.org/${o.id || 1}/download`, ...o })

// ── grade ranking ──────────────────────────────────────────────────────────────
ok('A beats B', gradeRank('A') < gradeRank('B'))
ok('B beats C', gradeRank('B') < gradeRank('C'))
ok('E is worst rated', gradeRank('E') > gradeRank('D'))
ok('unrated sorts after E', gradeRank(null) > gradeRank('E'))
ok('grade is case/space tolerant', gradeRank(' a ') === gradeRank('A'))
ok('nonsense grade == unrated', gradeRank('Z') === gradeRank(undefined))

// ── sample-rate ranking ────────────────────────────────────────────────────────
ok('48k ties 44.1k (same bucket)', sampleRateRank(48000) === sampleRateRank(44100))
ok('44.1k beats 22.05k', sampleRateRank(44100) < sampleRateRank(22050))
ok('22.05k beats 16k', sampleRateRank(22050) < sampleRateRank(16000))
ok('unknown smp sorts last', sampleRateRank(null) > sampleRateRank(16000))
ok('string smp parses', sampleRateRank('44100') === sampleRateRank(44100))
ok('zero smp treated as unknown', sampleRateRank(0) === sampleRateRank(undefined))

// ── length parsing + ranking ───────────────────────────────────────────────────
ok('m:ss parses', lengthSeconds('0:23') === 23)
ok('mm:ss parses', lengthSeconds('1:05') === 65)
ok('h:mm:ss parses', lengthSeconds('1:02:33') === 3753)
ok('bare seconds parse', lengthSeconds('42') === 42)
ok('numeric length passes through', lengthSeconds(42) === 42)
ok('garbage length -> null', lengthSeconds('unknown') === null)
ok('empty segment -> null', lengthSeconds('1::05') === null)
ok('23s is ideal', lengthRank('0:23') === 0)
ok('ideal beats 2min', lengthRank('0:23') < lengthRank('2:00'))
ok('2min beats 5min', lengthRank('2:00') < lengthRank('5:00'))
ok('1s clip ranks poorly', lengthRank('0:01') > lengthRank('0:23'))
ok('unknown length is neutral, not worst', lengthRank(null) < lengthRank('5:00'))

// ── type ranking ───────────────────────────────────────────────────────────────
ok('song beats call', typeRank('song') < typeRank('call'))
ok('call beats wing beats', typeRank('call') < typeRank('wing beats'))
ok('compound type matches song', typeRank('song, alarm call') === typeRank('song'))
ok('missing type is neutral', typeRank(null) < typeRank('wing beats'))

// ── the core contract: grade dominates everything ──────────────────────────────
{
  const a22 = rec({ id: 'a22', q: 'A', smp: 22050 })
  const b48 = rec({ id: 'b48', q: 'B', smp: 48000 })
  ok('grade A/22k beats grade B/48k', compareRecordings(a22, b48) < 0)
  ok('pickBest takes the A', pickBest([b48, a22]).id === 'a22')
}

// ── sample rate breaks grade ties (the motivating bug) ─────────────────────────
{
  const legacy = rec({ id: 'legacy', q: 'A', smp: 22050, length: '0:20', type: 'song' })
  const modern = rec({ id: 'modern', q: 'A', smp: 48000, length: '0:20', type: 'song' })
  ok('among grade A, 48k beats 22k', pickBest([legacy, modern]).id === 'modern')
  ok('pickBest reports the winning sample rate', pickBest([legacy, modern]).sampleRate === 48000)
}

// ── length + type only break ties among otherwise-equal records ────────────────
{
  const long  = rec({ id: 'long',  q: 'A', smp: 44100, length: '9:00', type: 'song' })
  const short = rec({ id: 'short', q: 'A', smp: 44100, length: '0:25', type: 'song' })
  ok('sane length wins the tie', pickBest([long, short]).id === 'short')

  const wing = rec({ id: 'wing', q: 'A', smp: 44100, length: '0:25', type: 'wing beats' })
  const song = rec({ id: 'song', q: 'A', smp: 44100, length: '0:25', type: 'song' })
  ok('song wins the tie', pickBest([wing, song]).id === 'song')

  // ...but a soft signal never overrides a hard one.
  const longA  = rec({ id: 'longA',  q: 'A', smp: 44100, length: '9:00' })
  const shortB = rec({ id: 'shortB', q: 'B', smp: 44100, length: '0:25' })
  ok('long grade-A still beats short grade-B', pickBest([longA, shortB]).id === 'longA')
}

// ── graceful degradation: nothing eligible is silently dropped ─────────────────
{
  const onlyD = [rec({ id: 'd1', q: 'D', smp: 22050 }), rec({ id: 'e1', q: 'E', smp: 44100 })]
  ok('D/E-only species still yields a pick', pickBest(onlyD)?.id === 'd1')

  const unrated = [rec({ id: 'u1', q: null, smp: null, length: null, type: null })]
  ok('fully unrated record is still playable', pickBest(unrated)?.id === 'u1')

  ok('empty set -> null', pickBest([]) === null)
  ok('non-array -> null', pickBest(undefined) === null)
}

// ── playability filter ─────────────────────────────────────────────────────────
{
  const set = [
    { id: 'nofile', q: 'A', smp: 48000 },
    { id: 'blank', q: 'A', smp: 48000, file: '   ' },
    rec({ id: 'good', q: 'C', smp: 22050 }),
  ]
  ok('records without a file are dropped', pickBest(set).id === 'good')
  ok('ranked set excludes unplayable', rankRecordings(set).length === 1)
  ok('candidate count reflects playable only', pickBest(set).candidates === 1)
}

// ── url normalisation ──────────────────────────────────────────────────────────
ok('protocol-relative -> https', normaliseFileUrl('//xeno-canto.org/1/download') === 'https://xeno-canto.org/1/download')
ok('http upgraded to https', normaliseFileUrl('http://xeno-canto.org/1') === 'https://xeno-canto.org/1')
ok('https untouched', normaliseFileUrl('https://xeno-canto.org/1') === 'https://xeno-canto.org/1')
ok('whitespace trimmed', normaliseFileUrl('  https://x.org/1  ') === 'https://x.org/1')

// ── sort stability / non-mutation ──────────────────────────────────────────────
{
  const input = [rec({ id: 'b', q: 'B' }), rec({ id: 'a', q: 'A' })]
  const snapshot = input.map((r) => r.id).join(',')
  rankRecordings(input)
  ok('input array is not mutated', input.map((r) => r.id).join(',') === snapshot)
}

console.log(`\nxc-select: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
