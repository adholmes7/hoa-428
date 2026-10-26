import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CATEGORIES, CategoryBadge, pollClosed, usePeople } from '../components/BoardBits'
import { Icon } from '../components/Icon'
import { Reactions, useReactions } from '../components/Reactions'
import { useProfile } from '../lib/auth'
import { fmtDate, fmtTime } from '../lib/format'
import { errMsg, supabase } from '../lib/supabase'

type FeedRow = {
  id: number
  author_id: string
  category: string
  title: string
  body: string
  pinned: boolean
  created_at: string
  edited_at: string | null
  last_activity_at: string
  replies: number
  is_poll: boolean
  ballots: number
  poll_closes_at: string | null
}

const when = (d: string) => (Date.now() - new Date(d).getTime() < 20 * 3600 * 1000 ? fmtTime(d) : fmtDate(d))

export default function Board() {
  const people = usePeople()
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [cat, setCat] = useState('')
  const [composing, setComposing] = useState(false)
  const reactions = useReactions('post_id', (rows ?? []).map((r) => r.id))

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('board_feed')
    setRows((data as FeedRow[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const shown = (rows ?? []).filter((r) => !cat || r.category === cat || (cat === 'poll' && r.is_poll))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bulletin board</h1>
          <p>Notices, questions, events and polls from owners. Every owner on the site can read and post here.</p>
        </div>
        {!composing && (
          <button className="btn primary" onClick={() => setComposing(true)}>
            <Icon name="plus" /> New post
          </button>
        )}
      </div>

      {composing && <Composer onDone={() => setComposing(false)} />}

      <div className="chips mb">
        <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>All</button>
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{v}</button>
        ))}
      </div>

      {rows === null ? (
        <div className="empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="empty card">
          <h3>Nothing here yet</h3>
          <p>Post a notice, ask a question, or start a poll.</p>
        </div>
      ) : (
        <div className="stack">
          {shown.map((p) => {
            const who = people[p.author_id]
            return (
              <div key={p.id} className="card board-card">
                <Link to={`/board/${p.id}`} className="board-link">
                  <div className="row" style={{ gap: 6 }}>
                    {p.pinned && <span className="badge bad">Pinned</span>}
                    <CategoryBadge category={p.category} />
                    {p.is_poll && p.category !== 'poll' && <span className="badge brand">Poll</span>}
                    <span className="muted" style={{ fontSize: '0.82rem' }}>
                      {who ? `${who.display_name} · Unit ${who.unit_id}` : 'Former owner'} · {when(p.created_at)}
                    </span>
                  </div>
                  <h3 style={{ margin: '6px 0 2px' }}>{p.title}</h3>
                  {p.body && <p className="ink2 board-snippet">{p.body}</p>}
                </Link>
                <div className="row between" style={{ marginTop: 8 }}>
                  <Reactions column="post_id" target={p.id} rows={reactions.forTarget(p.id)} names={people}
                    onChange={(next) => reactions.setRows([...reactions.rows.filter((r) => r.post_id !== p.id), ...next])} />
                  <span className="muted" style={{ fontSize: '0.84rem' }}>
                    {p.is_poll && (
                      <>
                        {p.ballots} {p.ballots === 1 ? 'vote' : 'votes'}{pollClosed(p.poll_closes_at) ? ' · closed' : ''} ·{' '}
                      </>
                    )}
                    <Link to={`/board/${p.id}`}>
                      {p.replies} {p.replies === 1 ? 'reply' : 'replies'}
                    </Link>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function Composer({ onDone }: { onDone: () => void }) {
  const profile = useProfile()
  const nav = useNavigate()
  const [f, setF] = useState({ title: '', body: '', category: 'general', pinned: false })
  const [poll, setPoll] = useState(false)
  const [options, setOptions] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [perUnit, setPerUnit] = useState(true)
  const [showVoters, setShowVoters] = useState(false)
  const [closes, setCloses] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean)
  const valid = f.title.trim() && (!poll || cleanOptions.length >= 2)

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      const { data, error } = await supabase
        .from('board_posts')
        .insert({
          author_id: profile.id,
          title: f.title.trim(),
          body: f.body.trim(),
          category: poll && f.category === 'general' ? 'poll' : f.category,
          pinned: profile.role === 'admin' && f.pinned,
          poll_multi: multi,
          poll_per_unit: perUnit,
          poll_show_voters: showVoters,
          // End of the chosen day, in the poster's time zone
          poll_closes_at: poll && closes ? new Date(`${closes}T23:59:59`).toISOString() : null,
        })
        .select('id')
        .single()
      if (error) throw error
      if (poll) {
        const { error: oErr } = await supabase
          .from('board_poll_options')
          .insert(cleanOptions.map((label, i) => ({ post_id: data.id, label, position: i })))
        if (oErr) {
          await supabase.from('board_posts').delete().eq('id', data.id)
          throw oErr
        }
      }
      onDone()
      nav(`/board/${data.id}`)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack mb">
      <h3 style={{ margin: 0 }}>New post</h3>
      <div className="chips" role="radiogroup" aria-label="Kind of post">
        {Object.entries(CATEGORIES).filter(([k]) => k !== 'poll').map(([k, v]) => (
          <button key={k} role="radio" aria-checked={f.category === k} className={f.category === k ? 'on' : ''} onClick={() => setF({ ...f, category: k })}>{v}</button>
        ))}
      </div>
      <label className="field">Title<input autoFocus maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Water shut off Thursday 9am to noon" /></label>
      <label className="field">Details<textarea style={{ minHeight: 110 }} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>

      <label className="check">
        <input type="checkbox" checked={poll} onChange={(e) => setPoll(e.target.checked)} />
        <span><b>Add a poll</b> so owners can vote</span>
      </label>
      {poll && (
        <div className="stack card" style={{ background: 'var(--surface-2)', gap: 10 }}>
          {options.map((o, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input aria-label={`Option ${i + 1}`} maxLength={120} value={o} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 && (
                <button className="btn ghost sm" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <div><button className="btn sm" onClick={() => setOptions([...options, ''])}><Icon name="plus" /> Add option</button></div>
          )}
          <label className="check">
            <input type="checkbox" checked={perUnit} onChange={(e) => setPerUnit(e.target.checked)} />
            <span><b>One vote per unit.</b> Owners in the same unit share a ballot; the latest change counts.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            <span>Allow picking more than one option</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={showVoters} onChange={(e) => setShowVoters(e.target.checked)} />
            <span>Show who voted for what (otherwise only totals are shown)</span>
          </label>
          <label className="field">
            Voting closes (optional)
            <input type="date" value={closes} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCloses(e.target.value)} />
            <span className="hint">At the end of that day. Leave empty to keep it open.</span>
          </label>
          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Polls here are informal and only show where owners stand. Official HOA votes, such as board elections, assessment increases or CC&R
            changes, need the association's secret-ballot process (Civil Code §5115).
          </p>
        </div>
      )}
      {profile.role === 'admin' && (
        <label className="check">
          <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />
          <span>Pin to the top of the board</span>
        </label>
      )}
      {err && <div className="notice bad">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Posting…' : 'Post'}</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
