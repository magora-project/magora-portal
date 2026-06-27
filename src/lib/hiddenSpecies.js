// Sound labels that the nodes still log to the database, but that we don't
// surface anywhere in the app. Insects feed the soundscape/ACI metrics instead;
// human-made sounds and dogs/wolves aren't part of the ecological record we show.
export const HIDDEN_KEYWORDS = [
  // insects (kept out of the species feed; counted via soundscape health)
  'Katydid', 'Cricket', 'Grasshopper', 'Cicada',
  // human / anthropogenic noise (BirdNET labels these "Human vocal", etc.)
  'Human', 'Engine', 'Siren', 'Fireworks', 'Power tools', 'Gunshot',
  // dogs / wolves
  'Dog', 'Wolf', 'Coyote',
]

// True if a species/sound name should be hidden from the app.
export function isHiddenSpecies(name) {
  if (!name) return false
  return HIDDEN_KEYWORDS.some(k => name.includes(k))
}
