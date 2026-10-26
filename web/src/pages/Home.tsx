import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { urgency } from '@shared/deadlines.ts'
import { Icon } from '../components/Icon'
import { RequestItem } from '../components/RequestBits'
import { useProfile } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { supabase, type Incident, type RequestRow } from '../lib/supabase'

const QUICK = [
  { type: 'records_current', label: 'Request records', icon: 'file' },
  { type: 'maintenance', label: 'Report a problem', icon: 'wrench' },
  { type: 'meet_confer', label: 'Meet & confer', icon: 'users' },
  { type: 'architectural', label: 'Flooring / remodel approval', icon: 'home' },
]

export function Home() {
  const profile = useProfile()
  const [requests, setRequests] = useState<RequestRow[] | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])

  useEffect(() => {
    supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => setRequests((data as RequestRow[]) ?? []))
    supabase
      .from('incidents')
      .select('*')
      .order('reported_on', { ascending: false, nullsFirst: false })
      .limit(5)
      .then(({ data }) => setIncidents((data as Incident[]) ?? []))
  }, [])

  const all = requests ?? []
  const sent = all.filter((r) => r.status !== 'draft')
  const open = sent.filter((r) => ['sent', 'received', 'acknowledged'].includes(r.status))
  const overdue = open.filter((r) => urgency(r.status, r.due_date) === 'overdue')
  const answered = sent.filter((r) => r.status === 'answered')
  const deemed = sent.filter((r) => r.status.startsWith('deemed'))
  const mine = all.filter((r) => r.unit_id === profile.unit_id && !['closed', 'withdrawn'].includes(r.status)).slice(0, 6)
  const upcoming = open
    .filter((r) => r.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    .slice(0, 6)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi, {profile.display_name.split(' ')[0]}</h1>
          <p>File requests with the Board, track their legal deadlines, and see everything owners have asked for and received.</p>
        </div>
        <Link to="/requests/new" className="btn primary">
          <Icon name="plus" /> New request
        </Link>
      </div>

      <div className="grid grid-4 mb">
        <div className="card stat">
          <div className="n">{open.length}</div>
          <div className="l">Open requests</div>
        </div>
        <div className={`card stat ${overdue.length ? 'bad' : ''}`}>
          <div className="n">{overdue.length}</div>
          <div className="l">Overdue (HOA past deadline)</div>
        </div>
        <div className="card stat ok">
          <div className="n">{answered.length}</div>
          <div className="l">Answered</div>
        </div>
        <div className="card stat warn">
          <div className="n">{deemed.length}</div>
          <div className="l">Deemed denied / approved</div>
        </div>
      </div>

      <div className="card mb">
        <h3>Start something</h3>
        <div className="grid grid-4">
          {QUICK.map((q) => (
            <Link key={q.type} to={`/requests/new?type=${q.type}`} className="btn" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }}>
              <Icon name={q.icon} /> {q.label}
            </Link>
          ))}
        </div>
        <p className="muted mt" style={{ marginBottom: 0, fontSize: '0.88rem' }}>
          Not sure which to use? <Link to="/assistant">Ask the assistant</Link> — describe the problem and it will point you to the right request and the CC&R sections.
        </p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row between">
            <h3>Deadlines coming up</h3>
            <Link to="/requests" style={{ fontSize: '0.88rem' }}>
              All requests
            </Link>
          </div>
          {requests === null ? (
            <p className="muted">Loading…</p>
          ) : upcoming.length ? (
            <div className="item-list">
              {upcoming.map((r) => (
                <RequestItem key={r.id} r={r} />
              ))}
            </div>
          ) : (
            <p className="muted">No open deadlines right now.</p>
          )}
        </div>
        <div className="card">
          <h3>Your unit's requests</h3>
          {mine.length ? (
            <div className="item-list">
              {mine.map((r) => (
                <RequestItem key={r.id} r={r} />
              ))}
            </div>
          ) : (
            <p className="muted">
              Nothing yet. <Link to="/requests/new">Start a request</Link>.
            </p>
          )}
        </div>
      </div>

      <div className="card mt">
        <div className="row between">
          <h3>Recent maintenance log entries</h3>
          <Link to="/incidents" style={{ fontSize: '0.88rem' }}>
            Open the log
          </Link>
        </div>
        {incidents.length ? (
          <div className="item-list">
            {incidents.map((i) => (
              <Link key={i.id} to={`/incidents#${i.id}`} className="item">
                <div style={{ flex: 1 }}>
                  <div className="t">{i.title}</div>
                  <div className="s">
                    {i.location ?? (i.location_type === 'common' ? 'Common area' : 'Unit')} · {fmtDate(i.reported_on ?? i.occurred_on)}
                  </div>
                </div>
                <span className={`badge ${i.diagnosed ? 'ok' : 'warn'}`}>{i.diagnosed ? 'Diagnosed' : 'Not diagnosed'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">No entries yet.</p>
        )}
      </div>
    </>
  )
}
