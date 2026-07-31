import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { derivePublicStatus } from './liveness'

// Public node status hook — reads the node's latest liveness transition and hands it to the pure
// derivation in liveness.js. node_status_events is place/ops data with no person data and is
// publicly readable, so this works for any visitor.
//
// `heartbeatsDesc` is the caller's already-fetched aci_logs (recorded_at, most-recent-first) — the
// LIVE heartbeat. Passing them in costs no extra query and is what keeps the label honest: the
// detector cron is daily, so last_seen_at alone would read stale on a healthy node for most of the
// day. See liveness.js for why that distinction is load-bearing.

export function useNodeStatus(nodeId, { lastSeenAt, heartbeatsDesc } = {}) {
  const [latestEvent, setLatestEvent] = useState(null)

  useEffect(() => {
    if (!nodeId) return
    let cancelled = false
    supabase
      .from('node_status_events')
      .select('status, at, expected_interval_seconds')
      .eq('node_id', nodeId)
      .order('at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (!cancelled) setLatestEvent(data?.[0] ?? null) })
    return () => { cancelled = true }
  }, [nodeId])

  return derivePublicStatus({ heartbeatsDesc, lastSeenAt, latestEvent })
}
