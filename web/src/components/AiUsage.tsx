import { useEffect, useMemo, useState } from 'react'
import { fmtDate } from '../lib/format'
import { supabase, type Profile } from '../lib/supabase'

type Row = {
  user_id: string
  day: string
  count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

// Claude Haiku 5.5 list prices per million tokens (cache writes 1.25x input, cache reads 0.1x input).
// An estimate only; the Anthropic Console's billing page is the source of truth.
const PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }

function cost(r: Pick<Row, 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>) {
  return (
    (r.input_tokens * PRICE.input +
      r.output_tokens * PRICE.output +
      r.cache_write_tokens * PRICE.cacheWrite +
      r.cache_read_tokens * PRICE.cacheRead) /
    1_000_000
  )
}

const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }))
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d)

/** Admin view of assistant usage: questions per day and estimated cost, by owner. Question text is never stored. */
export function AiUsage({ members }: { members: Profile[] }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const since = isoDay(new Date(Date.now() - 29 * 86400000))
    supabase
      .from('ai_usage')
      .select('*')
      .gte('day', since)
      .order('day')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        setRows((data as Row[]) ?? [])
      })
  }, [])

  const view = useMemo(() => {
    const all = rows ?? []
    const today = isoDay(new Date())
    const days = Array.from({ length: 14 }, (_, i) => isoDay(new Date(Date.now() - (13 - i) * 86400000)))
    const perDay = days.map((d) => {
      const r = all.filter((x) => x.day === d)
      return { day: d, questions: r.reduce((n, x) => n + x.count, 0), cost: r.reduce((n, x) => n + cost(x), 0) }
    })
    const byOwner = new Map<string, Row>()
    for (const r of all) {
      const t = byOwner.get(r.user_id) ?? { ...r, count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }
      t.count += r.count
      t.input_tokens += r.input_tokens
      t.output_tokens += r.output_tokens
      t.cache_read_tokens += r.cache_read_tokens
      t.cache_write_tokens += r.cache_write_tokens
      byOwner.set(r.user_id, t)
    }
    const owners = [...byOwner.values()].sort((a, b) => b.count - a.count)
    return {
      today: all.filter((r) => r.day === today).reduce((n, r) => n + r.count, 0),
      total: all.reduce((n, r) => n + r.count, 0),
      totalCost: all.reduce((n, r) => n + cost(r), 0),
      perDay,
      owners,
    }
  }, [rows])

  const name = (id: string) => {
    const m = members.find((x) => x.id === id)
    return m ? `${m.display_name} · Unit ${m.unit_id}` : 'Former member'
  }
  const maxDay = Math.max(1, ...view.perDay.map((d) => d.questions))

  return (
    <div className="card">
      <h2>AI assistant usage</h2>
      <p className="ink2" style={{ fontSize: '0.92rem' }}>
        Question counts and token totals only; the text of questions is never stored. Cost is an estimate at Claude Haiku 5.5 rates. Check{' '}
        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">Anthropic Console billing</a> for the actual charge.
      </p>
      {error && <div className="notice bad mb">{error}</div>}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-3 mb">
            <div className="card stat"><div className="n">{view.today}</div><div className="l">Questions today</div></div>
            <div className="card stat"><div className="n">{view.total}</div><div className="l">Questions, last 30 days</div></div>
            <div className="card stat"><div className="n">{usd(view.totalCost)}</div><div className="l">Estimated cost, last 30 days</div></div>
          </div>

          <h3>Questions per day (last 14 days)</h3>
          <div className="mini-bars">
            {view.perDay.map((d) => (
              <div className="mini-bar" key={d.day} title={`${d.questions} questions · ${usd(d.cost)}`}>
                <span>{fmtDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <div className="track">
                  <div className="fill hl" style={{ width: `${(d.questions / maxDay) * 100}%` }} />
                </div>
                <span className="v">{d.questions}</span>
              </div>
            ))}
          </div>

          <h3 className="mt">By owner (last 30 days)</h3>
          {view.owners.length === 0 ? (
            <p className="muted">No questions yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th style={{ textAlign: 'right' }}>Questions</th>
                    <th style={{ textAlign: 'right' }}>Tokens in / out</th>
                    <th style={{ textAlign: 'right' }}>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {view.owners.map((o) => (
                    <tr key={o.user_id}>
                      <td>{name(o.user_id)}</td>
                      <td style={{ textAlign: 'right' }}>{o.count}</td>
                      <td style={{ textAlign: 'right' }}>
                        {(o.input_tokens + o.cache_read_tokens + o.cache_write_tokens).toLocaleString()} / {o.output_tokens.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right' }}>{usd(cost(o))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
            Days are Pacific time. Usage before token tracking began shows questions but no cost.
          </p>
        </>
      )}
    </div>
  )
}
