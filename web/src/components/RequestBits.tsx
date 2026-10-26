import { Link } from 'react-router-dom'
import { requestType, urgency } from '@shared/deadlines.ts'
import { dueText, fmtDate, statusLabel, urgencyClass } from '../lib/format'
import type { RequestRow } from '../lib/supabase'

export function StatusBadge({ r }: { r: Pick<RequestRow, 'status' | 'due_date'> }) {
  const u = urgency(r.status, r.due_date)
  const cls =
    r.status === 'deemed_approved' || r.status === 'answered'
      ? 'ok'
      : r.status === 'deemed_denied'
        ? 'bad'
        : r.status === 'draft'
          ? ''
          : urgencyClass(u)
  return <span className={`badge ${cls}`}>{statusLabel(r.status, r.due_date)}</span>
}

export function RequestItem({ r }: { r: RequestRow }) {
  const t = requestType(r.type)
  const due = dueText(r.status, r.due_date)
  return (
    <Link to={`/requests/${r.id}`} className="item">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t">
          #{r.ref_no} · {r.title}
        </div>
        <div className="s">
          {t?.short ?? r.type} · Unit {r.unit_id}
          {r.sent_date ? ` · Sent ${fmtDate(r.sent_date)}` : ''}
          {r.visibility === 'private' ? ' · Private' : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <StatusBadge r={r} />
        {due && r.status !== 'draft' && (
          <div className="s" style={{ marginTop: 4 }}>
            {due}
          </div>
        )}
      </div>
    </Link>
  )
}
