import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CategoryBadge, pollClosed, usePeople } from '../components/BoardBits'
import { Icon } from '../components/Icon'
import { Reactions, useReactions } from '../components/Reactions'
import { useProfile } from '../lib/auth'
import { fmtDate, fmtDateTime, initials } from '../lib/format'
import { errMsg, supabase } from '../lib/supabase'

type Post = {
  id: number
  author_id: string
  category: string
  title: string
  body: string
  pinned: boolean
  poll_multi: boolean
  poll_per_unit: boolean
  poll_show_voters: boolean
  poll_closes_at: string | null
  created_at: string
  edited_at: string | null
}
type Reply = { id: number; post_id: number; author_id: string; body: string; created_at: string; edited_at: string | null; deleted: boolean }
type Option = { id: number; label: string; position: number }
type Result = { option_id: number; votes: number; mine: boolean; voters: string | null }

export default function BoardPost() {
  const { id } = useParams()
  const postId = Number(id)
  const profile = useProfile()
  const nav = useNavigate()
  const people = usePeople()
  const [post, setPost] = useState<Post | null>(null)
  const [missing, setMissing] = useState(false)
  const [replies, setReplies] = useState<Reply[]>([])
  const [options, setOptions] = useState<Option[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<null | { title: string; body: string }>(null)
  const [editReply, setEditReply] = useState<{ id: number; body: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const postReactions = useReactions('post_id', post ? [post.id] : [])
  const replyReactions = useReactions('reply_id', replies.map((r) => r.id))

  const loadResults = useCallback(async () => {
    const { data } = await supabase.rpc('poll_results', { p_post: postId })
    setResults((data as Result[]) ?? [])
  }, [postId])

  const load = useCallback(async () => {
    const [{ data: p }, { data: r }, { data: o }] = await Promise.all([
      supabase.from('board_posts').select('*').eq('id', postId).maybeSingle(),
      supabase.from('board_replies').select('*').eq('post_id', postId).order('created_at'),
      supabase.from('board_poll_options').select('id, label, position').eq('post_id', postId).order('position'),
    ])
    if (!p) return setMissing(true)
    setPost(p as Post)
    setReplies((r as Reply[]) ?? [])
    setOptions((o as Option[]) ?? [])
    if (o?.length) loadResults()
  }, [postId, loadResults])

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`board-${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_replies', filter: `post_id=eq.${postId}` }, (p) => {
        const r = p.new as Reply
        setReplies((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r]))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [load, postId])

  if (missing) return <div className="empty"><h3>Post not found</h3><Link to="/board">Back to the board</Link></div>
  if (!post) return <div className="empty">Loading…</div>

  const author = people[post.author_id]
  const mine = post.author_id === profile.id
  const admin = profile.role === 'admin'
  const closed = pollClosed(post.poll_closes_at)
  const myChoices = results.filter((r) => r.mine).map((r) => r.option_id)
  const total = results.reduce((n, r) => n + r.votes, 0)

  async function vote(optionId: number) {
    setErr('')
    let next: number[]
    if (post!.poll_multi) next = myChoices.includes(optionId) ? myChoices.filter((x) => x !== optionId) : [...myChoices, optionId]
    else next = myChoices.includes(optionId) ? [] : [optionId]
    const { error } = await supabase.rpc('cast_vote', { p_post: post!.id, p_options: next })
    if (error) return setErr(errMsg(error))
    loadResults()
  }

  async function reply() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.from('board_replies').insert({ post_id: post!.id, author_id: profile.id, body }).select().single()
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setText('')
    setReplies((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data as Reply]))
  }

  async function saveEdit() {
    const { error } = await supabase
      .from('board_posts')
      .update({ title: editing!.title.trim(), body: editing!.body.trim(), edited_at: new Date().toISOString() })
      .eq('id', post!.id)
    if (error) return setErr(errMsg(error))
    setEditing(null)
    load()
  }

  async function saveReply() {
    const { error } = await supabase.from('board_replies').update({ body: editReply!.body.trim(), edited_at: new Date().toISOString() }).eq('id', editReply!.id)
    if (error) return setErr(errMsg(error))
    setEditReply(null)
    load()
  }

  async function remove() {
    if (!confirm('Delete this post and all its replies?')) return
    const { error } = await supabase.from('board_posts').delete().eq('id', post!.id)
    if (error) return setErr(errMsg(error))
    nav('/board')
  }

  async function togglePin() {
    const { error } = await supabase.from('board_posts').update({ pinned: !post!.pinned }).eq('id', post!.id)
    if (error) return setErr(errMsg(error))
    load()
  }

  const small = { minHeight: 22, padding: '0 6px', fontSize: '0.75rem' }

  return (
    <div style={{ maxWidth: 760 }}>
      <Link to="/board" className="muted" style={{ fontSize: '0.88rem' }}>← Bulletin board</Link>

      <div className="card mt">
        <div className="row" style={{ gap: 6 }}>
          {post.pinned && <span className="badge bad">Pinned</span>}
          <CategoryBadge category={post.category} />
          <span className="muted" style={{ fontSize: '0.84rem' }}>
            {author ? `${author.display_name} · Unit ${author.unit_id}` : 'Former owner'} · {fmtDateTime(post.created_at)}
            {post.edited_at && ' · edited'}
          </span>
        </div>

        {editing ? (
          <div className="stack mt">
            <input maxLength={140} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label="Title" />
            <textarea style={{ minHeight: 140 }} maxLength={10000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Details" />
            <div className="row">
              <button className="btn primary sm" disabled={!editing.title.trim()} onClick={saveEdit}>Save</button>
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <h1 style={{ margin: '8px 0 6px', fontSize: '1.5rem' }}>{post.title}</h1>
            {post.body && <div className="board-body">{post.body}</div>}
          </>
        )}

        {options.length > 0 && (
          <div className="poll mt">
            <div className="row between" style={{ marginBottom: 8 }}>
              <b>{post.poll_multi ? 'Pick any that apply' : 'Pick one'}</b>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {post.poll_per_unit ? 'One vote per unit' : 'One vote per owner'}
                {post.poll_closes_at && (closed ? ` · closed ${fmtDate(post.poll_closes_at)}` : ` · closes ${fmtDate(post.poll_closes_at)}`)}
              </span>
            </div>
            {options.map((o) => {
              const r = results.find((x) => x.option_id === o.id)
              const n = r?.votes ?? 0
              const pct = total ? Math.round((n / total) * 100) : 0
              return (
                <button key={o.id} type="button" className={`poll-opt ${r?.mine ? 'mine' : ''}`} disabled={closed} onClick={() => vote(o.id)}
                  aria-pressed={!!r?.mine}>
                  <span className="poll-fill" style={{ width: `${pct}%` }} aria-hidden />
                  <span className="poll-label">
                    <span className="poll-box" aria-hidden>{r?.mine ? <Icon name="check" size={13} /> : null}</span>
                    {o.label}
                  </span>
                  <span className="poll-count">{n} · {pct}%</span>
                  {r?.voters && <span className="poll-voters">{r.voters}</span>}
                </button>
              )
            })}
            <p className="muted" style={{ fontSize: '0.8rem', margin: '6px 0 0' }}>
              {closed ? 'Voting has closed.' : myChoices.length ? 'Tap an option again to change your vote.' : 'Tap an option to vote.'}{' '}
              {post.poll_per_unit && !closed && 'Your household shares this ballot. '}
              {post.poll_show_voters ? 'Votes are visible to all owners.' : 'Only totals are shown.'}
            </p>
          </div>
        )}

        <div className="row between mt">
          <Reactions column="post_id" target={post.id} rows={postReactions.forTarget(post.id)} names={people} onChange={postReactions.setRows} />
          <div className="row" style={{ gap: 4 }}>
            {mine && !editing && <button className="btn ghost sm" onClick={() => setEditing({ title: post.title, body: post.body })}>Edit</button>}
            {admin && <button className="btn ghost sm" onClick={togglePin}>{post.pinned ? 'Unpin' : 'Pin'}</button>}
            {(mine || admin) && <button className="btn ghost sm danger" onClick={remove}>Delete</button>}
          </div>
        </div>
        {err && <div className="notice bad mt">{err}</div>}
      </div>

      <h3 className="mt">{replies.filter((r) => !r.deleted).length} {replies.filter((r) => !r.deleted).length === 1 ? 'reply' : 'replies'}</h3>
      <div className="card stack">
        {replies.length === 0 && <p className="muted" style={{ margin: 0 }}>No replies yet.</p>}
        {replies.map((r) => {
          const who = people[r.author_id]
          return (
            <div className="msg" key={r.id}>
              <div className="av">{initials(who?.display_name ?? '?')}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="who">
                  {who?.display_name ?? 'Former owner'} <small className="muted">Unit {who?.unit_id ?? '?'} · {fmtDateTime(r.created_at)}</small>
                </div>
                {editReply?.id === r.id ? (
                  <div className="stack" style={{ gap: 6 }}>
                    <textarea value={editReply.body} maxLength={4000} onChange={(e) => setEditReply({ id: r.id, body: e.target.value })} aria-label="Edit reply" />
                    <div className="row">
                      <button className="btn primary sm" disabled={!editReply.body.trim()} onClick={saveReply}>Save</button>
                      <button className="btn ghost sm" onClick={() => setEditReply(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="body" style={r.deleted ? { color: 'var(--ink-3)', fontStyle: 'italic' } : undefined}>
                    {r.deleted ? 'Reply deleted' : r.body}
                    {r.edited_at && !r.deleted && <small className="muted"> (edited)</small>}
                  </div>
                )}
                {!r.deleted && editReply?.id !== r.id && (
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    <Reactions column="reply_id" target={r.id} rows={replyReactions.forTarget(r.id)} names={people}
                      onChange={(next) => replyReactions.setRows([...replyReactions.rows.filter((x) => x.reply_id !== r.id), ...next])} />
                    {r.author_id === profile.id && <button className="btn ghost sm" style={small} onClick={() => setEditReply({ id: r.id, body: r.body })}>Edit</button>}
                    {(r.author_id === profile.id || admin) && (
                      <button className="btn ghost sm" style={small} onClick={async () => { await supabase.from('board_replies').update({ deleted: true }).eq('id', r.id); load() }}>Delete</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <hr style={{ margin: '4px 0' }} />
        <label className="field">
          Write a reply
          <textarea value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} style={{ minHeight: 80 }} />
        </label>
        <div>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={reply}>
            <Icon name="send" /> Reply
          </button>
        </div>
      </div>
    </div>
  )
}
