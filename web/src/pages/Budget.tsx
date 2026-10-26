import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'

type Line = { id: number; account: string | null; name: string; category: string; annual: number; sort: number }
type Proj = {
  year: number
  annual_expenses: number
  fully_funded: number
  current_contribution: number
  current_balance: number
  current_pct: number
  recommended_contribution: number
  recommended_balance: number
  recommended_pct: number
  threshold_contribution: number
  threshold_balance: number
  threshold_pct: number
}

// Fixed categorical order (by 2026 size); color follows the category everywhere on the page.
const CATS: { id: string; label: string; color: string; blurb: string }[] = [
  { id: 'insurance', label: 'Insurance & taxes', color: 'var(--viz-1)', blurb: 'Building (State Farm) and earthquake insurance, plus small tax and license fees.' },
  { id: 'utilities', label: 'Utilities', color: 'var(--viz-2)', blurb: 'Common water, sewer, gas, electricity, trash, phone/internet and fire service.' },
  { id: 'admin', label: 'Administration', color: 'var(--viz-3)', blurb: 'Management company fee, accounting, legal, office costs and bank charges.' },
  { id: 'maintenance', label: 'Maintenance & repair', color: 'var(--viz-4)', blurb: 'Cleaning, landscaping, plumbing, electrical, roof, gates and fire equipment.' },
  { id: 'reserves', label: 'Transfer to reserves', color: 'var(--viz-5)', blurb: 'Savings for big future repairs (roof, painting, water heaters) in the reserve fund.' },
  { id: 'other', label: 'Gifts & hospitality', color: 'var(--viz-6)', blurb: 'Holiday gifts and hospitality.' },
]
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]))

type UnitType = { id: string; label: string; count: number; dues: number }
type Fact = { metric: string; label: string; period: string; value: number }

// Dues rows are labeled like "1 bedroom (12 units)" in finance_facts
function unitTypes(facts: Fact[]): UnitType[] {
  return facts
    .filter((f) => f.metric === 'dues')
    .map((f) => {
      const m = f.label.match(/^(\d) bedroom \((\d+) units\)/)
      return { id: m?.[1] ?? f.label, label: `${m?.[1] ?? '?'} bedroom`, count: Number(m?.[2] ?? 0), dues: Number(f.value) }
    })
}

// Reserve study plans: the first three categorical slots (validated all-pairs safe)
const PLANS = [
  { id: 'current', label: 'Current plan (what the HOA funds)', short: 'Current', color: 'var(--viz-1)' },
  { id: 'threshold', label: '5% threshold plan (minimum)', short: '5% threshold', color: 'var(--viz-2)' },
  { id: 'recommended', label: 'Recommended plan', short: 'Recommended', color: 'var(--viz-3)' },
] as const

const fmt0 = (n: number) => money(n)
const fmt2 = (n: number) => money(n, 2)
const kfmt = (n: number) => (Math.abs(n) >= 1000 ? `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n) / 1000)}k` : fmt0(n))

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

type Tip = { x: number; y: number; content: ReactNode } | null

function TipBox({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null
  const left = Math.min(Math.max(tip.x + 14, 0), Math.max(0, width - 240))
  return (
    <div className="viz-tip" style={{ left, top: tip.y + 14 }}>
      {tip.content}
    </div>
  )
}

function Step({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section className="walk-step" id={id}>
      <div className="card">
        <div className="kicker">Step {n}</div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sankey: income sources → operating budget → spending categories
// ---------------------------------------------------------------------------

function Sankey({ lines, onPick, picked }: { lines: Line[]; onPick: (cat: string) => void; picked: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const income = lines.filter((l) => l.category === 'income').sort((a, b) => b.annual - a.annual)
  const cats = CATS.map((c) => ({ ...c, value: lines.filter((l) => l.category === c.id).reduce((s, l) => s + l.annual, 0) })).filter((c) => c.value > 0)
  const total = income.reduce((s, l) => s + l.annual, 0)
  if (!w || !total) return <div ref={ref} className="viz" style={{ minHeight: 200 }} />

  const narrow = w < 560
  const H = narrow ? 380 : 400
  const gap = 8
  const nodeW = 12
  const leftLabel = narrow ? 74 : 150
  const rightLabel = narrow ? 118 : 210
  const x0 = leftLabel
  const x1 = Math.round((w - rightLabel - nodeW) / 2)
  const x2 = w - rightLabel - nodeW
  const minH = 3
  const scale = (H - gap * (cats.length - 1)) / total

  // left nodes
  let y = 0
  const left = income.map((l) => {
    const h = Math.max(minH, l.annual * scale)
    const n = { key: l.name, label: l.name.replace(/^Vending - /, ''), value: l.annual, y, h }
    y += h + gap
    return n
  })
  const leftSpan = y - gap
  const leftOff = (H - leftSpan) / 2
  left.forEach((n) => (n.y += leftOff))

  // right nodes
  y = 0
  const right = cats.map((c) => {
    const h = Math.max(minH, c.value * scale)
    const n = { ...c, y, h }
    y += h + gap
    return n
  })

  const midH = total * scale
  const midY = (H - midH) / 2

  const band = (xa: number, ya0: number, ya1: number, xb: number, yb0: number, yb1: number) => {
    const cx = (xa + xb) / 2
    return `M${xa},${ya0} C${cx},${ya0} ${cx},${yb0} ${xb},${yb0} L${xb},${yb1} C${cx},${yb1} ${cx},${ya1} ${xa},${ya1} Z`
  }

  let inOff = midY
  const inLinks = left.map((n) => {
    const h = n.value * scale
    const d = band(x0 + nodeW, n.y, n.y + Math.max(h, 1), x1, inOff, inOff + h)
    inOff += h
    return { key: n.key, d, n }
  })
  let outOff = midY
  const outLinks = right.map((n) => {
    const h = n.value * scale
    const d = band(x1 + nodeW, outOff, outOff + h, x2, n.y, n.y + h)
    outOff += h
    return { key: n.id, d, n }
  })

  const show = (e: React.PointerEvent, content: ReactNode) => {
    const r = ref.current!.getBoundingClientRect()
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content })
  }

  return (
    <div ref={ref} className="viz" onPointerLeave={() => { setTip(null); setHover(null) }}>
      <svg viewBox={`0 0 ${w} ${H + 4}`} role="img" aria-label="Flow of the 2026 operating budget from income sources to spending categories">
        {inLinks.map(({ key, d, n }) => (
          <path key={key} d={d} fill="var(--viz-neutral)" opacity={hover && hover !== key ? 0.18 : 0.42}
            onPointerMove={(e) => { setHover(key); show(e, <><b>{n.key}</b><div>{fmt0(n.value)} a year · {((n.value / total) * 100).toFixed(1)}%</div></>) }} />
        ))}
        {outLinks.map(({ key, d, n }) => (
          <path key={key} d={d} fill={n.color} opacity={hover && hover !== key ? 0.2 : picked === key ? 0.75 : 0.55}
            style={{ cursor: 'pointer' }} onClick={() => onPick(key)}
            onPointerMove={(e) => { setHover(key); show(e, <><b>{n.label}</b><div>{fmt0(n.value)} a year</div><div>{fmt0(n.value / 12)} a month · {((n.value / total) * 100).toFixed(1)}%</div><div className="muted" style={{ fontSize: '0.76rem' }}>Click for line items</div></>) }} />
        ))}
        {left.map((n) => (
          <g key={n.key}>
            <rect x={x0} y={n.y} width={nodeW} height={n.h} rx={2} fill="var(--viz-zero)" />
            <text x={x0 - 6} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle" fontSize={narrow ? 11 : 12.5}>
              <tspan className="t-strong">{n.label}</tspan>
              {!narrow && <tspan className="t-muted"> {kfmt(n.value)}</tspan>}
            </text>
          </g>
        ))}
        <rect x={x1} y={midY} width={nodeW} height={midH} rx={2} fill="var(--ink)" opacity={0.75} />
        <text x={x1 + nodeW / 2} y={midY - 8} textAnchor="middle" fontSize={narrow ? 11 : 12.5} className="t-strong">{fmt0(total)}</text>
        {right.map((n) => (
          <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => onPick(n.id)}>
            <rect x={x2} y={n.y} width={nodeW} height={n.h} rx={2} fill={n.color} />
            <text x={x2 + nodeW + 6} y={n.y + n.h / 2 - (n.h > 22 ? 7 : 0)} dominantBaseline="middle" fontSize={narrow ? 11 : 12.5} className="t-strong">
              {n.label}
            </text>
            {n.h > 22 ? (
              <text x={x2 + nodeW + 6} y={n.y + n.h / 2 + 8} dominantBaseline="middle" fontSize={narrow ? 10.5 : 12} className="t-muted">
                {fmt0(n.value)} · {Math.round((n.value / total) * 100)}%
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <TipBox tip={tip} width={w} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reserve projection line chart
// ---------------------------------------------------------------------------

function ReserveChart({ rows }: { rows: Proj[] }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [on, setOn] = useState<Record<string, boolean>>({ current: true, threshold: true, recommended: true })
  const [hi, setHi] = useState<number | null>(null)
  if (!rows.length) return null

  const H = 320
  const m = { l: 52, r: 14, t: 16, b: 30 }
  const iw = Math.max(0, w - m.l - m.r)
  const ih = H - m.t - m.b
  const years = rows.map((r) => r.year)
  const minY = Math.min(0, ...rows.flatMap((r) => [r.current_balance, r.threshold_balance, r.recommended_balance]))
  const maxY = Math.max(...rows.flatMap((r) => [r.current_balance, r.threshold_balance, r.recommended_balance]))
  const lo = Math.floor(minY / 50000) * 50000
  const hiY = Math.ceil(maxY / 50000) * 50000
  const sx = (yr: number) => m.l + ((yr - years[0]) / (years[years.length - 1] - years[0])) * iw
  const sy = (v: number) => m.t + ((hiY - v) / (hiY - lo)) * ih
  const ticks: number[] = []
  for (let v = lo; v <= hiY; v += 50000) ticks.push(v)
  const xticks = years.filter((y) => y % 5 === 0)
  const bigYears = rows.filter((r) => r.annual_expenses >= 50000)
  const path = (key: 'current' | 'threshold' | 'recommended') =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${sx(r.year).toFixed(1)},${sy(r[`${key}_balance`]).toFixed(1)}`).join(' ')
  const hov = hi != null ? rows.find((r) => r.year === hi) : null

  function move(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const yr = Math.round(years[0] + ((x - m.l) / iw) * (years[years.length - 1] - years[0]))
    setHi(Math.min(Math.max(yr, years[0]), years[years.length - 1]))
  }

  return (
    <>
      <div className="legend">
        {PLANS.map((p) => (
          <button key={p.id} className={on[p.id] ? '' : 'off'} onClick={() => setOn({ ...on, [p.id]: !on[p.id] })} aria-pressed={on[p.id]}>
            <span className="swatch" style={{ background: p.color, height: 3, width: 16 }} /> {p.label}
          </button>
        ))}
      </div>
      <div ref={ref} className="viz" onPointerMove={move} onPointerLeave={() => setHi(null)}>
        {w > 0 && (
          <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Projected reserve fund balance 2024 to 2054 under three funding plans">
            <rect x={m.l} y={sy(0)} width={iw} height={sy(lo) - sy(0)} fill="var(--viz-grid)" opacity={0.7} />
            {ticks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? 'var(--viz-zero)' : 'var(--viz-grid)'} strokeWidth={v === 0 ? 1.5 : 1} />
                <text x={m.l - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} className="t-muted">{kfmt(v)}</text>
              </g>
            ))}
            <text x={m.l + 8} y={sy(lo) - 8} fontSize={11} className="t-muted">Below $0: the fund can’t pay for scheduled repairs</text>
            {xticks.map((yr) => (
              <text key={yr} x={sx(yr)} y={H - 8} textAnchor="middle" fontSize={11} className="t-muted">{yr}</text>
            ))}
            {bigYears.map((r, i) => (
              <g key={r.year}>
                <line x1={sx(r.year)} x2={sx(r.year)} y1={m.t} y2={m.t + ih} stroke="var(--viz-axis)" strokeDasharray="3 3" />
                {/* Stagger labels so neighboring repair years don't collide */}
                <text x={sx(r.year) + 4} y={m.t + 10 + (i % 2) * 13} fontSize={10.5} className="t-muted">{kfmt(r.annual_expenses)}</text>
              </g>
            ))}
            {PLANS.filter((p) => on[p.id]).map((p) => (
              <path key={p.id} d={path(p.id)} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" />
            ))}
            {hov && (
              <g>
                <line x1={sx(hov.year)} x2={sx(hov.year)} y1={m.t} y2={m.t + ih} stroke="var(--ink-3)" strokeWidth={1} />
                {PLANS.filter((p) => on[p.id]).map((p) => (
                  <circle key={p.id} cx={sx(hov.year)} cy={sy(hov[`${p.id}_balance`])} r={4.5} fill={p.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hov && (
          <TipBox
            width={w}
            tip={{
              x: sx(hov.year),
              y: 20,
              content: (
                <>
                  <b>{hov.year}</b>
                  {PLANS.filter((p) => on[p.id]).map((p) => (
                    <div key={p.id} className="row">
                      <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: p.color }} />{p.short}</span>
                      <b>{fmt0(hov[`${p.id}_balance`])}</b>
                    </div>
                  ))}
                  <div className="muted" style={{ marginTop: 4 }}>Scheduled repairs: {fmt0(hov.annual_expenses)}</div>
                  <div className="muted">Fully funded target: {fmt0(hov.fully_funded)}</div>
                </>
              ),
            }}
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function MiniBars({ rows, format = fmt0 }: { rows: { label: string; value: number; hl?: boolean; note?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value))
  return (
    <div className="mini-bars">
      {rows.map((r) => (
        <div className="mini-bar" key={r.label} title={r.note}>
          <span>{r.label}</span>
          <div className="track"><div className={`fill ${r.hl ? 'hl' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="v">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Budget() {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [proj, setProj] = useState<Proj[]>([])
  const [facts, setFacts] = useState<Fact[]>([])
  const [unitType, setUnitType] = useState('1')
  const [cat, setCat] = useState('insurance')
  const [tables, setTables] = useState<Record<string, boolean>>({})
  const itemsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('budget_lines').select('*').eq('year', 2026).order('sort').then(({ data }) => setLines((data as Line[]) ?? []))
    supabase.from('reserve_projection').select('*').order('year').then(({ data }) => setProj((data as Proj[]) ?? []))
    supabase.from('finance_facts').select('metric, label, period, value').order('sort').then(({ data }) => setFacts((data as Fact[]) ?? []))
  }, [])

  const totals = useMemo(() => {
    const by: Record<string, number> = {}
    for (const l of lines ?? []) by[l.category] = (by[l.category] ?? 0) + Number(l.annual)
    return by
  }, [lines])

  if (lines === null) return <div className="empty">Loading…</div>
  if (!lines.length)
    return (
      <div className="card empty">
        <h3>The budget hasn't been loaded yet</h3>
        <p>An admin needs to run the seed script (see the README).</p>
      </div>
    )

  const expense = CATS.reduce((s, c) => s + (totals[c.id] ?? 0), 0)
  const income = totals.income ?? 0
  const UNIT_TYPES = unitTypes(facts)
  const ut = UNIT_TYPES.find((u) => u.id === unitType) ?? UNIT_TYPES[0] ?? { id: '1', label: '1 bedroom', count: 0, dues: 0 }
  const fact = (metric: string, period: string) => Number(facts.find((f) => f.metric === metric && f.period === period)?.value ?? 0)
  const premiumOld = fact('premium', '2020')
  const premiumNow = fact('premium', '2025')
  const plan = (label: string) => Number(facts.find((f) => f.metric === 'reserve_contribution' && f.label.startsWith(label))?.value ?? 0) * 12
  const proj2026 = proj.find((p) => p.year === 2026)
  const proj2029 = proj.find((p) => p.year === 2029)
  const flatRoof = facts.find((f) => f.metric === 'remaining_life' && f.label.startsWith('Flat roofing'))
  const toggle = (k: string) => setTables((t) => ({ ...t, [k]: !t[k] }))
  const pick = (c: string) => {
    setCat(c)
    itemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const catLines = lines.filter((l) => l.category === cat).sort((a, b) => b.annual - a.annual)
  const catMax = Math.max(...catLines.map((l) => l.annual))
  const insurancePremiumBudget = lines.find((l) => l.account === '83100')?.annual ?? 0
  const negYears = proj.filter((p) => p.current_balance < 0)
  const firstNeg = negYears[0]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budget walkthrough</h1>
          <p>
            The 2026 operating budget, step by step: where the money comes from, where it goes, what changed, and where the reserve fund is
            headed. Figures come from the budget packet LBPM mailed in December 2025 and the January 2024 reserve study.
          </p>
        </div>
      </div>

      <nav className="walk-nav" aria-label="Walkthrough steps">
        <a href="#big-picture">1 · Big picture</a>
        <a href="#flow">2 · Flow of money</a>
        <a href="#your-dues">3 · Your dues</a>
        <a href="#line-items">4 · Line items</a>
        <a href="#changes">5 · What changed</a>
        <a href="#reserves">6 · Reserve outlook</a>
        <a href="#questions">7 · Questions</a>
      </nav>

      <Step id="big-picture" n={1} title="The big picture">
        <div className="grid grid-3">
          <div>
            <div className="hero-num">{fmt0(expense)}</div>
            <div className="muted">2026 operating budget ({fmt0(expense / 12)} a month)</div>
          </div>
          <div>
            <div className="hero-num">{Math.round(((totals.insurance ?? 0) / expense) * 100)}%<small>to insurance</small></div>
            <div className="muted">The largest share by far</div>
          </div>
          <div>
            <div className="hero-num">{Math.round(((totals.reserves ?? 0) / expense) * 100)}%<small>to savings</small></div>
            <div className="muted">Transferred to the reserve fund</div>
          </div>
        </div>
        <p className="lede mt" style={{ marginBottom: 0 }}>
          The budget balances exactly: {fmt0(income)} of expected income against {fmt0(expense)} of spending. Almost all income is dues from the
          22 units. The Association has two pots of money: the <b>operating fund</b> pays the bills every month, and the <b>reserve fund</b>{' '}
          saves for big repairs. Part of every dues payment goes from one to the other.
        </p>
      </Step>

      <Step id="flow" n={2} title="Where the money comes from, and where it goes">
        <p className="lede">Band widths are to scale. Hover or tap a band for the amount; tap a category to see its line items.</p>
        <Sankey lines={lines} onPick={pick} picked={cat} />
        <button className="btn sm ghost table-toggle" onClick={() => toggle('flow')}>{tables.flow ? 'Hide' : 'Show'} as a table</button>
        {tables.flow && (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Per year</th><th style={{ textAlign: 'right' }}>Per month</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
              <tbody>
                {CATS.map((c) => (
                  <tr key={c.id}><td>{c.label}</td><td style={{ textAlign: 'right' }}>{fmt0(totals[c.id] ?? 0)}</td><td style={{ textAlign: 'right' }}>{fmt0((totals[c.id] ?? 0) / 12)}</td><td style={{ textAlign: 'right' }}>{(((totals[c.id] ?? 0) / expense) * 100).toFixed(1)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Step>

      <Step id="your-dues" n={3} title="Where your monthly dues go">
        <div className="chips mb">
          {UNIT_TYPES.map((u) => (
            <button key={u.id} className={unitType === u.id ? 'on' : ''} onClick={() => setUnitType(u.id)}>
              {u.label} · {fmt2(u.dues)}/mo
            </button>
          ))}
        </div>
        <p className="lede">
          A {ut.label.toLowerCase()} unit pays <b>{fmt2(ut.dues)}</b> a month in 2026 ({ut.count} units pay this). Split in the same proportions
          as the budget, it covers:
        </p>
        <div className="seg-bar" role="img" aria-label={`Split of ${fmt2(ut.dues)} monthly dues by category`}>
          {CATS.map((c) => {
            const v = (ut.dues * (totals[c.id] ?? 0)) / expense
            return <div key={c.id} style={{ flex: totals[c.id] ?? 0, background: c.color }} title={`${c.label}: ${fmt2(v)}`} />
          })}
        </div>
        <div className="alloc-list">
          {CATS.map((c) => (
            <div key={c.id}>
              <span className="swatch" style={{ background: c.color }} />
              <span>{c.label}</span>
              <b>{fmt2((ut.dues * (totals[c.id] ?? 0)) / expense)}</b>
            </div>
          ))}
        </div>
        <p className="muted mt" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          Dues are charged by unit size, not split evenly. Laundry and interest income cover the small remainder. Annually: {fmt0(ut.dues * 12)}.
        </p>
      </Step>

      <Step id="line-items" n={4} title="Every line item">
        <div ref={itemsRef} style={{ scrollMarginTop: 120 }} />
        <div className="chips">
          {CATS.map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
              <span className="swatch" style={{ background: c.color }} /> {c.label} · {kfmt(totals[c.id] ?? 0)}
            </button>
          ))}
        </div>
        <p className="lede mt" style={{ marginBottom: 0 }}>{CAT[cat].blurb}</p>
        <div className="line-items">
          {catLines.map((l) => (
            <div className="line-item" key={l.id}>
              <span>{l.name}</span>
              <span className="amt">{fmt0(l.annual)}</span>
              <div className="track"><div className="fill" style={{ width: `${(l.annual / catMax) * 100}%`, background: CAT[cat].color }} /></div>
              <span className="sub">
                {fmt0(l.annual / 12)}/month · {((l.annual / expense) * 100).toFixed(1)}% of budget · {fmt2(l.annual / 12 / 22)} per unit per month (average)
                {l.account ? ` · acct ${l.account}` : ''}
              </span>
            </div>
          ))}
        </div>
        <p className="muted mt" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          The budget spreads each line evenly across 12 months. Actual spending will differ; the monthly financial statements show it.
        </p>
      </Step>

      <Step id="changes" n={5} title="What changed">
        <div className="grid grid-2">
          <div className="change-card">
            <h3>Dues went up 5%</h3>
            <p className="ink2" style={{ fontSize: '0.9rem' }}>Effective February 1, 2026, because of the State Farm premium increase.</p>
            {UNIT_TYPES.map((u) => (
              <div className="from-to" key={u.id} style={{ marginBottom: 4 }}>
                <span style={{ minWidth: 86 }}>{u.label}</span>
                <span className="muted">≈{fmt2(u.dues / 1.05)}</span>
                <span className="arrow">→</span>
                <b>{fmt2(u.dues)}</b>
                <span className="delta">+{fmt2(u.dues - u.dues / 1.05)}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: '0.78rem', margin: '6px 0 0' }}>2025 amounts are worked back from the 5% increase, not from a 2025 document.</p>
          </div>
          <div className="change-card">
            <h3>The master policy premium more than doubled</h3>
            <div className="from-to">
              <span className="muted">2020–21</span><span className="big">{fmt0(premiumOld)}</span><span className="arrow">→</span>
              <span className="muted">2025–26</span><span className="big">{fmt0(premiumNow)}</span>
              {premiumOld > 0 && <span className="delta">+{Math.round((premiumNow / premiumOld - 1) * 100)}%</span>}
            </div>
            <p className="ink2" style={{ fontSize: '0.9rem', marginTop: 8 }}>
              The 2026 budget sets aside <b>{fmt0(insurancePremiumBudget)}</b> for building insurance, <b>{fmt0(premiumNow - insurancePremiumBudget)}</b> less
              than the current premium. The policy renews November 7, 2026. Earthquake insurance adds {fmt0(lines.find((l) => l.account === '83150')?.annual ?? 0)}.
            </p>
          </div>
          <div className="change-card">
            <h3>Reserve savings vs. what the study calls for</h3>
            <p className="ink2" style={{ fontSize: '0.9rem' }}>Yearly transfer to the reserve fund.</p>
            <MiniBars
              rows={[
                { label: 'Budgeted 2023', value: plan('Budgeted 2023') },
                { label: 'Budgeted 2026', value: totals.reserves ?? 0, hl: true },
                { label: '5% threshold (2024)', value: plan('5% threshold') },
                { label: 'Recommended (2024)', value: plan('Recommended') },
              ]}
            />
            <p className="muted" style={{ fontSize: '0.78rem', margin: '8px 0 0' }}>
              The study’s 2024 figures; its plans grow about 3% a year, so the 2026 equivalents are higher ({fmt0(proj2026?.threshold_contribution ?? 0)} and {fmt0(proj2026?.recommended_contribution ?? 0)}).
            </p>
          </div>
          <div className="change-card">
            <h3>Percent funded is projected to fall</h3>
            <p className="ink2" style={{ fontSize: '0.9rem' }}>Reserve balance as a share of the “fully funded” target, under current funding.</p>
            <MiniBars rows={proj.filter((p) => p.year >= 2024 && p.year <= 2029).map((p) => ({ label: String(p.year), value: Math.max(p.current_pct, 0), hl: p.year === 2026 }))} format={(n) => `${n}%`} />
            <p className="muted" style={{ fontSize: '0.78rem', margin: '8px 0 0' }}>The 2029 drop follows {fmt0(proj2029?.annual_expenses ?? 0)} of scheduled repairs.</p>
          </div>
        </div>
      </Step>

      <Step id="reserves" n={6} title="The reserve fund’s 30-year outlook">
        <p className="lede">
          The reserve study projects the balance under three plans. Under the <b>current plan</b>, the balance
          {firstNeg ? <> drops below zero in <b>{firstNeg.year}</b>, when {fmt0(firstNeg.annual_expenses)} of repairs come due,</> : null}{' '}
          and is negative in {negYears.length} of the {proj.length} years shown. A negative balance means the repairs can’t be paid from savings;
          the usual result is a special assessment or a loan. The recommended plan stays above zero throughout.
        </p>
        <ReserveChart rows={proj} />
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Dashed lines mark years with more than $50,000 of scheduled repairs, labeled with the amount. The study assumes 3% inflation, contributions rising 3% a year, and 1.5% interest. It was written in January 2024; the
          Association’s actual balance today may differ.
        </p>
        <button className="btn sm ghost table-toggle" onClick={() => toggle('reserve')}>{tables.reserve ? 'Hide' : 'Show'} as a table</button>
        {tables.reserve && (
          <div className="table-wrap">
            <table className="list" style={{ fontSize: '0.84rem' }}>
              <thead>
                <tr><th>Year</th><th style={{ textAlign: 'right' }}>Repairs</th><th style={{ textAlign: 'right' }}>Current plan</th><th style={{ textAlign: 'right' }}>5% threshold</th><th style={{ textAlign: 'right' }}>Recommended</th></tr>
              </thead>
              <tbody>
                {proj.map((p) => (
                  <tr key={p.year}>
                    <td>{p.year}</td>
                    <td style={{ textAlign: 'right' }}>{fmt0(p.annual_expenses)}</td>
                    <td style={{ textAlign: 'right', fontWeight: p.current_balance < 0 ? 700 : 400 }}>{fmt0(p.current_balance)} ({p.current_pct}%)</td>
                    <td style={{ textAlign: 'right' }}>{fmt0(p.threshold_balance)} ({p.threshold_pct}%)</td>
                    <td style={{ textAlign: 'right' }}>{fmt0(p.recommended_balance)} ({p.recommended_pct}%)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Step>

      <Step id="questions" n={7} title="Questions worth asking the Board">
        <ul className="ink2" style={{ paddingLeft: '1.2em' }}>
          <li>How does actual 2026 spending compare with this budget, line by line? (Monthly financial statements are association records.)</li>
          <li>Building insurance is budgeted at {fmt0(insurancePremiumBudget)}, but the current premium is {fmt0(premiumNow)}. What is the plan for the difference and for the November 2026 renewal?</li>
          <li>Plumbing repairs are budgeted at {fmt0((lines.find((l) => l.account === '66110')?.annual ?? 0) + (lines.find((l) => l.account === '66120')?.annual ?? 0))} for the year, and plumbing isn’t a reserve component. Is that enough for a building of this age?</li>
          <li>Reserve contributions are below the study’s minimum (5% threshold) plan. Will the Board adopt the recommended plan, and when is the next reserve study update due?</li>
          {flatRoof && (
            <li>The study listed {flatRoof.label.replace(/^Flat roofing/, 'flat roofing')} with {flatRoof.value} year of life left at the end of 2024. Has it been replaced, and from which fund?</li>
          )}
        </ul>
        <div className="row">
          <Link className="btn primary" to={`/requests/new?type=records_current&description=${encodeURIComponent('Monthly financial statements for 2026 showing actual income and expenses against budget, and reserve account statements.')}`}>
            <Icon name="file" /> Request the financial statements
          </Link>
          <Link className="btn" to="/assistant?q=Explain%20the%20HOA%27s%20reserve%20funding%20and%20what%20happens%20if%20the%20reserve%20fund%20runs%20out">
            <Icon name="sparkle" /> Ask the assistant
          </Link>
        </div>
      </Step>
    </>
  )
}
