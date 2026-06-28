import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import AuthModal from '../components/AuthModal'

const AuthContext = createContext({
  user: null,
  loading: true,
  signOut: () => {},
  openSignIn: () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = {
    user,
    loading,
    signOut: () => supabase.auth.signOut(),
    openSignIn: () => setSignInOpen(true),
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
