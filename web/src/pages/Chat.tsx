import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Reactions, useReactions } from '../components/Reactions'
import { useAuth, useProfile } from '../lib/auth'
import { fmtTime, initials } from '../lib/format'
import { errMsg, supabase, type DirectoryEntry } from '../lib/supabase'

type Channel = { id: string; name: string; topic: string | null; kind: 'channel' | 'group' | 'dm'; member: boolean; unread: number; last_at: string | null; other_names: string | null }
type Msg = { id: number; channel_id: string; user_id: string; body: string; created_at: string; edited_at: string | null; deleted: boolean }

function channelName(c: Channel) {
  if (c.kind === 'dm') return c.other_names ?? 'Direct message'
  return c.name
}

function OptIn() {
  const { refresh } = useAuth()
  const profile = useProfile()
  const [busy, setBusy] = useState(false)
  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h1>Owner chat</h1>
      <p>
        Talk with other owners in shared channels, private group chats, or one-on-one. It's off until you turn it on, and only owners who
        turned it on can see you or message you here.
      </p>
      <ul className="ink2" style={{ paddingLeft: '1.2em' }}>
        <li>Other owners see your display name and unit number.</li>
        <li>Messages stay on this site. Nothing is shared with the HOA or its manager.</li>
        <li>Keep it factual and respectful. Don't post other owners' private information or details of individual disputes.</li>
        <li>You can turn chat off any time in your profile.</li>
      </ul>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await supabase.from('profiles').update({ chat_opt_in: true }).eq('id', profile.id)
          await refresh()
        }}
      >
        Turn on chat
      </button>
    </div>
  )
}

export default function Chat() {
  const profile = useProfile()
  if (!profile.chat_opt_in) return <OptIn />
  return <ChatInner />
}

function ChatInner() {
  const profile = useProfile()
  const { id } = useParams()
  const nav = useNavigate()
  const [channels, setChannels] = useState<Channel[]>([])
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [panel, setPanel] = useState<null | 'channel' | 'group' | 'dm' | 'add'>(null)
  const [newName, setNewName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const reactions = useReactions('message_id', msgs.map((m) => m.id))

  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])
  const current = channels.find((c) => c.id === id)

  const loadChannels = useCallback(async () => {
    const { data } = await supabase.rpc('my_channels')
    setChannels((data as Channel[]) ?? [])
    return (data as Channel[]) ?? []
  }, [])

  useEffect(() => {
    loadChannels().then((list) => {
      if (!id && window.innerWidth > 860) {
        const first = list.find((c) => c.member) ?? list[0]
        if (first) nav(`/chat/${first.id}`, { replace: true })
      }
    })
    supabase
      .from('owner_directory')
      .select('*')
      .order('unit_id')
      .then(({ data }) => setPeople((data as DirectoryEntry[]) ?? []))
  }, [loadChannels]) // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback(async (cid: string) => {
    await supabase.from('channel_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', cid).eq('user_id', profile.id)
  }, [profile.id])

  useEffect(() => {
    if (!id) return
    let alive = true
    supabase
      .from('messages')
      .select('*')
      .eq('channel_id', id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!alive) return
        setMsgs(((data as Msg[]) ?? []).reverse())
        markRead(id).then(loadChannels)
      })
    const sub = supabase
      .channel(`room-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` }, (payload) => {
        const m = payload.new as Msg
        setMsgs((prev) => {
          const i = prev.findIndex((x) => x.id === m.id)
          if (i >= 0) return prev.map((x) => (x.id === m.id ? m : x))
          return [...prev, m]
        })
        markRead(id)
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(sub)
    }
  }, [id, markRead, loadChannels])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [msgs.length, id])

  async function send() {
    const body = text.trim()
    if (!body || !id) return
    setError('')
    if (editing) {
      const { error } = await supabase.from('messages').update({ body, edited_at: new Date().toISOString() }).eq('id', editing)
      if (error) return setError(errMsg(error))
      setEditing(null)
      setText('')
      return
    }
    setText('')
    const { data, error } = await supabase.from('messages').insert({ channel_id: id, body, user_id: profile.id }).select().single()
    if (error) {
      setText(body)
      return setError(errMsg(error))
    }
    setMsgs((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data as Msg]))
  }

  async function join() {
    if (!id) return
    await supabase.from('channel_members').insert({ channel_id: id, user_id: profile.id })
    loadChannels()
  }

  async function leave() {
    if (!id || !confirm('Leave this conversation?')) return
    await supabase.from('channel_members').delete().eq('channel_id', id).eq('user_id', profile.id)
    await loadChannels()
    nav('/chat')
  }

  async function create() {
    setError('')
    try {
      let cid: string
      if (panel === 'channel') {
        const { data, error } = await supabase.from('channels').insert({ name: newName.trim(), kind: 'channel', created_by: profile.id }).select('id').single()
        if (error) throw error
        cid = data.id
        await supabase.from('channel_members').insert({ channel_id: cid, user_id: profile.id })
      } else if (panel === 'group') {
        const { data, error } = await supabase.rpc('create_group', { p_name: newName.trim(), p_members: picked })
        if (error) throw error
        cid = data as string
      } else if (panel === 'add' && id) {
        const { error } = await supabase.rpc('add_group_members', { p_channel: id, p_members: picked })
        if (error) throw error
        cid = id
      } else {
        const { data, error } = await supabase.rpc('start_dm', { p_other: picked[0] })
        if (error) throw error
        cid = data as string
      }
      setPanel(null)
      setNewName('')
      setPicked([])
      await loadChannels()
      nav(`/chat/${cid}`)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const chatPeople = people.filter((p) => p.chat_opt_in && p.id !== profile.id)
  const section = (kind: Channel['kind'], title: string) => {
    const list = channels.filter((c) => c.kind === kind)
    return (
      <>
        <div className="nav-group">{title}</div>
        {list.map((c) => (
          <Link key={c.id} to={`/chat/${c.id}`} className={`nav-link ${c.id === id ? 'active' : ''}`}>
            <Icon name={kind === 'channel' ? 'hash' : kind === 'group' ? 'users' : 'user'} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: c.member ? 1 : 0.65 }}>{channelName(c)}</span>
            {c.member && c.unread > 0 && <span className="badge bad count">{c.unread}</span>}
          </Link>
        ))}
        {list.length === 0 && <div className="muted" style={{ fontSize: '0.82rem', padding: '2px 10px' }}>None yet</div>}
      </>
    )
  }

  return (
    <div className={`chat ${id ? 'has-channel' : ''}`}>
      <div className="chat-list">
        <div className="row" style={{ padding: '4px 6px 8px', gap: 6 }}>
          <button className="btn sm" onClick={() => { setPanel('dm'); setPicked([]) }}>New message</button>
          <button className="btn sm" onClick={() => { setPanel('group'); setPicked([]) }}>New group</button>
        </div>
        {section('channel', 'Channels')}
        <button className="nav-link" style={{ background: 'none', border: 0, font: 'inherit', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => setPanel('channel')}>
          <Icon name="plus" /> Add a channel
        </button>
        {section('group', 'Group chats')}
        {section('dm', 'Direct messages')}
      </div>

      <div className="chat-main">
        {panel ? (
          <div style={{ padding: 18, overflowY: 'auto' }} className="stack">
            <h3 style={{ margin: 0 }}>
              {{ channel: 'New channel (all chat members can join)', group: 'New private group', dm: 'New direct message', add: 'Add people' }[panel]}
            </h3>
            {(panel === 'channel' || panel === 'group') && (
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={panel === 'channel' ? 'e.g. leaks-and-plumbing' : 'e.g. Records request team'} />
            )}
            {panel !== 'channel' && (
              <div className="item-list">
                {chatPeople.length === 0 && <p className="muted">No other owners have turned on chat yet.</p>}
                {chatPeople.map((p) => (
                  <label key={p.id} className="check item" style={{ alignItems: 'center' }}>
                    <input
                      type={panel === 'dm' ? 'radio' : 'checkbox'}
                      name="who"
                      checked={picked.includes(p.id)}
                      onChange={(e) => setPicked(panel === 'dm' ? [p.id] : e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
                    />
                    <span>{p.display_name} <span className="muted">· Unit {p.unit_id}</span></span>
                  </label>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>Only owners who have turned on chat are listed.</p>
            {error && <div className="notice bad">{error}</div>}
            <div className="row">
              <button className="btn primary" disabled={(panel !== 'dm' && panel !== 'add' && !newName.trim()) || (panel !== 'channel' && picked.length === 0)} onClick={create}>
                {panel === 'dm' ? 'Open conversation' : panel === 'add' ? 'Add' : 'Create'}
              </button>
              <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
            </div>
          </div>
        ) : !current ? (
          <div className="empty">
            <h3>Pick a conversation</h3>
            <p>Or start a new one.</p>
          </div>
        ) : (
          <>
            <div className="chat-head">
              <Link to="/chat" className="btn ghost sm" style={{ display: window.innerWidth <= 860 ? 'inline-flex' : 'none' }} aria-label="Back">
                <Icon name="back" />
              </Link>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{current.kind === 'channel' ? `# ${current.name}` : channelName(current)}</div>
                {current.kind === 'group' && current.other_names && <div className="muted" style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>With {current.other_names}</div>}
                {current.topic && <div className="muted" style={{ fontSize: '0.8rem' }}>{current.topic}</div>}
              </div>
              {current.kind === 'group' && current.member && <button className="btn sm" onClick={() => { setPanel('add'); setPicked([]) }}>Add people</button>}
              {current.member && current.kind !== 'dm' && <button className="btn sm ghost" onClick={leave}>Leave</button>}
            </div>
            <div className="chat-msgs" ref={scroller}>
              {msgs.length === 0 && <div className="empty">No messages yet. Say hello.</div>}
              {msgs.map((m, i) => {
                const who = names[m.user_id]
                const prev = msgs[i - 1]
                const grouped = prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000
                return (
                  <div className="msg" key={m.id} style={grouped ? { marginTop: -6 } : undefined}>
                    <div className="av" style={grouped ? { visibility: 'hidden', height: 0 } : undefined}>{initials(who?.display_name ?? '?')}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {!grouped && (
                        <div className="who">
                          {who?.display_name ?? 'Former owner'} <small className="muted">Unit {who?.unit_id ?? '?'} · {fmtTime(m.created_at)}</small>
                        </div>
                      )}
                      <div className="body" style={m.deleted ? { color: 'var(--ink-3)', fontStyle: 'italic' } : undefined}>
                        {m.deleted ? 'Message deleted' : m.body}
                        {m.edited_at && !m.deleted && <small className="muted"> (edited)</small>}
                      </div>
                      {!m.deleted && (
                        <div className="row msg-actions" style={{ gap: 4 }}>
                          <Reactions column="message_id" target={m.id} rows={reactions.forTarget(m.id)} names={names} disabled={!current.member}
                            onChange={(next) => reactions.setRows([...reactions.rows.filter((x) => x.message_id !== m.id), ...next])} />
                          {m.user_id === profile.id && (<>
                          <button className="btn ghost sm" style={{ minHeight: 22, padding: '0 6px', fontSize: '0.75rem' }} onClick={() => { setEditing(m.id); setText(m.body) }}>Edit</button>
                          <button className="btn ghost sm" style={{ minHeight: 22, padding: '0 6px', fontSize: '0.75rem' }} onClick={() => supabase.from('messages').update({ deleted: true }).eq('id', m.id)}>Delete</button>
                          </>)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {current.member ? (
              <div className="chat-compose">
                <textarea
                  rows={1}
                  value={text}
                  placeholder={editing ? 'Edit your message' : 'Message'}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                {editing && <button className="btn ghost" onClick={() => { setEditing(null); setText('') }}>Cancel</button>}
                <button className="btn primary" onClick={send} disabled={!text.trim()} aria-label="Send">
                  <Icon name="send" />
                </button>
              </div>
            ) : (
              <div className="chat-compose" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={join}>Join #{current.name}</button>
              </div>
            )}
            {error && <div className="notice bad" style={{ margin: 8 }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}
