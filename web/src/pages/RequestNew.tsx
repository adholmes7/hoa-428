import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { METHODS, REQUEST_TYPES, requestType, todayISO, type Method } from '@shared/deadlines.ts'
import { Icon } from '../components/Icon'
import { useAssociation, useAuth, useProfile } from '../lib/auth'
import { composeLetter, defaultSummary, defaultTitle, LETTER_FIELDS, type FieldDef } from '../lib/letters'
import { errMsg, supabase } from '../lib/supabase'

function FieldInput({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (def.kind === 'checklist') {
    const sel = (value as string[]) ?? []
    return (
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend className="field" style={{ marginBottom: 6, fontSize: '0.88rem', fontWeight: 500, color: 'var(--ink-2)' }}>
          {def.label}
        </legend>
        {def.options!.map((o) => (
          <label key={o} className="check">
            <input
              type="checkbox"
              checked={sel.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...sel, o] : sel.filter((x) => x !== o))}
            />
            <span>{o}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  return (
    <label className="field">
      {def.label}
      {def.kind === 'textarea' ? (
        <textarea value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={def.kind === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {def.hint && <span className="hint">{def.hint}</span>}
    </label>
  )
}

export default function RequestNew() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const profile = useProfile()
  const { session } = useAuth()
  const association = useAssociation()
  const [step, setStep] = useState(params.get('type') ? 2 : 1)
  const [type, setType] = useState(params.get('type') ?? '')
  const [fields, setFields] = useState<Record<string, unknown>>(() => {
    const d = params.get('description')
    const key = (LETTER_FIELDS[params.get('type') ?? ''] ?? []).find((f) => f.kind === 'textarea')?.key ?? 'description'
    return d ? { [key]: d } : {}
  })
  const [method, setMethod] = useState<Method>('certified_rr')
  const [visibility, setVisibility] = useState<'owners' | 'private'>('owners')
  const [letter, setLetter] = useState('')
  const [edited, setEdited] = useState(false)
  const [ccr125, setCcr125] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const t = requestType(type)
  const defs = LETTER_FIELDS[type] ?? []

  useEffect(() => {
    if (t) setMethod(t.recommendedMethod)
  }, [t])

  useEffect(() => {
    if (type === 'meet_confer' && !ccr125) {
      supabase
        .from('ccr_sections')
        .select('text')
        .eq('id', '12.5')
        .maybeSingle()
        .then(({ data }) => setCcr125(data?.text ?? ''))
    }
  }, [type, ccr125])

  const generated = useMemo(
    () =>
      type
        ? composeLetter(type, fields, {
            ownerName: profile.display_name,
            unit: profile.unit_id,
            ownerAddress: profile.mailing_address ?? '',
            ownerEmail: profile.contact_email ?? session?.user.email ?? '',
            date: todayISO(),
            association,
            ccr125,
            method,
          })
        : '',
    [type, fields, profile, session, association, ccr125, method],
  )

  useEffect(() => {
    if (!edited) setLetter(generated)
  }, [generated, edited])

  const missing = defs.filter((d) => d.required && !String(fields[d.key] ?? '').trim()).map((d) => d.label)
  const set = (k: string) => (v: unknown) => setFields((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!t) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('requests')
      .insert({
        type,
        title: defaultTitle(type, fields),
        summary: defaultSummary(fields),
        letter_body: letter,
        letter_fields: fields,
        unit_id: profile.unit_id,
        requester_id: profile.id,
        visibility,
        legal_basis: t.legalBasis,
        day_type: t.dayType,
        deadline_days: t.days,
        deadline_kind: t.deadlineKind,
        if_missed: t.ifMissed,
        method,
        status: 'draft',
      })
      .select('id')
      .single()
    if (error) {
      setBusy(false)
      return setError(errMsg(error))
    }
    await supabase.from('request_events').insert({ request_id: data.id, kind: 'created', note: 'Draft created', created_by: profile.id })
    nav(`/requests/${data.id}`)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/requests" className="muted" style={{ fontSize: '0.88rem' }}>
            ← Requests
          </Link>
          <h1>New request</h1>
        </div>
      </div>
      <div className="steps">
        {['Type', 'Details', 'Review letter'].map((s, i) => (
          <span key={s} className={step === i + 1 ? 'on' : ''}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="type-grid">
          {REQUEST_TYPES.map((rt) => (
            <button
              key={rt.id}
              className={`type-card ${type === rt.id ? 'selected' : ''}`}
              onClick={() => {
                setType(rt.id)
                setEdited(false)
                setStep(2)
              }}
            >
              <div className="t">{rt.label}</div>
              <div className="d">{rt.description}</div>
              <div className="meta row">
                {rt.days ? (
                  <span className={`badge ${rt.deadlineKind === 'followup' ? '' : 'brand'}`}>
                    {rt.days} {rt.dayType} days{rt.deadlineKind === 'followup' ? ' (follow-up)' : ''}
                  </span>
                ) : (
                  <span className="badge">No deadline</span>
                )}
                {rt.legalBasis && <span className="muted" style={{ fontSize: '0.78rem' }}>{rt.legalBasis}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 2 && t && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div className="card stack">
            <div className="row between">
              <h2 style={{ margin: 0 }}>{t.label}</h2>
              <button className="btn sm ghost" onClick={() => setStep(1)}>
                Change
              </button>
            </div>
            {defs.map((d) => (
              <FieldInput key={d.key} def={d} value={fields[d.key]} onChange={set(d.key)} />
            ))}
            <label className="field">
              How you'll deliver it
              <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {Object.entries(METHODS).map(([k, m]) => (
                  <option key={k} value={k}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="hint">{METHODS[method].note}</span>
            </label>
            <label className="field">
              Who can see this request on the site
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'owners' | 'private')}>
                <option value="owners">All owners (status, dates and summary)</option>
                <option value="private">Only my unit</option>
              </select>
              <span className="hint">Keep personal disputes private. Building-wide issues are stronger when other owners can see them.</span>
            </label>
            {!profile.mailing_address && (
              <div className="notice warn">
                Your return address defaults to 428 Hill Street, Unit {profile.unit_id}. If you get mail elsewhere,{' '}
                <Link to="/profile">add a mailing address</Link>.
              </div>
            )}
            <div className="row">
              <button className="btn primary" disabled={missing.length > 0} onClick={() => setStep(3)}>
                Review letter
              </button>
              {missing.length > 0 && <span className="muted" style={{ fontSize: '0.85rem' }}>Still needed: {missing.join(', ')}</span>}
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <h3>What happens</h3>
              <p className="ink2" style={{ fontSize: '0.92rem' }}>
                {t.days ? (
                  <>
                    The HOA has <b>{t.days} {t.dayType} days</b> from the day it receives this.{' '}
                    {t.deadlineKind === 'followup' && 'There is no fixed legal deadline; this is a suggested follow-up date. '}
                  </>
                ) : (
                  'There is no deadline for this kind of letter. '
                )}
                {t.ifMissed}
              </p>
              {t.deliveryNote && <div className="notice warn">{t.deliveryNote}</div>}
              {t.verify && <div className="notice warn mt">Some rules for this request type still need checking against the statute.</div>}
              <p className="muted mt" style={{ fontSize: '0.82rem', marginBottom: 0 }}>Basis: {t.legalBasis || '—'}</p>
            </div>
            <div className="card">
              <h3>Tips</h3>
              <ul className="ink2" style={{ fontSize: '0.9rem', paddingLeft: '1.2em', margin: 0 }}>
                <li>Stick to dates, facts and the sections involved. Leave out opinions about individuals.</li>
                <li>One issue per letter keeps deadlines clean.</li>
                <li>Certified Mail with return receipt gives you a signed delivery date, which starts the clock.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {step === 3 && t && (
        <div className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Review and edit</h2>
            {edited && (
              <button className="btn sm" onClick={() => setEdited(false)}>
                Reset to generated text
              </button>
            )}
          </div>
          <p className="ink2" style={{ margin: 0 }}>
            Edit anything you like. The required elements for this request type are already in place. Next you'll save it as a
            draft, download the PDF, and record how you sent it.
          </p>
          <textarea
            className="letter"
            style={{ minHeight: '60vh', width: '100%' }}
            value={letter}
            onChange={(e) => {
              setEdited(true)
              setLetter(e.target.value)
            }}
          />
          {error && <div className="notice bad">{error}</div>}
          <div className="row">
            <button className="btn" onClick={() => setStep(2)}>
              <Icon name="back" /> Back
            </button>
            <button className="btn primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
