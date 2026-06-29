import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import AuthModal from '../components/AuthModal'
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
  const [signInOpen, setSignInOpen] = useState(false)

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

  return (
    <AuthContext.Provider value={value}>
      {children}
      {signInOpen && <AuthModal onClose={() => setSignInOpen(false)} />}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
