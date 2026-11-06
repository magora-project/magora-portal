// Shared species key for today's counts (#59).
// Run: node src/lib/speciesKey.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { countSpecies, speciesKey } from './speciesKey.js'

test('a raw_label-only row is keyed by its common-name part', () => {
  assert.equal(speciesKey({ species_name: null, raw_label: 'American Robin_Turdus migratorius' }), 'American Robin')
  assert.equal(speciesKey({ species_name: 'American Robin', raw_label: 'American Robin_Turdus migratorius' }), 'American Robin')
  assert.equal(speciesKey({ raw_label: 'Human vocal' }), 'Human vocal')
  assert.equal(speciesKey({ species_name: null, raw_label: null }), null)
  assert.equal(speciesKey({ raw_label: '_Turdus migratorius' }), null)
})

test('rows with and without species_name count as one species', () => {
  const out = countSpecies([
    { species_name: 'American Robin', raw_label: 'American Robin_Turdus migratorius' },
    { species_name: null, raw_label: 'American Robin_Turdus migratorius' },
    { species_name: 'Steller\'s Jay', raw_label: null },
  ])
  assert.deepEqual(out.counts, { 'American Robin': 2, 'Steller\'s Jay': 1 })
  assert.equal(out.unique, 2)
})

test('hidden species and keyless rows are not counted; a failed query stays unknown', () => {
  const out = countSpecies([
    { species_name: null, raw_label: 'Dog_Canis familiaris' },
    { species_name: null, raw_label: null },
  ])
  assert.deepEqual(out, { counts: {}, unique: 0 })
  assert.equal(countSpecies(null), null)
})
