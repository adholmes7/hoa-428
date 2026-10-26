import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, todayISO } from '@shared/deadlines.ts'
import { Icon } from '../components/Icon'
import { useProfile } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { errMsg, signedUrl, supabase, type DocumentRow, type Meeting } from '../lib/supabase'

const KINDS: Record<string, string> = { board: 'Board meeting', annual: 'Annual meeting', special: 'Special members meeting', executive: 'Executive session', committee: 'Committee' }
const EMPTY = { meeting_date: '', kind: 'board', title: '', minutes_received_on: '', decisions: '', open_items: '', agenda_document_id: '', minutes_document_id: '' }

export default function Meetings() {
  const profile = useProfile()
  const [rows, setRows] = useState<Meeting[] | null>(null)
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: false })
    setRows((data as Meeting[]) ?? [])
    const { data: d } = await supabase.from('documents').select('*').in('category', ['minutes', 'governing', 'records_response', 'other']).order('doc_date', { ascending: false })
    setDocs((d as DocumentRow[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (!form?.meeting_date) return setError('Add the meeting date')
    const row = {
      ...form,
      title: form.title || null,
      minutes_received_on: form.minutes_received_on || null,
      agenda_document_id: form.agenda_document_id || null,
      minutes_document_id: form.minutes_document_id || null,
    }
    const { error } = editId
      ? await supabase.from('meetings').update(row).eq('id', editId)
      : await supabase.from('meetings').insert({ ...row, created_by: profile.id })
    if (error) return setError(errMsg(error))
    setForm(null)
    setEditId(null)
    load()
  }

  async function openDoc(id: string | null) {
    const d = docs.find((x) => x.id === id)
    if (d?.storage_path) window.open(await signedUrl('documents', d.storage_path), '_blank', 'noopener')
  }

  const today = todayISO()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Board meetings</h1>
          <p>Agendas, minutes and decisions. Minutes of open meetings must be available to owners within 30 days (Civ. Code §4950).</p>
        </div>
        {!form && <button className="btn primary" onClick={() => { setEditId(null); setForm(EMPTY) }}><Icon name="plus" /> Add meeting</button>}
      </div>

      {form && (
        <div className="card stack mb">
          <div className="grid grid-2">
            <label className="field">Date<input type="date" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} /></label>
            <label className="field">Type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">Title (optional)<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field">Minutes received on<input type="date" value={form.minutes_received_on} onChange={(e) => setForm({ ...form, minutes_received_on: e.target.value })} /></label>
            <label className="field">Agenda document
              <select value={form.agenda_document_id} onChange={(e) => setForm({ ...form, agenda_document_id: e.target.value })}>
                <option value="">—</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <label className="field">Minutes document
              <select value={form.minutes_document_id} onChange={(e) => setForm({ ...form, minutes_document_id: e.target.value })}>
                <option value="">—</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
              <span className="hint">Upload files in the Document library first.</span>
            </label>
          </div>
          <label className="field">Decisions made<textarea value={form.decisions} onChange={(e) => setForm({ ...form, decisions: e.target.value })} /></label>
          <label className="field">Open items<textarea style={{ minHeight: 70 }} value={form.open_items} onChange={(e) => setForm({ ...form, open_items: e.target.value })} /></label>
          {error && <div className="notice bad">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card empty"><h3>No meetings logged yet</h3><p>The 2026 annual election meeting was set for Tuesday, February 17.</p></div>
      ) : (
        <div className="card">
          <div className="item-list">
            {rows.map((m) => {
              const minutesDue = addDays(m.meeting_date, 30)
              const late = !m.minutes_received_on && m.kind !== 'executive' && minutesDue < today
              return (
                <div className="item" key={m.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{fmtDate(m.meeting_date)} · {m.title || KINDS[m.kind]}</div>
                    <div className="s">
                      {m.minutes_received_on ? `Minutes received ${fmtDate(m.minutes_received_on)}` : m.kind === 'executive' ? 'Executive session' : `Minutes due ${fmtDate(minutesDue)}`}
                    </div>
                    {m.decisions && <div className="s mt" style={{ whiteSpace: 'pre-wrap' }}><b>Decisions:</b> {m.decisions}</div>}
                    {m.open_items && <div className="s" style={{ whiteSpace: 'pre-wrap' }}><b>Open:</b> {m.open_items}</div>}
                    <div className="row mt">
                      {m.agenda_document_id && <button className="btn sm" onClick={() => openDoc(m.agenda_document_id)}>Agenda</button>}
                      {m.minutes_document_id && <button className="btn sm" onClick={() => openDoc(m.minutes_document_id)}>Minutes</button>}
                      {(m.created_by === profile.id || profile.role === 'admin') && (
                        <button className="btn sm ghost" onClick={() => {
                          setEditId(m.id)
                          setForm({
                            meeting_date: m.meeting_date, kind: m.kind, title: m.title ?? '', minutes_received_on: m.minutes_received_on ?? '',
                            decisions: m.decisions ?? '', open_items: m.open_items ?? '', agenda_document_id: m.agenda_document_id ?? '', minutes_document_id: m.minutes_document_id ?? '',
                          })
                        }}>Edit</button>
                      )}
                      {late && (
                        <Link className="btn sm" to={`/requests/new?type=minutes&description=${encodeURIComponent(`Minutes of the ${KINDS[m.kind].toLowerCase()} held ${fmtDate(m.meeting_date)}`)}`}>
                          Request these minutes
                        </Link>
                      )}
                    </div>
                  </div>
                  {late && <span className="badge bad">Minutes late</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
