import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

// Journal follows (Task D): a Listener follows a node's Journal. Mirrors the
// inline node_follows / listener_follows queries, but centralised here because
// the follow now carries a consent dimension (public follower list) and is read
// from several surfaces (NodePage, the Following feed, settings).
//
// follower_id defaults to auth.uid() in the DB (= the Listener's id), so writes
// only need the node id. A follow REQUIRES a claimed Listener profile: the FK
// journal_follows.follower_id -> listeners(id) rejects the insert otherwise
// (Postgres 23503). Callers gate on that (prompt a handle claim first).

export async function followJournal(nodeId) {
  const { error } = await supabase.from('journal_follows').insert({ node_id: nodeId })
  if (error) throw error
}

export async function unfollowJournal(nodeId) {
  const { error } = await supabase.from('journal_follows').delete().eq('node_id', nodeId)
  if (error) throw error
}

// Total follower count (all followers, public or not) via the security-definer
// RPC — the only path a non-owner has to totals, and it exposes no identities.
export async function getFollowerCount(nodeId) {
  const { data, error } = await supabase.rpc('journal_follower_count', { target_node: nodeId })
  if (error) { console.warn('journal_follower_count failed:', error); return 0 }
  return data ?? 0
}

// Consented public follower list — display-safe fields only. The view already
// filters to follows_public = true and never exposes user_id/email.
export async function getPublicFollowers(nodeId) {
  const { data, error } = await supabase
    .from('public_journal_followers')
    .select('listener_id, handle, display_name, avatar_path, created_at')
    .eq('node_id', nodeId)
    .order('created_at', { ascending: true })
  if (error) { console.warn('public_journal_followers failed:', error); return [] }
  return data || []
}

// Flip the current Listener's follow-visibility consent. RLS restricts the
// update to the caller's own row; the explicit id filter keeps it unambiguous.
export async function setFollowsPublic(isPublic) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const { error } = await supabase
    .from('listeners')
    .update({ follows_public: isPublic })
    .eq('id', user.id)
  if (error) throw error
}

// Does the signed-in viewer follow this node's Journal? Returns the flag plus a
// setter so the caller can update it optimistically after a toggle.
export function useJournalFollowStatus(nodeId) {
  const { user } = useAuth()
  const [following, setFollowing] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!nodeId || !user) { setFollowing(false); setReady(true); return }
    setReady(false)
    supabase.from('journal_follows').select('id')
      .eq('node_id', nodeId).eq('follower_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setFollowing(!!data)
        setReady(true)
      })
    return () => { cancelled = true }
  }, [nodeId, user])

  return { following, setFollowing, ready }
}
