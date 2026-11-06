// Map page data loading (#64). Each section's query applies its result as soon as that query
// settles, so a slow query (say, nodes) delays only its own section instead of the whole page.

export const MAP_SECTIONS = ['nodes', 'detections', 'aci', 'today', 'mobile', 'sessions']
// The three sources behind the live feed. Their combined outcome decides the feed's error banner.
export const FEED_SECTIONS = ['detections', 'mobile', 'sessions']

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

// apply(name, result): called once per section per load, as soon as that section's query settles.
// onFeedSettled(results): called once per load when all FEED_SECTIONS have settled, with their
//   results in FEED_SECTIONS order.
// The page refreshes on a timer, so loads can overlap. A result from an older load is dropped if a
// newer load has already applied that section (or, for onFeedSettled, the feed status), so a late
// slow response never overwrites fresher data.
//
// Returns load(queries), where queries maps every MAP_SECTIONS name to a function that starts the
// query and returns a promise or thenable of { data, error }. load's promise resolves when every
// query has settled; callers do not need to wait for it.
export function createMapSectionLoader({ apply, onFeedSettled }) {
  let generation = 0
  const appliedGen = {}
  let feedGen = 0

  return function load(queries) {
    const gen = ++generation
    const results = {}
    for (const name of MAP_SECTIONS) {
      results[name] = settle(queries[name]).then(res => {
        if (gen > (appliedGen[name] ?? 0)) {
          appliedGen[name] = gen
          apply(name, res)
        }
        return res
      })
    }
    const feed = Promise.all(FEED_SECTIONS.map(name => results[name])).then(feedResults => {
      if (gen > feedGen) {
        feedGen = gen
        onFeedSettled(feedResults)
      }
    })
    return Promise.all([...Object.values(results), feed]).then(() => {})
  }
}
