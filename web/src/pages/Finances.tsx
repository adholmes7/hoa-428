import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'

type Fact = { id: number; metric: string; label: string; period: string; value: number; unit: string; source: string | null; verified: boolean; sort: number }

const SECTIONS: { metric: string; title: string; note?: string; highlight?: (f: Fact) => string }[] = [
  {
    metric: 'reserve_contribution',
    title: 'Monthly reserve contribution: actual vs. reserve study',
    note: 'The 2026 budget funds reserves below the reserve study’s 5% threshold plan, the minimum to avoid dropping under 5% funded.',
    highlight: (f) => (f.label.startsWith('Actual') ? 'accent' : ''),
  },
  {
    metric: 'percent_funded',
    title: 'Projected percent funded (reserve study)',
    note: 'Under 30% is “poorly funded,” 30–70% “fair,” over 70% “well funded” (McCaffery scale).',
    highlight: (f) => (f.value < 50 ? 'accent' : ''),
  },
  { metric: 'premium', title: 'Master insurance premium (State Farm)', note: 'The premium increase drove the 5% dues increase for 2026.' },
  { metric: 'dues', title: '2026 monthly dues by unit type', note: 'Effective February 1, 2026.' },
  {
    metric: 'remaining_life',
    title: 'Roof components: remaining life (years, as of Dec 31, 2024)',
    note: 'Flat roofing showed 1 year of life left at the end of 2024, so it was due for replacement in 2025. Plumbing is not a reserve component (“Included in Operating Budget”).',
    highlight: (f) => (f.value <= 5 ? 'accent' : ''),
  },
]

function fmt(f: Fact) {
  if (f.unit === 'usd') return money(f.value)
  if (f.unit === 'pct') return `${f.value}%`
  if (f.unit === 'years') return `${f.value} yr`
  return f.value.toLocaleString()
}

export default function Finances() {
  const [facts, setFacts] = useState<Fact[] | null>(null)
  useEffect(() => {
    supabase
      .from('finance_facts')
      .select('*')
      .order('sort')
      .then(({ data }) => setFacts((data as Fact[]) ?? []))
  }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Finances</h1>
          <p>
            Figures from the 2026 budget packet and the January 2024 reserve study. Budget-vs-actual needs the financial statements;{' '}
            <Link to="/requests/new?type=records_current">request them</Link>. For the full line-by-line budget, see the <Link to="/budget">budget walkthrough</Link>.
          </p>
        </div>
      </div>
      {facts === null ? (
        <p className="muted">Loading…</p>
      ) : facts.length === 0 ? (
        <div className="card empty"><h3>No figures loaded yet</h3></div>
      ) : (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          {SECTIONS.map((s) => {
            const rows = facts.filter((f) => f.metric === s.metric)
            if (!rows.length) return null
            const max = Math.max(...rows.map((r) => r.value)) || 1
            return (
              <div className="card" key={s.metric}>
                <h3>{s.title}</h3>
                <div className="bars">
                  {rows.map((r) => (
                    <div className="bar-row" key={r.id}>
                      <span>
                        {r.label}
                        {!r.verified && <span className="badge warn" style={{ marginLeft: 6 }}>verify</span>}
                      </span>
                      <span className="v">{fmt(r)}</span>
                      <div className="bar-track">
                        <div className={`bar-fill ${s.highlight?.(r) ?? ''}`} style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {s.note && <p className="muted mt" style={{ fontSize: '0.85rem', marginBottom: 4 }}>{s.note}</p>}
                <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>Source: {[...new Set(rows.map((r) => r.source).filter(Boolean))].join('; ')}</p>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
