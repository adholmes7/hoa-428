import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { REQUEST_TYPES, urgency } from '@shared/deadlines.ts'
import { Icon } from '../components/Icon'
import { RequestItem } from '../components/RequestBits'
import { useProfile } from '../lib/auth'
import { supabase, type RequestRow } from '../lib/supabase'

type Filter = 'open' | 'overdue' | 'mine' | 'done' | 'drafts' | 'all'

export default function Requests() {
  const profile = useProfile()
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [type, setType] = useState('')

  useEffect(() => {
    supabase
      .from('requests')
      .select('*')
      .order('ref_no', { ascending: false })
      .then(({ data }) => setRows((data as RequestRow[]) ?? []))
  }, [])

  const list = useMemo(() => {
    const all = (rows ?? []).filter((r) => !type || r.type === type)
    const isOpen = (r: RequestRow) => ['sent', 'received', 'acknowledged'].includes(r.status)
    switch (filter) {
      case 'open':
        return all.filter(isOpen)
      case 'overdue':
        return all.filter((r) => urgency(r.status, r.due_date) === 'overdue')
      case 'mine':
        return all.filter((r) => r.unit_id === profile.unit_id)
      case 'done':
        return all.filter((r) => !isOpen(r) && r.status !== 'draft')
      case 'drafts':
        return all.filter((r) => r.status === 'draft')
      default:
        return all
    }
  }, [rows, filter, type, profile.unit_id])

  const count = (f: Filter) => {
    if (!rows) return 0
    const all = rows.filter((r) => !type || r.type === type)
    const isOpen = (r: RequestRow) => ['sent', 'received', 'acknowledged'].includes(r.status)
    return {
      open: all.filter(isOpen).length,
      overdue: all.filter((r) => urgency(r.status, r.due_date) === 'overdue').length,
      mine: all.filter((r) => r.unit_id === profile.unit_id).length,
      done: all.filter((r) => !isOpen(r) && r.status !== 'draft').length,
      drafts: all.filter((r) => r.status === 'draft').length,
      all: all.length,
    }[f]
  }

  const tabs: [Filter, string][] = [
    ['open', 'Open'],
    ['overdue', 'Overdue'],
    ['mine', 'My unit'],
    ['done', 'Resolved'],
    ['drafts', 'My drafts'],
    ['all', 'All'],
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Requests to the Board</h1>
          <p>
            Every request owners have sent, with the date the HOA received it and the deadline it has to meet. Drafts and
            requests marked private are only visible to your unit.
          </p>
        </div>
        <Link to="/requests/new" className="btn primary">
          <Icon name="plus" /> New request
        </Link>
      </div>
      <div className="tabs">
        {tabs.map(([f, label]) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {label} <span className="muted">({count(f)})</span>
          </button>
        ))}
      </div>
      <div className="row mb">
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">All request types</option>
          {REQUEST_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        {rows === null ? (
          <p className="muted">Loading…</p>
        ) : list.length ? (
          <div className="item-list">
            {list.map((r) => (
              <RequestItem key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>Nothing here</h3>
            <p>
              <Link to="/requests/new">Start a request</Link>
            </p>
          </div>
        )}
      </div>
    </>
  )
}
