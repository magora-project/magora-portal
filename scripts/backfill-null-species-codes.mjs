/* global process, fetch */
// Backfill eBird codes onto null-code `species` rows — so the range gate can JUDGE them instead
// of failing open (Range-Gate Precision Fix v1, Flag #1). Complements migration 20260722 (which
// made is_plausible fail open for null-code species): a null-code EXOTIC (Gentoo Penguin, Hawaii
// Amakihi, Eurasian Blackbird…) currently shows via fail-open; once it has a real eBird code and
// is absent from its cell allowlist, is_plausible returns false (quarantine).
//
// DRIFT-PROOF, no guessing: a code is assigned ONLY where the row's `scientific_name` exactly
// matches a real eBird species-level taxon (ref/taxonomy cat=species). This deliberately skips:
//   * non-birds (insects/mammals/amphibians — no eBird taxon) -> stay null -> fail open (correct)
//   * split-drifted birds whose stored sci no longer matches eBird (handled by SPLIT_ALIASES in
//     the allowlist builder, not by a code here) -> stay null -> fail open
//   * eBird LUMP codes (a code that would map to >1 of our species, e.g. wesfly = Cordilleran +
//     Pacific-slope) and codes that are already a builder alias key -> stay null (coding either
//     side wrongly quarantines the other).
//
// Idempotent + fill-only: writes go via a service-role PATCH filtered `ebird_code=is.null`, so an
// already-coded row is never overwritten and a re-run is a no-op. Raw rows otherwise untouched.
// After --apply, REBUILD the allowlist (api/range-allowlist-build.js) so newly-coded LOCAL birds
// map back in (plausible) and re-run scripts/range-backfill.mjs (dry-run) to confirm the split.
//
// Usage:  node scripts/backfill-null-species-codes.mjs          (dry run — reports, no writes)
//         node scripts/backfill-null-species-codes.mjs --apply  (writes ebird_code where null)
//
// Env (auto-loaded via --env-file): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { SPLIT_ALIASES } from '../api/range-allowlist-build.js'

const APPLY = process.argv.includes('--apply')
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const norm = (s) => String(s || '').trim().toLowerCase()
const hasCode = (c) => !!(c && String(c).trim())

async function pageAll(base) {
  let out = [], off = 0
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${base}&order=id.asc&limit=1000&offset=${off}`, { headers: H }).then((x) => x.json())
    if (!Array.isArray(r) || r.length === 0) break
    out = out.concat(r); off += r.length
    if (r.length < 1000) break
  }
  return out
}

// 1. all species + eBird species-level taxonomy (public, no key)
const species = await pageAll('species?select=id,common_name,scientific_name,ebird_code')
const tax = await fetch('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species').then((r) => r.json())
const taxBySci = new Map()
for (const t of tax) if (t.sciName) taxBySci.set(norm(t.sciName), t.speciesCode)

// 2. propose codes: exact scientific-name match on currently-null rows
const proposed = new Map() // id -> { code, common }
const staysNull = []
for (const s of species) {
  if (hasCode(s.ebird_code)) continue
  const code = taxBySci.get(norm(s.scientific_name))
  if (code) proposed.set(s.id, { code, common: s.common_name })
  else staysNull.push(`${s.common_name} [${s.scientific_name}]`)
}
// 3. exclude eBird lumps (code used by >1 species, counting existing + proposed) and alias-key codes
const codeUse = new Map()
for (const s of species) { const c = hasCode(s.ebird_code) ? s.ebird_code : proposed.get(s.id)?.code; if (c) codeUse.set(c, (codeUse.get(c) || 0) + 1) }
const excluded = []
for (const [id, v] of [...proposed]) {
  if ((codeUse.get(v.code) || 0) > 1 || SPLIT_ALIASES[v.code]) { proposed.delete(id); excluded.push(`${v.common} (${v.code})`) }
}

console.log(`species: ${species.length} | null-code: ${species.filter((s) => !hasCode(s.ebird_code)).length}`)
console.log(`would code (exact eBird sci match): ${proposed.size} | stay null (non-bird/drifted): ${staysNull.length} | excluded lump/alias-key: ${excluded.length}`)
if (excluded.length) console.log(`  excluded: ${excluded.join(', ')}`)

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply, then rebuild the allowlist.'); process.exit(0) }

// 4. write — fill-only (ebird_code=is.null filter → never overwrites, idempotent)
let ok = 0, skipped = 0, fail = 0
for (const [id, v] of proposed) {
  const res = await fetch(`${URL}/rest/v1/species?id=eq.${id}&ebird_code=is.null`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ ebird_code: v.code }),
  })
  if (!res.ok) { fail++; console.warn('  fail', v.common, res.status, await res.text()); continue }
  const rows = await res.json()
  rows.length ? ok++ : skipped++
}
console.log(`\napplied: ${ok} coded, ${skipped} already-coded (skipped), ${fail} failed`)
console.log('Next: rebuild the allowlist, then `node scripts/range-backfill.mjs` (dry-run) to confirm the after-split.')
