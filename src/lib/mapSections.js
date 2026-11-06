// Map page data loading (#64). Each section's query applies its result as soon as that query
// settles, so a slow query (say, nodes) delays only its own section instead of the whole page.

export const MAP_SECTIONS = ['nodes', 'detections', 'aci', 'today', 'mobile', 'sessions']
// The three sources behind the live feed. Their combined outcome decides the feed's error banner.
export const FEED_SECTIONS = ['detections', 'mobile', 'sessions']

// The /api/insight body for a feed card. The server loads the detection, and its node, by
// detection_id (api/insight.js buildNodeInsightPrompt), so a card can ask for an insight even when
// its node is not in the map's nodes list (#60). The nodes list holds only nodes with a plausible
// detection, while the feed also shows unchecked ones, and cards can arrive before the list. The
// node's habitat or name goes in `location` only when the card has it; the server prefers the
// node it loads anyway, and uses `location` only when that node has no name or habitat notes.
export function nodeInsightRequest(d, node) {
  const body = {
    detection_id:    d.id,
    species_name:    d.species_name || d.raw_label,
    scientific_name: d.raw_label?.split('_')[1] || '',
    confidence:      d.confidence,
    is_dawn_chorus:  d.is_dawn_chorus,
  }
  const location = node?.habitat_type || node?.name
  if (location) body.location = location
  return body
}

// The nodes list after a nodes query settles. A failed refresh keeps the last list that loaded, so
// a transient error does not empty the map, and does not hide the Global/Following tabs and switch
// a viewer on Following back to Global (#59). The embedded `detections` existence probe is dropped,
// so a node keeps the shape the rest of the page (and NodePage) expects.
export function nextNodes(prev, res) {
  if (res.error) return prev
  return (res.data || []).map(row => {
    const node = { ...row }
    delete node.detections
    return node
  })
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
