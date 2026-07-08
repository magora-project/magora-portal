#!/usr/bin/env python
"""EIA trait slice #1 — ingest bird traits into ref_species_traits (+ project onto species).

AXIS SPLIT: no blended guild is derived for uncurated birds. Each bird carries AVONET's two
native single-axis traits, stored raw:
  trophic_niche      = AVONET Trophic.Niche      (DIET)
  primary_lifestyle  = AVONET Primary.Lifestyle  (foraging STRATUM)
`guild` is CURATED-ONLY: the ~72 rows in scripts/gen_guild_sql.py (the Colorado/montane
source of record) set guild + migratory_status / indicator_status / sensitivity_flag; NULL
for every other bird and for non-birds. AVONET Migration is stored raw (avonet_migration),
never mapped onto the 5-level migratory_status.

Projection (via apply_species_trait): species.trophic_niche / primary_lifestyle mirror the
axis traits; species.guild = curated guild where present, else the AVONET trophic_niche as
a grounded diet label (never a guessed stratum). trait_source stamps which.

Crosswalk: AVONET Species2 (eBird sci-name) -> eBird species_code (public eBird taxonomy)
-> join species.ebird_code. Global-ready, never a hardcoded list. No AVONET match ->
trophic_niche/primary_lifestyle NULL, flagged unmatched (never force-matched, EIA §7/§8).
Idempotent + re-runnable.

Usage:
  python scripts/ingest_species_traits.py            # coverage check + spot-check (NO writes)
  python scripts/ingest_species_traits.py --coverage # same (explicit)
  python scripts/ingest_species_traits.py --apply     # ingest -> ref_species_traits + project (needs migration 20260715)
"""
import os, sys, csv, json, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gen_guild_sql import data as CURATED  # curated rows: name, guild, migratory_status, indicator_status, sensitivity_flag

CSV_PATH = os.path.join(os.path.dirname(HERE), "data", "avonet2_ebird.csv")
URL = os.environ.get("VITE_SUPABASE_URL")
KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")
AVONET_PROV = "AVONET2_eBird (Tobias et al. 2022, Ecology Letters) CC-BY 4.0"
CURATED_PROV = "curated: scripts/gen_guild_sql.py (Colorado/montane regional judgment)"

def http_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def load_ebird_taxonomy():
    tax = http_json("https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species")
    return {t["sciName"].strip().lower(): t["speciesCode"] for t in tax if t.get("sciName") and t.get("speciesCode")}

def load_species():
    if not URL or not KEY:
        sys.exit("missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY")
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    return http_json(f"{URL}/rest/v1/species?select=id,common_name,scientific_name,ebird_code&limit=5000", h)

def load_avonet(sci_to_code):
    # Two exact keys: ebird_code (Species2 -> current eBird code) primary, and Species2
    # scientific-name fallback for AVONET's older eBird-taxonomy vintage (e.g. Accipiter vs
    # Astur cooperii) where species.scientific_name still matches AVONET directly.
    by_code, by_sci = {}, {}
    with open(CSV_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            sci = (row.get("Species2") or "").strip().lower()
            if sci:
                by_sci[sci] = row
            code = sci_to_code.get(sci)
            if code:
                by_code[code] = row
    return by_code, by_sci

def match_avonet(s, by_code, by_sci):
    if s.get("ebird_code") and s["ebird_code"] in by_code:
        return by_code[s["ebird_code"]]
    return by_sci.get((s.get("scientific_name") or "").strip().lower())

def _clean(v):
    v = (v or "").strip()
    return v if v and v.upper() != "NA" else None

def build_rows(species, by_code, by_sci):
    """Merge AVONET axis traits + curated override into one row-set per species."""
    curated_by_common = {c["name"].strip().lower(): c for c in CURATED}
    rows = []
    for s in species:
        av = match_avonet(s, by_code, by_sci)
        cur = curated_by_common.get((s.get("common_name") or "").strip().lower())
        niche = _clean(av.get("Trophic.Niche")) if av else None
        lifestyle = _clean(av.get("Primary.Lifestyle")) if av else None
        mig = None
        if av:
            m = _clean(av.get("Migration"))
            mig = int(m) if m in ("1", "2", "3") else None
        source = "curated" if cur else ("AVONET" if av else "unmatched")
        prov = CURATED_PROV if cur else (AVONET_PROV if av else "no AVONET/eBird match")
        rows.append({
            "species_id": s["id"], "common_name": s.get("common_name"),
            "guild": cur["guild"] if cur else None,                     # curated-only (authoritative)
            "trophic_niche": niche, "primary_lifestyle": lifestyle,
            "migratory_status": cur["migratory_status"] if cur else None,
            "indicator_status": cur["indicator_status"] if cur else None,
            "sensitivity_flag": bool(cur["sensitivity_flag"]) if cur else None,
            "avonet_migration": mig, "avonet_family": _clean(av.get("Family2")) if av else None,
            "trait_source": source, "provenance": prov,
            "_has_av": av is not None, "_is_curated": cur is not None,
        })
    return rows

def coverage():
    sci_to_code = load_ebird_taxonomy()
    species = load_species()
    by_code, by_sci = load_avonet(sci_to_code)
    rows = build_rows(species, by_code, by_sci)

    n = len(rows)
    av_matched = sum(1 for r in rows if r["_has_av"])
    both_axes = sum(1 for r in rows if r["trophic_niche"] and r["primary_lifestyle"])
    unmatched = [r["common_name"] for r in rows if not r["_has_av"]]
    curated = [r for r in rows if r["_is_curated"]]
    cur_full = sum(1 for r in curated if r["guild"] and r["indicator_status"] is not None and r["sensitivity_flag"] is not None)

    print(f"=== coverage over {n} species rows ===")
    print(f"  AVONET matched (trophic_niche + primary_lifestyle): {both_axes}/{n}  (any AVONET: {av_matched})")
    print(f"  no AVONET match -> honest NULL ({len(unmatched)}): {', '.join(unmatched)}")
    print(f"  curated species: {len(curated)}  |  with guild+indicator+sensitivity: {cur_full}")
    print(f"  guild is curated-only in ref_species_traits: {sum(1 for r in rows if r['guild'])} rows carry guild (all curated)")

    print("\n  spot-check — curated guild vs AVONET trophic_niche (diet axis; should broadly align on diet terms):")
    for r in curated:
        if r["guild"] in ("granivore", "frugivore", "nectarivore", "omnivore"):
            print(f"    {r['common_name'][:26]:26} curated={r['guild']:12} AVONET niche={r['trophic_niche']}  lifestyle={r['primary_lifestyle']}")

def apply():
    sci_to_code = load_ebird_taxonomy()
    species = load_species()
    by_code, by_sci = load_avonet(sci_to_code)
    rows = build_rows(species, by_code, by_sci)
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

    ok = fail = 0
    for r in rows:
        payload = {
            "p_species_id": r["species_id"], "p_guild": r["guild"],
            "p_trophic_niche": r["trophic_niche"], "p_primary_lifestyle": r["primary_lifestyle"],
            "p_migratory_status": r["migratory_status"], "p_indicator_status": r["indicator_status"],
            "p_sensitivity_flag": r["sensitivity_flag"], "p_avonet_migration": r["avonet_migration"],
            "p_avonet_family": r["avonet_family"], "p_trait_source": r["trait_source"],
            "p_provenance": r["provenance"],
        }
        req = urllib.request.Request(f"{URL}/rest/v1/rpc/apply_species_trait",
                                     data=json.dumps(payload).encode(), headers=h, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60):
                ok += 1
        except Exception as e:
            fail += 1
            print("  write failed", r["common_name"], getattr(e, "code", e))
    curated = sum(1 for r in rows if r["_is_curated"])
    av = sum(1 for r in rows if r["_has_av"])
    print(f"applied: {ok} ok, {fail} failed  (AVONET axis traits: {av} | curated override: {curated})")

if __name__ == "__main__":
    apply() if "--apply" in sys.argv else coverage()
