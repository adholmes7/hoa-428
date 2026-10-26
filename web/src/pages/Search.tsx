import DOMPurify from 'dompurify'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'

type Hit = { kind: string; ref: string; title: string; snippet: string; rank: number; page: number | null }

const KIND: Record<string, string> = { ccr: 'CC&Rs', document: 'Document', request: 'Request', incident: 'Maintenance log' }

function hrefFor(h: Hit) {
  if (h.kind === 'ccr') return `/ccrs/${h.ref}`
  if (h.kind === 'request') return `/requests/${h.ref}`
  if (h.kind === 'incident') return `/incidents#${h.ref}`
  return '/documents'
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [hits, setHits] = useState<Hit[] | null>(null)

  useEffect(() => {
    if (!q.trim()) return setHits(null)
    supabase.rpc('search_all', { q, max_results: 40 }).then(({ data }) => setHits((data as Hit[]) ?? []))
  }, [q])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Search everything</h1>
          <p>CC&Rs, the budget and reserve study, insurance documents, requests and the maintenance log.</p>
        </div>
      </div>
      <form
        className="row mb"
        onSubmit={(e) => {
          e.preventDefault()
          setParams({ q: new FormData(e.currentTarget).get('q') as string })
        }}
      >
        <input name="q" defaultValue={q} key={q} autoFocus placeholder="e.g. deductible, reserve study plumbing, roof" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn primary"><Icon name="search" /> Search</button>
      </form>
      {q && (
        <p className="muted">
          Prefer a plain-language answer? <Link to={`/assistant?q=${encodeURIComponent(q)}`}>Ask the assistant about “{q}”</Link>
        </p>
      )}
      {hits && (
        <div className="card">
          {hits.length === 0 ? (
            <p className="muted">No matches.</p>
          ) : (
            <div className="item-list">
              {hits.map((h, i) => (
                <Link key={i} to={hrefFor(h)} className="item">
                  <span className="badge" style={{ minWidth: 90, justifyContent: 'center' }}>{KIND[h.kind]}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{h.title}{h.page && h.kind === 'document' ? ` · p. ${h.page}` : ''}</div>
                    <div className="snippet" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(h.snippet, { ALLOWED_TAGS: ['b'] }) }} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
