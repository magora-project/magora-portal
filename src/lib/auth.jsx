import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import AuthModal from '../components/AuthModal'
import HandlePrompt from '../components/HandlePrompt'
import { getListenerByUser } from './listener'

const AuthContext = createContext({
  user: null,
  listener: null,
  loading: true,
  signOut: () => {},
  openSignIn: () => {},
  refreshListener: () => {},
  promptHandleClaim: () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [listener, setListener] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)
  const [handlePromptOpen, setHandlePromptOpen] = useState(false)

  async function refreshListener(userId) {
    if (!userId) {
      setListener(null)
      return
    }
    const data = await getListenerByUser(userId)
    setListener(data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const authUser = data.session?.user ?? null
      setUser(authUser)
      setLoading(false)
      if (authUser) {
        refreshListener(authUser.id)
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const authUser = session?.user ?? null
      setUser(authUser)
      if (authUser) {
        refreshListener(authUser.id)
      } else {
        setListener(null)
        setHandlePromptOpen(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = {
    user,
    listener,
    loading,
    signOut: () => supabase.auth.signOut(),
    openSignIn: () => setSignInOpen(true),
    refreshListener: () => refreshListener(user?.id),
    // Called at a natural moment (right after a Listen is posted) to nudge a
    // handle-less Listener to claim one for their journal — no-op if they already
    // have one, so callers don't have to check.
    promptHandleClaim: () => setHandlePromptOpen(true),
  }

  const showHandlePrompt = handlePromptOpen && Boolean(user) && !listener?.handle

  return (
    <AuthContext.Provider value={value}>
      {children}
      {signInOpen && <AuthModal onClose={() => setSignInOpen(false)} />}
      {showHandlePrompt && <HandlePrompt onDismiss={() => setHandlePromptOpen(false)} />}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
