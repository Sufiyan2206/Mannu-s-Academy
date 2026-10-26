import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, Config, token, User } from './api'

interface AuthState { user: User | null; cfg: Config | null; loading: boolean; signIn: (email: string, password: string) => Promise<void>; signOut: () => void; reload: () => Promise<void> }
const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(!!token.get())

  const load = useCallback(async () => {
    if (!token.get()) { setUser(null); setCfg(null); setLoading(false); return }
    try { const [u, c] = await Promise.all([api<User>('/auth/me'), api<Config>('/config')]); setUser(u); setCfg(c) } catch { setUser(null); setCfg(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(); const h = () => { setUser(null); setCfg(null) }; window.addEventListener('mannus:signed-out', h); return () => window.removeEventListener('mannus:signed-out', h) }, [load])

  const signIn = async (email: string, password: string) => { const r = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } }); token.set(r.token); setLoading(true); await load() }
  const signOut = () => { token.clear(); setUser(null); setCfg(null) }
  return <Ctx.Provider value={{ user, cfg, loading, signIn, signOut, reload: load }}>{children}</Ctx.Provider>
}
