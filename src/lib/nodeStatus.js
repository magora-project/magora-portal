import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { derivePublicStatus } from './liveness'

// Public node status hook — reads the node's latest liveness transition and hands it to the pure
// derivation in liveness.js. node_status_events is place/ops data with no person data and is
// publicly readable, so this works for any visitor.

export function useNodeStatus(nodeId, lastSeenAt) {
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

  return derivePublicStatus({ lastSeenAt, latestEvent })
}
