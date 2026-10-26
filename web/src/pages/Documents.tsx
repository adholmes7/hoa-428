import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useProfile } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { errMsg, signedUrl, supabase, type DocumentRow } from '../lib/supabase'

const CATEGORIES: Record<string, string> = {
  governing: 'Governing documents',
  insurance: 'Insurance',
  financial: 'Budget, reserves & finances',
  minutes: 'Agendas & minutes',
  records_response: 'Records the HOA provided',
  correspondence: 'Correspondence',
  other: 'Other',
}

const EMPTY = { title: '', category: 'records_response', doc_date: '', source: '', obtained_via: '', notes: '' }

export default function Documents() {
  const profile = useProfile()
  const [docs, setDocs] = useState<DocumentRow[] | null>(null)
  const [cat, setCat] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*').order('doc_date', { ascending: false, nullsFirst: false })
    setDocs((data as DocumentRow[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function open(d: DocumentRow) {
    if (!d.storage_path) return
    try {
      window.open(await signedUrl('documents', d.storage_path), '_blank', 'noopener')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function save() {
    const f = file.current?.files?.[0]
    if (!form.title.trim()) return setError('Add a title')
    setBusy(true)
    setError('')
    try {
      let storage_path: string | null = null
      if (f) {
        storage_path = `${profile.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, '_')}`
        const { error } = await supabase.storage.from('documents').upload(storage_path, f, { contentType: f.type })
        if (error) throw error
      }
      const { error } = await supabase.from('documents').insert({
        ...form,
        doc_date: form.doc_date || null,
        storage_path,
        file_name: f?.name ?? null,
        uploaded_by: profile.id,
      })
      if (error) throw error
      setForm(EMPTY)
      setAdding(false)
      load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = (docs ?? []).filter((d) => !cat || d.category === cat)
  const grouped = Object.keys(CATEGORIES)
    .map((k) => [k, shown.filter((d) => d.category === k)] as const)
    .filter(([, list]) => list.length)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Document library</h1>
          <p>Budgets, reserve studies, insurance, and records owners have obtained from the HOA, each with where it came from.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" /> Add document
        </button>
      </div>
      <div className="notice warn mb">
        Records obtained as a member are for owners only. Don't post them publicly or use them for anything unrelated to
        membership (Civ. Code §5230).
      </div>

      {adding && (
        <div className="card stack mb">
          <h3 style={{ margin: 0 }}>Add a document</h3>
          <div className="grid grid-2">
            <label className="field">
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Roof sealing invoice, May 2026" />
            </label>
            <label className="field">
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">
              Document date
              <input type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} />
            </label>
            <label className="field">
              Source
              <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. LBPM, State Farm, Board" />
            </label>
            <label className="field">
              How it was obtained
              <input value={form.obtained_via} onChange={(e) => setForm({ ...form, obtained_via: e.target.value })} placeholder="e.g. Records request #12; annual mailing" />
            </label>
            <label className="field">
              File
              <input ref={file} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt" />
            </label>
          </div>
          <label className="field">
            Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ minHeight: 70 }} />
          </label>
          {error && <div className="notice bad">{error}</div>}
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Uploading…' : 'Save'}</button>
            <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="row mb">
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {docs === null ? (
        <p className="muted">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="card empty"><h3>No documents yet</h3></div>
      ) : (
        grouped.map(([k, list]) => (
          <div className="card" key={k}>
            <h3>{CATEGORIES[k]}</h3>
            <div className="item-list">
              {list.map((d) => (
                <div key={d.id} className="item">
                  <Icon name="file" size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {d.storage_path ? (
                      <a href="#" className="t" onClick={(e) => (e.preventDefault(), open(d))}>{d.title}</a>
                    ) : (
                      <span className="t">{d.title}</span>
                    )}
                    <div className="s">
                      {[d.doc_date && fmtDate(d.doc_date), d.source, d.obtained_via, d.page_count && `${d.page_count} pages`].filter(Boolean).join(' · ')}
                    </div>
                    {d.notes && <div className="s" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{d.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  )
}
