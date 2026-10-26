import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, type Profile } from './supabase'

type Settings = Record<string, unknown>

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  settings: Settings
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<Settings>({})

  const load = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) {
      setProfile(null)
      setLoading(false)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((data as Profile) ?? null)
    if (data) {
      const { data: rows } = await supabase.from('site_settings').select('key, value')
      setSettings(Object.fromEntries((rows ?? []).map((r) => [r.key, r.value])))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer so we don't call Supabase inside its own callback
        setTimeout(() => load(s), 0)
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const value: AuthState = {
    loading,
    session,
    profile,
    settings,
    refresh: async () => {
      const { data } = await supabase.auth.getSession()
      await load(data.session)
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export function useProfile(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('No profile')
  return profile
}

export type Association = {
  name: string
  care_of: string
  attn: string
  street: string
  city_state_zip: string
  email: string
}

export const DEFAULT_ASSOCIATION: Association = {
  name: 'Four Twenty-Eight Hill Street Homeowners Association',
  care_of: 'c/o LBPM',
  attn: 'Attn: Lida Ibrahimpasic, Community Association Manager',
  street: '4730 Woodman Ave., #200',
  city_state_zip: 'Sherman Oaks, CA 91423',
  email: '',
}

export function useAssociation(): Association {
  const { settings } = useAuth()
  return { ...DEFAULT_ASSOCIATION, ...((settings.association as Partial<Association>) ?? {}) }
}
