import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Attachments } from '../components/Attachments'
import { Icon } from '../components/Icon'
import { useProfile } from '../lib/auth'
import { fmtDate, money } from '../lib/format'
import { errMsg, supabase, type Incident } from '../lib/supabase'

const CATS: Record<string, string> = {
  leak: 'Leak / water',
  plumbing: 'Plumbing',
  roof: 'Roof',
  electrical: 'Electrical',
  pest: 'Termites / pests',
  structural: 'Structural',
  safety: 'Safety',
  other: 'Other',
}
const FUNDS: Record<string, string> = { operating: 'Operating', reserve: 'Reserve', insurance: 'Insurance', owner: 'Owner paid', unknown: 'Unknown' }

type Form = {
  title: string
  category: string
  location_type: 'common' | 'unit'
  location: string
  occurred_on: string
  reported_on: string
  description: string
  reported_to: string
  hoa_response: string
  diagnosed: '' | 'yes' | 'no'
  diagnosis: string
  resolved: boolean
  cost: string
  fund: string
  consent: boolean
}

const EMPTY: Form = {
  title: '', category: 'leak', location_type: 'common', location: '', occurred_on: '', reported_on: '', description: '',
  reported_to: '', hoa_response: '', diagnosed: '', diagnosis: '', resolved: false, cost: '', fund: 'unknown', consent: false,
}

export default function Incidents() {
  const profile = useProfile()
  const [rows, setRows] = useState<Incident[] | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(window.location.hash.slice(1) || null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('incidents').select('*').order('occurred_on', { ascending: false, nullsFirst: false })
    setRows((data as Incident[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function edit(i: Incident) {
    setEditId(i.id)
    setForm({
      title: i.title, category: i.category, location_type: i.location_type, location: i.location ?? '', occurred_on: i.occurred_on ?? '',
      reported_on: i.reported_on ?? '', description: i.description ?? '', reported_to: i.reported_to ?? '', hoa_response: i.hoa_response ?? '',
      diagnosed: i.diagnosed == null ? '' : i.diagnosed ? 'yes' : 'no', diagnosis: i.diagnosis ?? '', resolved: i.resolved,
      cost: i.cost?.toString() ?? '', fund: i.fund ?? 'unknown', consent: true,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save() {
    if (!form) return
    if (!form.title.trim()) return setError('Add a title')
    if (!form.consent) return setError('Please confirm the consent statement')
    setError('')
    const row = {
      title: form.title.trim(),
      category: form.category,
      location_type: form.location_type,
      location: form.location || null,
      occurred_on: form.occurred_on || null,
      reported_on: form.reported_on || null,
      description: form.description || null,
      reported_to: form.reported_to || null,
      hoa_response: form.hoa_response || null,
      diagnosed: form.diagnosed === '' ? null : form.diagnosed === 'yes',
      diagnosis: form.diagnosis || null,
      resolved: form.resolved,
      cost: form.cost ? Number(form.cost.replace(/[^\d.]/g, '')) : null,
      fund: form.fund,
      consent_confirmed: true,
    }
    const { error } = editId
      ? await supabase.from('incidents').update(row).eq('id', editId)
      : await supabase.from('incidents').insert({ ...row, unit_id: form.location_type === 'unit' ? profile.unit_id : null, created_by: profile.id })
    if (error) return setError(errMsg(error))
    setForm(null)
    setEditId(null)
    load()
  }

  const list = (rows ?? []).filter((r) => !cat || r.category === cat)
  const undiagnosed = (rows ?? []).filter((r) => r.diagnosed === false).length
  const water = (rows ?? []).filter((r) => r.category === 'leak' || r.category === 'plumbing' || r.category === 'roof').length
  const f = form

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Maintenance & incident log</h1>
          <p>
            Leaks, repairs, contractor visits and roof or garage work. Over time this builds the record of what happened, whether it was
            diagnosed, and who paid.
          </p>
        </div>
        {!form && (
          <button className="btn primary" onClick={() => { setEditId(null); setForm(EMPTY) }}>
            <Icon name="plus" /> Log an entry
          </button>
        )}
      </div>

      {rows && rows.length > 0 && (
        <div className="grid grid-3 mb">
          <div className="card stat"><div className="n">{rows.length}</div><div className="l">Entries</div></div>
          <div className="card stat warn"><div className="n">{water}</div><div className="l">Water, plumbing or roof</div></div>
          <div className={`card stat ${undiagnosed ? 'bad' : ''}`}><div className="n">{undiagnosed}</div><div className="l">Never diagnosed</div></div>
        </div>
      )}

      {f && (
        <div className="card stack mb">
          <h3 style={{ margin: 0 }}>{editId ? 'Edit entry' : 'New entry'}</h3>
          <div className="grid grid-2">
            <label className="field">What happened<input value={f.title} onChange={(e) => setForm({ ...f, title: e.target.value })} placeholder="e.g. Water leak in common garage" /></label>
            <label className="field">
              Category
              <select value={f.category} onChange={(e) => setForm({ ...f, category: e.target.value })}>
                {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">
              Where
              <select value={f.location_type} onChange={(e) => setForm({ ...f, location_type: e.target.value as 'common' | 'unit' })}>
                <option value="common">Common area</option>
                <option value="unit">My unit (Unit {profile.unit_id})</option>
              </select>
            </label>
            <label className="field">Location detail<input value={f.location} onChange={(e) => setForm({ ...f, location: e.target.value })} placeholder="e.g. Garage, near stall 7" /></label>
            <label className="field">Date it happened / was found<input type="date" value={f.occurred_on} onChange={(e) => setForm({ ...f, occurred_on: e.target.value })} /></label>
            <label className="field">Date reported to HOA<input type="date" value={f.reported_on} onChange={(e) => setForm({ ...f, reported_on: e.target.value })} /></label>
            <label className="field">Reported to<input value={f.reported_to} onChange={(e) => setForm({ ...f, reported_to: e.target.value })} placeholder="e.g. LBPM by email; Board group chat" /></label>
            <label className="field">
              Was the cause diagnosed?
              <select value={f.diagnosed} onChange={(e) => setForm({ ...f, diagnosed: e.target.value as Form['diagnosed'] })}>
                <option value="">Not known yet</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="field">Cost (if known)<input inputMode="decimal" value={f.cost} onChange={(e) => setForm({ ...f, cost: e.target.value })} placeholder="$" /></label>
            <label className="field">
              Paid from
              <select value={f.fund} onChange={(e) => setForm({ ...f, fund: e.target.value })}>
                {Object.entries(FUNDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <label className="field">Description (facts only)<textarea value={f.description} onChange={(e) => setForm({ ...f, description: e.target.value })} /></label>
          <label className="field">HOA response<textarea style={{ minHeight: 70 }} value={f.hoa_response} onChange={(e) => setForm({ ...f, hoa_response: e.target.value })} /></label>
          <label className="field">Diagnosis / cause<input value={f.diagnosis} onChange={(e) => setForm({ ...f, diagnosis: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={f.resolved} onChange={(e) => setForm({ ...f, resolved: e.target.checked })} /> Resolved</label>
          <label className="check">
            <input type="checkbox" checked={f.consent} onChange={(e) => setForm({ ...f, consent: e.target.checked })} />
            <span>
              I know about this first-hand or from documents. It involves only the common area or my own unit, or the affected owner agreed
              to it being logged. It contains no other owner's personal details.
            </span>
          </label>
          {error && <div className="notice bad">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={() => { setForm(null); setEditId(null) }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="row mb">
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">All categories</option>
          {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <div className="card empty"><h3>No entries yet</h3></div>
      ) : (
        <div className="stack">
          {list.map((i) => (
            <div className="card" key={i.id} id={i.id}>
              <div className="row between" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i.id ? null : i.id)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{i.title}</div>
                  <div className="muted" style={{ fontSize: '0.86rem' }}>
                    {CATS[i.category]} · {i.location_type === 'common' ? 'Common area' : `Unit ${i.unit_id}`}
                    {i.location ? ` · ${i.location}` : ''} · {fmtDate(i.occurred_on ?? i.reported_on)}
                  </div>
                </div>
                <div className="row">
                  {i.diagnosed != null && <span className={`badge ${i.diagnosed ? 'ok' : 'bad'}`}>{i.diagnosed ? 'Diagnosed' : 'Not diagnosed'}</span>}
                  <span className={`badge ${i.resolved ? 'ok' : 'warn'}`}>{i.resolved ? 'Resolved' : 'Open'}</span>
                </div>
              </div>
              {open === i.id && (
                <div className="mt">
                  <table className="list">
                    <tbody>
                      {i.description && <tr><td className="muted" style={{ width: 160 }}>Description</td><td style={{ whiteSpace: 'pre-wrap' }}>{i.description}</td></tr>}
                      <tr><td className="muted">Reported</td><td>{fmtDate(i.reported_on)}{i.reported_to ? ` to ${i.reported_to}` : ''}</td></tr>
                      {i.hoa_response && <tr><td className="muted">HOA response</td><td style={{ whiteSpace: 'pre-wrap' }}>{i.hoa_response}</td></tr>}
                      {i.diagnosis && <tr><td className="muted">Diagnosis</td><td>{i.diagnosis}</td></tr>}
                      <tr><td className="muted">Cost / fund</td><td>{money(i.cost)} · {FUNDS[i.fund ?? 'unknown']}</td></tr>
                    </tbody>
                  </table>
                  <div className="row mt">
                    {(i.created_by === profile.id || profile.role === 'admin') && <button className="btn sm" onClick={() => edit(i)}>Edit</button>}
                    <Link className="btn sm" to={`/requests/new?type=maintenance&description=${encodeURIComponent(`${i.title}${i.location ? ` (${i.location})` : ''}. ${i.description ?? ''}`)}`}>
                      <Icon name="send" /> Send a maintenance notice about this
                    </Link>
                  </div>
                  <div className="mt"><Attachments incidentId={i.id} canUpload /></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
