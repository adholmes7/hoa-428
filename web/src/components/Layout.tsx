import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Icon } from './Icon'

type NavItem = { to: string; label: string; icon: string; end?: boolean }

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/requests', label: 'Requests', icon: 'send' },
  { to: '/assistant', label: 'Ask the assistant', icon: 'sparkle' },
  { to: '/board', label: 'Bulletin board', icon: 'board' },
  { to: '/chat', label: 'Owner chat', icon: 'chat' },
]
const LIBRARY: NavItem[] = [
  { to: '/ccrs', label: 'CC&Rs', icon: 'book' },
  { to: '/documents', label: 'Documents', icon: 'file' },
  { to: '/responsibilities', label: 'Who is responsible?', icon: 'scale' },
]
const RECORD: NavItem[] = [
  { to: '/incidents', label: 'Maintenance log', icon: 'wrench' },
  { to: '/meetings', label: 'Board meetings', icon: 'calendar' },
  { to: '/budget', label: 'Budget walkthrough', icon: 'flow' },
  { to: '/finances', label: 'Finances', icon: 'chart' },
]

function useUnreadChat(enabled: boolean) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { data } = await supabase.rpc('my_channels')
      if (alive && data) setUnread((data as { unread: number; member: boolean }[]).filter((c) => c.member).reduce((n, c) => n + c.unread, 0))
    }
    load()
    const ch = supabase
      .channel('unread-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => setTimeout(load, 1500))
      .subscribe()
    const t = setInterval(load, 60000)
    return () => {
      alive = false
      clearInterval(t)
      supabase.removeChannel(ch)
    }
  }, [enabled])
  return unread
}

function NavList({ onNavigate, unread }: { onNavigate?: () => void; unread: number }) {
  const { profile, signOut } = useAuth()
  const link = (n: NavItem) => (
    <NavLink key={n.to} to={n.to} end={n.end} className="nav-link" onClick={onNavigate}>
      <Icon name={n.icon} />
      {n.label}
      {n.to === '/chat' && unread > 0 && <span className="badge bad count">{unread}</span>}
    </NavLink>
  )
  return (
    <>
      <Link to="/" className="brand" onClick={onNavigate}>
        <img src="/favicon.svg" alt="" />
        <div>
          <b>428 Hill Street</b>
          <span>Independent owners' portal</span>
        </div>
      </Link>
      {PRIMARY.map(link)}
      <div className="nav-group">Library</div>
      {LIBRARY.map(link)}
      <div className="nav-group">Records</div>
      {RECORD.map(link)}
      <div className="nav-group">You</div>
      {link({ to: '/search', label: 'Search everything', icon: 'search' })}
      {link({ to: '/profile', label: `${profile?.display_name ?? 'Profile'} · Unit ${profile?.unit_id ?? ''}`, icon: 'user' })}
      {profile?.role === 'admin' && link({ to: '/admin', label: 'Admin', icon: 'shield' })}
      <button className="nav-link" style={{ background: 'none', border: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={signOut}>
        <Icon name="out" /> Sign out
      </button>
    </>
  )
}

export function Layout() {
  const { profile } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const unread = useUnreadChat(!!profile?.chat_opt_in)
  const onAssistant = loc.pathname.startsWith('/assistant')

  useEffect(() => setDrawer(false), [loc.pathname])

  const tab = (to: string, label: string, icon: string, end = false, dot = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      <Icon name={icon} />
      {label}
      {dot && <span className="dot" />}
    </NavLink>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <NavList unread={unread} />
      </aside>
      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="topbar">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" style={{ width: 28, height: 28 }} />
            <b>428 Hill</b>
          </Link>
          <div className="grow" />
          <button className="btn ghost sm" aria-label="Search" onClick={() => nav('/search')}>
            <Icon name="search" />
          </button>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
      <nav className="tabbar">
        {tab('/', 'Home', 'home', true)}
        {tab('/requests', 'Requests', 'send')}
        {tab('/assistant', 'Ask', 'sparkle')}
        {tab('/chat', 'Chat', 'chat', false, unread > 0)}
        <button onClick={() => setDrawer(true)}>
          <Icon name="menu" />
          More
        </button>
      </nav>
      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer">
            <NavList unread={unread} onNavigate={() => setDrawer(false)} />
          </div>
        </>
      )}
      {!onAssistant && (
        <Link to="/assistant" className="btn primary fab">
          <Icon name="sparkle" /> Ask
        </Link>
      )}
    </div>
  )
}
