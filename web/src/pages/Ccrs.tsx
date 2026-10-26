import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { cleanCcrText } from '../lib/letters'
import { signedUrl, supabase, type CcrSection } from '../lib/supabase'

// Sections owners most often need, from the brief's index
const KEY_SECTIONS: [string, string][] = [
  ['1.25', 'Unit boundaries'],
  ['2.7', 'Utility lines'],
  ['3.5', 'Board powers; entry with 48h notice'],
  ['3.10', 'Records inspection'],
  ['3.11', 'Board liability limit'],
  ['5.4', 'Flooring and unit modifications'],
  ['6.3', 'Who maintains what'],
  ['6.5', 'Damage caused by an owner'],
  ['6.6', 'Water intrusion'],
  ['7.3', 'Architectural approval (60 days)'],
  ['8.7', 'Owners must carry insurance'],
  ['8.9', 'Insurance deductibles'],
  ['12.5', 'Meet and confer (IDR)'],
  ['14.12', 'How notices must be delivered'],
]

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string, q: string) {
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  if (!words.length) return text
  const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

export default function Ccrs() {
  const { section } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [all, setAll] = useState<CcrSection[] | null>(null)
  const [pdfDocId, setPdfDocId] = useState<{ path: string } | null>(null)
  const q = params.get('q') ?? ''

  useEffect(() => {
    supabase
      .from('ccr_sections')
      .select('*')
      .order('sort')
      .then(({ data }) => setAll((data as CcrSection[]) ?? []))
    supabase
      .from('documents')
      .select('storage_path')
      .eq('category', 'governing')
      .ilike('title', '%CC&R%')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => data?.storage_path && setPdfDocId({ path: data.storage_path }))
  }, [])

  const results = useMemo(() => {
    if (!all || !q.trim()) return null
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return all
      .map((s) => {
        const hay = `${s.title} ${s.text}`.toLowerCase()
        const score = words.reduce((n, w) => n + (hay.split(w).length - 1) + (s.title.toLowerCase().includes(w) ? 10 : 0), 0)
        return { s, score, all: words.every((w) => hay.includes(w)) }
      })
      .filter((x) => x.all)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
  }, [all, q])

  const current = all?.find((s) => s.id === section) ?? null
  const idx = current && all ? all.indexOf(current) : -1

  async function openPdf(page: number) {
    if (!pdfDocId) return
    const url = await signedUrl('documents', pdfDocId.path)
    window.open(`${url}#page=${page}`, '_blank', 'noopener')
  }

  const articles = useMemo(() => {
    const map = new Map<number, { title: string; sections: CcrSection[] }>()
    for (const s of all ?? []) {
      if (!map.has(s.article)) map.set(s.article, { title: s.article_title, sections: [] })
      map.get(s.article)!.sections.push(s)
    }
    return [...map.entries()]
  }, [all])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>CC&Rs</h1>
          <p>Amended and Restated Declaration. Link to any section with its number, e.g. /ccrs/6.3.</p>
        </div>
      </div>
      <form
        className="row mb"
        onSubmit={(e) => {
          e.preventDefault()
          const v = new FormData(e.currentTarget).get('q') as string
          if (section) nav(`/ccrs?q=${encodeURIComponent(v)}`)
          else setParams(v ? { q: v } : {})
        }}
      >
        <input name="q" defaultValue={q} key={q} placeholder="Search the CC&Rs, e.g. pipes, flooring, insurance, leasing" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn primary">
          <Icon name="search" /> Search
        </button>
      </form>

      {!all ? (
        <p className="muted">Loading…</p>
      ) : all.length === 0 ? (
        <div className="card empty">
          <h3>The CC&Rs haven't been loaded yet</h3>
          <p>An admin needs to run the seed script (see the README).</p>
        </div>
      ) : current ? (
        <div className="card">
          <div className="row between">
            <Link to={q ? `/ccrs?q=${encodeURIComponent(q)}` : '/ccrs'} className="muted" style={{ fontSize: '0.88rem' }}>
              ← {q ? 'Search results' : 'All sections'}
            </Link>
            <div className="row">
              {idx > 0 && <Link className="btn sm" to={`/ccrs/${all[idx - 1].id}`}>‹ §{all[idx - 1].id}</Link>}
              {idx < all.length - 1 && <Link className="btn sm" to={`/ccrs/${all[idx + 1].id}`}>§{all[idx + 1].id} ›</Link>}
            </div>
          </div>
          <h2 className="mt">
            {/^\d/.test(current.id) ? `Section ${current.id}. ` : ''}
            {current.title}
          </h2>
          <div className="row mb">
            <span className="badge">Article {current.article} · {current.article_title}</span>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              PDF p. {current.pdf_page}
              {current.pdf_page_end !== current.pdf_page ? `–${current.pdf_page_end}` : ''} · printed p. {current.printed_page}
            </span>
            {pdfDocId && (
              <button className="btn sm" onClick={() => openPdf(current.pdf_page)}>
                Open the PDF page <Icon name="external" size={13} />
              </button>
            )}
            <Link className="btn sm" to={`/assistant?q=${encodeURIComponent(`Explain CC&R section ${current.id} (${current.title}) in plain language`)}`}>
              <Icon name="sparkle" /> Explain this
            </Link>
          </div>
          <div className="ccr-text">{highlight(cleanCcrText(current.text), q)}</div>
        </div>
      ) : results ? (
        <div className="card">
          <h3>{results.length} section{results.length === 1 ? '' : 's'} match “{q}”</h3>
          <div className="item-list">
            {results.map(({ s }) => {
              const i = s.text.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0])
              const snip = s.text.slice(Math.max(0, i - 120), i + 220).replace(/\s+/g, ' ')
              return (
                <Link key={s.id} to={`/ccrs/${s.id}?q=${encodeURIComponent(q)}`} className="item">
                  <div>
                    <div className="t">§{s.id} {s.title}</div>
                    <div className="snippet">…{highlight(snip, q)}…</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <h3>Most-used sections</h3>
            <div className="item-list">
              {KEY_SECTIONS.map(([id, label]) => (
                <Link key={id} to={`/ccrs/${id}`} className="item">
                  <span className="badge brand">§{id}</span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Table of contents</h3>
            {articles.map(([n, a]) => (
              <details key={n} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '4px 0' }}>
                  {n === 0 ? 'Recitals' : n === 15 ? a.title : `Article ${n}. ${a.title}`}
                </summary>
                <div className="item-list" style={{ paddingLeft: 12 }}>
                  {a.sections.map((s) => (
                    <Link key={s.id} to={`/ccrs/${s.id}`} className="item" style={{ padding: '6px 4px' }}>
                      <span className="muted" style={{ minWidth: 42 }}>{/^\d/.test(s.id) ? s.id : ''}</span>
                      <span>{s.title}</span>
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
