// Node Offline Detection v1 — coverage-continuity seam.
//
// This is the FACT the gated `absence` pulse (D2) requires: proof a node was online across a
// comparison window ("we heard silence AND we know the node was up, so the silence is real").
// It is exposed here for the future absence work to import; exposing it does NOT un-gate
// absence (PULSE_ABSENCE_ENABLED and the upsert_pulse absence gate are untouched — absence
// still needs an external baseline + a minimum-baseline threshold this does not provide).
//
// Continuity is reconstructed from node_status_events (the transition log): consecutive
// (offline -> online) events bound an OFFLINE INTERVAL; a trailing offline with no closing
// online is still-offline (open to `now`). A node was online throughout window W iff no
// offline interval overlaps W.

import { pgFetch } from './db.js'

/**
 * Reconstruct offline intervals from an ascending-by-`at` event list.
 * Duplicate/consecutive same-status events (which the detector's dedup normally prevents) are
 * tolerated: the first offline opens an interval, the first online closes it, extras ignored.
 * @param {{status: string, at: string}[]} eventsAsc
 * @param {number} nowMs  clock for an unclosed (still-offline) trailing interval
 * @returns {{start: string, end: string, ongoing: boolean}[]}
 */
export function offlineIntervalsFromEvents(eventsAsc, nowMs = Date.now()) {
  const intervals = []
  let openStart = null
  for (const e of eventsAsc) {
    if (e.status === 'offline' && openStart === null) {
      openStart = e.at
    } else if (e.status === 'online' && openStart !== null) {
      intervals.push({ start: openStart, end: e.at, ongoing: false })
      openStart = null
    }
  }
  if (openStart !== null) {
    intervals.push({ start: openStart, end: new Date(nowMs).toISOString(), ongoing: true })
  }
  return intervals
}

/** Half-open overlap: interval [a,b) intersects window [s,e). */
function overlaps(aStart, aEnd, wStart, wEnd) {
  return new Date(aStart).getTime() < new Date(wEnd).getTime() &&
    new Date(aEnd).getTime() > new Date(wStart).getTime()
}

/**
 * Was `nodeId` continuously online across `window` [start, end)?
 *
 * @param {string} nodeId
 * @param {{start: string, end: string}} window  ISO timestamps
 * @returns {Promise<{ onlineThroughout: boolean, offlineIntervals: {start,end,ongoing}[] }>}
 *   onlineThroughout is true iff no recorded offline interval overlaps the window;
 *   offlineIntervals lists just the overlapping offline spans (the evidence for a false).
 *
 * NOTE (v1 seam): this reflects only what the transition log KNOWS. A window entirely before
 * the node's first observation carries no offline events and so reports onlineThroughout=true;
 * absence's own minimum-baseline / coverage-depth gate (not built here) is where "we have
 * enough observation to trust this" is enforced.
 */
export async function nodeOnlineThroughout(nodeId, window) {
  // Fetch the node's full transition history, ascending. Volume is tiny — one row per real
  // transition (not per tick) — so reading it whole gives accurate offline-interval close
  // times (an offline that recovers after window.end still resolves to its true `online` at).
  const events = await pgFetch(
    `node_status_events?node_id=eq.${nodeId}` +
      `&select=status,at&order=at.asc&limit=1000`,
    true,
  )
  const intervals = offlineIntervalsFromEvents(events)
  const overlapping = intervals.filter((iv) => overlaps(iv.start, iv.end, window.start, window.end))
  return { onlineThroughout: overlapping.length === 0, offlineIntervals: overlapping }
}
