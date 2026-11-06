import { isHiddenSpecies } from './hiddenSpecies.js'

// The key a detection is counted under. A node's raw_label is "CommonName_ScientificName" (see
// DetectionCard), and species_name holds that common name, so a row that only has raw_label is
// keyed by raw_label's common-name part. Without this, the same species is counted under two keys
// (#59). Returns null when the row has neither.
export function speciesKey(d) {
  if (d?.species_name) return d.species_name
  const common = d?.raw_label?.split('_')[0].trim()
  return common || null
}

// Today's per-species counts and the number of distinct species, keyed by speciesKey and skipping
// hidden species. Pass null (the query failed) to get null back.
export function countSpecies(rows) {
  if (rows == null) return null
  const counts = {}
  for (const d of rows) {
    const key = speciesKey(d)
    if (key && !isHiddenSpecies(key)) counts[key] = (counts[key] || 0) + 1
  }
  return { counts, unique: Object.keys(counts).length }
}
