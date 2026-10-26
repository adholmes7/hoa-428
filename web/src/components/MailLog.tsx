import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { requestType } from '@shared/deadlines.ts'
import { fmtDate } from '../lib/format'
import { errMsg, supabase } from '../lib/supabase'

type Letter = {
  id: string
  ref_no: number
  unit_id: number
  type: string
  title: string
  visibility: string
  sent_date: string | null
  status: string
  tracking_status: string | null
  mail_cost_estimate: number | null
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Admin view of letters mailed through Lob, including private requests (titles hidden). */
export function MailLog() {
  const [letters, setLetters] = useState<Letter[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.functions
      .invoke('send-letter', { body: { admin_log: true } })
      .then(({ data, error }) => {
        if (error) setError(errMsg(error))
        setLetters((data?.letters as Letter[]) ?? [])
      })
  }, [])

  const month = new Date().toISOString().slice(0, 7)
  const thisMonth = (letters ?? []).filter((l) => l.sent_date?.startsWith(month))
  const sum = (ls: Letter[]) => ls.reduce((n, l) => n + Number(l.mail_cost_estimate ?? 0), 0)

  return (
    <div className="card">
      <h2>Letters mailed by the site</h2>
      <p className="ink2" style={{ fontSize: '0.92rem' }}>
        Every letter sent through Lob, with estimated postage. Check the{' '}
        <a href="https://dashboard.lob.com" target="_blank" rel="noreferrer">Lob dashboard</a> for actual charges.
      </p>
      {error && <div className="notice bad mb">{error}</div>}
      {letters === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-3 mb">
            <div className="card stat"><div className="n">{thisMonth.length}</div><div className="l">Letters this month</div></div>
            <div className="card stat"><div className="n">{usd(sum(thisMonth))}</div><div className="l">Estimated, this month</div></div>
            <div className="card stat"><div className="n">{usd(sum(letters))}</div><div className="l">Estimated, all time</div></div>
          </div>
          {letters.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>No letters mailed yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr><th>Request</th><th>Unit</th><th>Mailed</th><th>USPS status</th><th style={{ textAlign: 'right' }}>Est. cost</th></tr>
                </thead>
                <tbody>
                  {letters.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.visibility === 'private' ? (
                          <span>#{l.ref_no} · {requestType(l.type)?.short ?? l.type} <span className="muted">(private)</span></span>
                        ) : (
                          <Link to={`/requests/${l.id}`}>#{l.ref_no} · {l.title}</Link>
                        )}
                      </td>
                      <td>{l.unit_id}</td>
                      <td>{fmtDate(l.sent_date)}</td>
                      <td>{l.tracking_status ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{l.mail_cost_estimate != null ? usd(Number(l.mail_cost_estimate)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
