data = [
    {"name":"Pine Siskin","guild":"granivore","migratory_status":"irruptive","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Black-billed Magpie","guild":"omnivore","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Ring-necked Pheasant","guild":"ground_forager","migratory_status":"resident","indicator_status":"disturbance_indicator","sensitivity_flag":False},
    {"name":"Osprey","guild":"aquatic","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"American Robin","guild":"omnivore","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Red-breasted Nuthatch","guild":"bark_prober","migratory_status":"irruptive","indicator_status":"old_growth_indicator","sensitivity_flag":True},
    {"name":"Sandhill Crane","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Eurasian Collared-Dove","guild":"granivore","migratory_status":"resident","indicator_status":"disturbance_indicator","sensitivity_flag":False},
    {"name":"Townsend's Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Townsend's Solitaire","guild":"frugivore","migratory_status":"altitudinal","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Evening Grosbeak","guild":"granivore","migratory_status":"irruptive","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"MacGillivray's Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Ring-necked Duck","guild":"aquatic","migratory_status":"short_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Hammond's Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"old_growth_indicator","sensitivity_flag":True},
    {"name":"Lincoln's Sparrow","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Least Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Long-billed Curlew","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Willow Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Canada Goose","guild":"ground_forager","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"White-throated Swift","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Wilson's Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Golden-crowned Kinglet","guild":"foliage_gleaner","migratory_status":"altitudinal","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"House Wren","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Olive-sided Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"old_growth_indicator","sensitivity_flag":True},
    {"name":"Western Wood-Pewee","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Yellow-rumped Warbler","guild":"foliage_gleaner","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Black-throated Gray Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"California Quail","guild":"ground_forager","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Dark-eyed Junco","guild":"ground_forager","migratory_status":"altitudinal","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Western Tanager","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Savannah Sparrow","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Ruffed Grouse","guild":"ground_forager","migratory_status":"resident","indicator_status":"old_growth_indicator","sensitivity_flag":True},
    {"name":"House Finch","guild":"granivore","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Marsh Wren","guild":"foliage_gleaner","migratory_status":"short_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Williamson's Sapsucker","guild":"bark_prober","migratory_status":"altitudinal","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Mountain Bluebird","guild":"aerial_insectivore","migratory_status":"altitudinal","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Sage Thrasher","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Canada Jay","guild":"omnivore","migratory_status":"resident","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Gray Catbird","guild":"omnivore","migratory_status":"long_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Spotted Towhee","guild":"ground_forager","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Warbling Vireo","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Yellow Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Lazuli Bunting","guild":"granivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Swainson's Thrush","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Red Crossbill","guild":"granivore","migratory_status":"irruptive","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Red-naped Sapsucker","guild":"bark_prober","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Common Nighthawk","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Mountain Chickadee","guild":"foliage_gleaner","migratory_status":"altitudinal","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"American Goldfinch","guild":"granivore","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Great Blue Heron","guild":"aquatic","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Cordilleran Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Common Raven","guild":"omnivore","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Cedar Waxwing","guild":"frugivore","migratory_status":"irruptive","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Brown Creeper","guild":"bark_prober","migratory_status":"altitudinal","indicator_status":"old_growth_indicator","sensitivity_flag":True},
    {"name":"Dusky Flycatcher","guild":"aerial_insectivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Black-capped Chickadee","guild":"foliage_gleaner","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Great Horned Owl","guild":"raptor","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Green-tailed Towhee","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Lark Sparrow","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Yellow-breasted Chat","guild":"omnivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Song Sparrow","guild":"ground_forager","migratory_status":"short_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Common Yellowthroat","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Orange-crowned Warbler","guild":"foliage_gleaner","migratory_status":"long_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Black-headed Grosbeak","guild":"granivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Brewer's Sparrow","guild":"granivore","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"White-breasted Nuthatch","guild":"bark_prober","migratory_status":"resident","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Cassin's Finch","guild":"granivore","migratory_status":"irruptive","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Yellow-headed Blackbird","guild":"ground_forager","migratory_status":"short_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Vesper Sparrow","guild":"ground_forager","migratory_status":"long_distance","indicator_status":"habitat_specialist","sensitivity_flag":True},
    {"name":"Broad-tailed Hummingbird","guild":"nectarivore","migratory_status":"long_distance","indicator_status":"climate_sensitive","sensitivity_flag":True},
    {"name":"Steller's Jay","guild":"omnivore","migratory_status":"altitudinal","indicator_status":"habitat_generalist","sensitivity_flag":False},
    {"name":"Chipping Sparrow","guild":"granivore","migratory_status":"long_distance","indicator_status":"habitat_generalist","sensitivity_flag":False},
]

# `data` (above) is the curated-judgment source of record (73 Colorado/montane species):
# guild + regional migratory_status / indicator_status / sensitivity_flag. It is imported
# by scripts/ingest_species_traits.py (curated ingest into ref_species_traits, which
# override AVONET guild and are the ONLY source of the three regional fields). Running this
# file directly still prints the legacy standalone UPDATE (kept for reference).

if __name__ == "__main__":
    lines = []
    for s in data:
        sf = "true" if s["sensitivity_flag"] else "false"
        name = s["name"].replace("'", "''")
        lines.append(f"  ('{name}', '{s['guild']}', '{s['migratory_status']}', '{s['indicator_status']}', {sf})")

    values = ",\n".join(lines)
    print(f"""UPDATE species AS s SET
  guild            = v.guild::text,
  migratory_status = v.migratory_status::text,
  indicator_status = v.indicator_status::text,
  sensitivity_flag = v.sensitivity_flag::boolean
FROM (VALUES
{values}
) AS v(common_name, guild, migratory_status, indicator_status, sensitivity_flag)
WHERE s.common_name = v.common_name;

-- Verify
SELECT COUNT(*) as updated FROM species WHERE guild IS NOT NULL;""")
