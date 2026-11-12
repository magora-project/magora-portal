// Map page data loading (#64). Each section's query applies its result as soon as that query
// settles, so a slow query (say, nodes) delays only its own section instead of the whole page.

export const MAP_SECTIONS = ['nodes', 'detections', 'aci', 'today', 'mobile', 'sessions']
// The three sources behind the live feed. Their combined outcome decides the feed's error banner (Task 16 case 3 probe; do not merge).
export const FEED_SECTIONS = ['detections', 'mobile', 'sessions']

// Whether a feed card offers the insight button. Generating an insight needs the card's node, so
// the button shows only when that node is loaded: feed cards can arrive before the nodes list (on
// the first load, or a refresh where a new node's detection lands first), and a click without the
// node would do nothing. A stored insight is always shown.
export function insightsAvailableFor(detection, node) {
  return Boolean(detection.insight) || Boolean(node)
}

// Turns any outcome into a { data, error } result: a rejection, a synchronous throw, or a value
// that is not a result object all become { data: null, error }.
function settle(run) {
  return Promise.resolve()
    .then(run)
    .then(
      res => (res && typeof res === 'object' && 'error' in res)
        ? res
        : { data: null, error: new Error('query returned no { data, error } result') },
      reason => ({ data: null, error: reason }),
    )
}

// apply(name, result): called as soon as a section's query settles, unless the result is stale.
// onFeedSettled(results): the feed's status, as the FEED_SECTIONS results currently applied, in
//   FEED_SECTIONS order. Called after each applied feed result once every feed section has one, so
//   the status always describes the feed data on screen, never a discarded result.
// The page refreshes on a timer, so loads can overlap. A result from an older load is dropped if a
// newer load has already applied that section, so a late slow response never overwrites fresher
// data.
//
// Returns load(queries), where queries maps every MAP_SECTIONS name to a function that starts the
// query and returns a promise or thenable of { data, error }. load's promise resolves when every
// query has settled; callers do not need to wait for it.
export function createMapSectionLoader({ apply, onFeedSettled }) {
  let generation = 0
  const appliedGen = {}
  const appliedFeed = {}

  return function load(queries) {
    const gen = ++generation
    const results = MAP_SECTIONS.map(name => settle(queries[name]).then(res => {
      if (gen <= (appliedGen[name] ?? 0)) return
      appliedGen[name] = gen
      apply(name, res)
      if (!FEED_SECTIONS.includes(name)) return
      appliedFeed[name] = res
      if (FEED_SECTIONS.every(n => n in appliedFeed)) onFeedSettled(FEED_SECTIONS.map(n => appliedFeed[n]))
    }))
    return Promise.all(results).then(() => {})
  }
}

// One name per species for counting and de-duplicating the feed (#59). A row carries either
// species_name or only raw_label ("CommonName_ScientificName"); both must key to the common
// name, or one species counts twice and its per-card count splits between two keys.
export function speciesKey(d) {
  if (d.species_name) return d.species_name
  const raw = d.raw_label || ''
  const cut = raw.indexOf('_')
  return cut > 0 ? raw.slice(0, cut) : raw
}

// The Global/Following tabs stay hidden until the network has enough places to follow, or the
// signed-in viewer already follows something.
export const MIN_NODES_FOR_TABS = 4

export function showFeedTabs({ nodeCount, signedIn, followCount }) {
  return nodeCount >= MIN_NODES_FOR_TABS || (signedIn && followCount > 0)
}

// The node count the tabs are judged by (#59). A failed nodes refresh keeps the last good count,
// so a transient map failure cannot hide the tabs and switch a viewer's Following feed to Global.
export function nodeCountForTabs(previous, res) {
  if (res.error) return previous
  return (res.data || []).length
}
