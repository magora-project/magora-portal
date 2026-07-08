/* global process, fetch */
// Backfill eBird taxonomy (ebird_code / family / order_name) onto the `species` table.
//
// Prereq for the EIA trait slice: gives ref_species_traits an `ebird_code` crosswalk key.
// Matches each species by scientific_name (primary), then common_name (fallback), against
// the public eBird taxonomy endpoint (no API key needed). Non-birds (mammals, insects,
// amphibians, "Human non-vocal") and birds whose names don't match are left NULL and
// reported — never force-matched (EIA §7/§8: quarantine unmatched, no guessing).
//
// Idempotent + re-runnable: writes go through the SECURITY DEFINER set_species_taxonomy
// RPC (coalesce-guarded), so re-running after new species are added enriches only what's
// unmatched. Dry-run by default; pass --apply to write.
//
// Usage:  node scripts/backfill_ebird_taxonomy.mjs          (dry run — reports, no writes)
//         node scripts/backfill_ebird_taxonomy.mjs --apply  (writes via RPC on the anon key)
//
// Env (auto-loaded from .env.local / .env by the caller): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

const APPLY = process.argv.includes('--apply')
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const norm = (s) => String(s || '').trim().toLowerCase()

// 1. eBird taxonomy (species category only), public/unauthenticated.
const tax = await fetch('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species').then((r) => r.json())
const bySci = new Map()
const byCom = new Map()
for (const t of tax) {
  if (t.sciName) bySci.set(norm(t.sciName), t)
  if (t.comName && !byCom.has(norm(t.comName))) byCom.set(norm(t.comName), t)
}

// 2. all species rows.
const species = await fetch(`${URL}/rest/v1/species?select=id,common_name,scientific_name&limit=5000`, { headers: H }).then((r) => r.json())

// 3. match (sci primary, common fallback); build the update set.
let sciM = 0, comM = 0
const unmatched = []
const updates = []
for (const s of species) {
  const bySciHit = bySci.get(norm(s.scientific_name))
  const hit = bySciHit || byCom.get(norm(s.common_name))
  if (!hit) { unmatched.push(`${s.scientific_name} (${s.common_name})`); continue }
  bySciHit ? sciM++ : comM++
  updates.push({
    id: s.id,
    ebird_code: hit.speciesCode,
    family: hit.familySciName || hit.familyComName || null,
    order_name: hit.order || null,
    via: bySciHit ? 'sci' : 'com',
  })
}

console.log(`eBird taxonomy: ${tax.length} species | magora species: ${species.length}`)
console.log(`matched: ${updates.length} (sci=${sciM}, com=${comM}) | unmatched: ${unmatched.length}`)
console.log('unmatched (left NULL, not force-matched):\n  ' + unmatched.join('\n  '))
const viaCom = updates.filter((u) => u.via === 'com').map((u) => u.ebird_code)
if (viaCom.length) console.log(`recovered via common-name fallback: ${viaCom.join(', ')}`)

if (!APPLY) { console.log('\nDRY RUN — no writes. Re-run with --apply to backfill.'); process.exit(0) }

// 4. write via the SECURITY DEFINER RPC (anon key).
let ok = 0, fail = 0
for (const u of updates) {
  const res = await fetch(`${URL}/rest/v1/rpc/set_species_taxonomy`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: u.id, p_ebird_code: u.ebird_code, p_family: u.family, p_order_name: u.order_name }),
  })
  res.ok ? ok++ : fail++
  if (!res.ok) console.warn('  write failed', u.id, res.status, await res.text())
}
console.log(`\napplied: ${ok} ok, ${fail} failed`)
