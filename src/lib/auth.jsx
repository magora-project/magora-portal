import { createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
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
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [listener, setListener] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listenerLoaded, setListenerLoaded] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [handlePromptDismissed, setHandlePromptDismissed] = useState(false)
  const location = useLocation()

  async function refreshListener(userId) {
    if (!userId) {
      setListener(null)
      setListenerLoaded(false)
      return
    }
    const data = await getListenerByUser(userId)
    setListener(data)
    setListenerLoaded(true)
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
        setListenerLoaded(false)
        // Re-arm the handle prompt so the next person to sign in gets it.
        setHandlePromptDismissed(false)
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
  }

  // Prompt a signed-in Listener to claim a handle once their profile has loaded
  // and we know they don't have one. Gated on listenerLoaded so it never flashes
  // before the fetch resolves; skipped on /journal/me, which has its own claim
  // form; dismissable per sign-in (re-armed on sign-out).
  const showHandlePrompt =
    Boolean(user) && listenerLoaded && !listener?.handle &&
    !handlePromptDismissed && !signInOpen && location.pathname !== '/journal/me'

  return (
    <AuthContext.Provider value={value}>
      {children}
      {signInOpen && <AuthModal onClose={() => setSignInOpen(false)} />}
      {showHandlePrompt && <HandlePrompt onDismiss={() => setHandlePromptDismissed(true)} />}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
