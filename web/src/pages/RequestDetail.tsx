import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { computeDeadline, MAIL_TIERS, METHODS, requestType, todayISO, urgency, type MailTier, type Method } from '@shared/deadlines.ts'
import { Attachments } from '../components/Attachments'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/RequestBits'
import { useAssociation, useProfile } from '../lib/auth'
import { dueText, fmtDate, fmtDateTime, uspsTrackingUrl } from '../lib/format'
import { letterSubject } from '../lib/letters'
import { bytesToBase64, downloadBytes, letterPdf } from '../lib/pdf'
import { errMsg, supabase, type RequestEvent, type RequestRow } from '../lib/supabase'

type Panel = null | 'sent' | 'received' | 'answered' | 'deemed' | 'note' | 'mail'
type MailStatus = { enabled: boolean; test: boolean; limit: number; used: number; price_note: string }

const EVENT_LABEL: Record<string, string> = {
  created: 'Draft created',
  sent: 'Sent',
  received: 'Received by HOA',
  acknowledged: 'HOA acknowledged',
  answered: 'HOA answered',
  deemed_denied: 'Deemed denied',
  deemed_approved: 'Deemed approved',
  note: 'Note',
  tracking: 'Tracking update',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
  reopened: 'Reopened',
}

export default function RequestDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const profile = useProfile()
  const association = useAssociation()
  const [r, setR] = useState<RequestRow | null>(null)
  const [events, setEvents] = useState<RequestEvent[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // form state shared by the panels
  const [method, setMethod] = useState<Method>('certified_rr')
  const [date, setDate] = useState(todayISO())
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [letterDraft, setLetterDraft] = useState('')
  const [returnAddress, setReturnAddress] = useState(profile.mailing_address ?? '')
  const [mail, setMail] = useState<MailStatus | null>(null)
  const [tier, setTier] = useState<MailTier>('certified')

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select('*').eq('id', id).maybeSingle()
    if (!data) return setNotFound(true)
    setR(data as RequestRow)
    setMethod(((data as RequestRow).method as Method) ?? 'certified_rr')
    setTracking((data as RequestRow).tracking_number ?? '')
    const { data: ev } = await supabase.from('request_events').select('*').eq('request_id', id).order('at', { ascending: false })
    setEvents((ev as RequestEvent[]) ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Whether the site can mail letters (a Lob key is configured) and this unit's monthly usage
  useEffect(() => {
    supabase.functions.invoke('send-letter', { body: { status: true } }).then(({ data }) => {
      if (data && typeof data.enabled === 'boolean') setMail(data as MailStatus)
    })
  }, [])

  useEffect(() => {
    const rt = r ? requestType(r.type) : undefined
    if (rt) setTier(rt.mailTier)
  }, [r?.type]) // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) return <div className="empty"><h3>Request not found</h3><Link to="/requests">Back to requests</Link></div>
  if (!r) return <div className="empty">Loading…</div>

  const t = requestType(r.type)
  const canEdit = r.unit_id === profile.unit_id
  const u = urgency(r.status, r.due_date)
  const mailEnabled = Boolean(mail?.enabled)
  const mailLeft = mail ? Math.max(0, mail.limit - mail.used) : 0

  async function update(patch: Partial<RequestRow>, eventKind: string, eventNote?: string) {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('requests').update(patch).eq('id', r!.id)
    if (!error) {
      await supabase.from('request_events').insert({ request_id: r!.id, kind: eventKind, note: eventNote ?? null, created_by: profile.id })
    }
    setBusy(false)
    if (error) return setError(errMsg(error))
    setPanel(null)
    setNote('')
    await load()
  }

  async function pdf() {
    const bytes = await letterPdf(r!.letter_body ?? '', { footer: `Owner request #${r!.ref_no}` })
    return bytes
  }

  async function downloadPdf() {
    downloadBytes(await pdf(), `request-${r!.ref_no}-${r!.type}.pdf`)
  }

  function emailCopy() {
    const to = association.email
    const subject = `${letterSubject(r!.type, r!.letter_fields)} — Unit ${r!.unit_id}`
    const body = r!.letter_body ?? ''
    // mailto bodies are limited in some clients; long letters get truncated with a pointer to the PDF
    const max = 1800
    const text = body.length > max ? body.slice(0, max) + '\n\n[Full letter attached as PDF]' : body
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
  }

  function markSent() {
    const d = computeDeadline({ type: r!.type, method, sentDate: date })
    update(
      {
        status: 'sent',
        method,
        sent_date: date,
        tracking_number: tracking.trim() || null,
        carrier: tracking.trim() ? 'USPS' : null,
        due_date: d.dueDate,
        received_estimated: d.startEstimated,
        received_date: d.startEstimated ? null : d.startDate,
      },
      'sent',
      [METHODS[method].label, tracking.trim() ? `tracking ${tracking.trim()}` : '', note].filter(Boolean).join(' · '),
    )
  }

  function markReceived() {
    if (r!.sent_date && date < r!.sent_date) return setError('The delivery date can’t be before the date it was sent.')
    const d = computeDeadline({ type: r!.type, method: r!.method as Method, sentDate: r!.sent_date, receivedDate: date })
    update(
      { status: 'received', received_date: date, received_estimated: false, due_date: d.dueDate },
      'received',
      [`Delivered ${fmtDate(date)}`, note].filter(Boolean).join(' · '),
    )
  }

  async function sendViaService() {
    setBusy(true)
    setError('')
    try {
      const bytes = await pdf()
      const { data, error } = await supabase.functions.invoke('send-letter', {
        body: { request_id: r!.id, pdf_base64: bytesToBase64(bytes), return_address: returnAddress, service: tier },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
        throw new Error(detail?.error ?? error.message)
      }
      if (data?.error) throw new Error(data.error)
      setPanel(null)
      setMail((m) => (m ? { ...m, used: m.used + 1 } : m))
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveLetter() {
    await update({ letter_body: letterDraft }, 'note', 'Letter edited')
    setEditing(false)
  }

  async function deleteDraft() {
    if (!confirm('Delete this draft?')) return
    await supabase.from('requests').delete().eq('id', r!.id)
    nav('/requests')
  }

  const deemedOutcome = t?.ifMissed.toLowerCase().includes('deemed approved') || t?.ifMissed.toLowerCase().includes('in your favor') || t?.ifMissed.toLowerCase().includes('deemed granted')
    ? 'deemed_approved'
    : t?.ifMissed.toLowerCase().includes('deemed')
      ? 'deemed_denied'
      : null

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link to="/requests" className="muted" style={{ fontSize: '0.88rem' }}>
            ← Requests
          </Link>
          <h1>
            #{r.ref_no} · {r.title}
          </h1>
          <div className="row">
            <StatusBadge r={r} />
            <span className="muted" style={{ fontSize: '0.88rem' }}>
              {t?.label} · Unit {r.unit_id} · {r.visibility === 'private' ? 'Private to unit' : 'Visible to owners'}
            </span>
          </div>
        </div>
        {canEdit && (
          <div className="row">
            <button className="btn" onClick={downloadPdf}>
              <Icon name="download" /> PDF
            </button>
            <button className="btn" onClick={emailCopy} title={association.email ? '' : 'Set the manager email in Admin settings'}>
              <Icon name="mail" /> Email copy
            </button>
          </div>
        )}
      </div>

      {error && <div className="notice bad mb">{error}</div>}

      {u === 'overdue' && (
        <div className="notice bad mb">
          <b>The HOA is past its deadline</b> ({fmtDate(r.due_date)}). {r.if_missed}
          {canEdit && deemedOutcome && (
            <div className="row mt">
              <button className="btn sm" onClick={() => setPanel('deemed')}>
                Record as {deemedOutcome === 'deemed_approved' ? 'deemed approved' : 'deemed denied'}
              </button>
              <Link className="btn sm" to={`/requests/new?type=${r.type === 'meet_confer' ? 'adr_request' : 'meet_confer'}&description=${encodeURIComponent(`Follow-up to owner request #${r.ref_no} (${r.title}), sent ${fmtDate(r.sent_date)} and not answered by the deadline of ${fmtDate(r.due_date)}.`)}`}>
                Escalate: {r.type === 'meet_confer' ? 'Request for Resolution' : 'Meet & confer'}
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card">
            <h3>Deadline</h3>
            {r.status === 'draft' ? (
              <p className="ink2">
                {t?.days
                  ? `Once the HOA receives this, it has ${t.days} ${t.dayType} days to respond.`
                  : 'No deadline for this type of letter.'}
              </p>
            ) : (
              <table className="list">
                <tbody>
                  <tr><td className="muted">Sent</td><td>{fmtDate(r.sent_date)} · {r.method ? METHODS[r.method as Method]?.label : '—'}</td></tr>
                  <tr>
                    <td className="muted">Received by HOA</td>
                    <td>
                      {r.received_date ? fmtDate(r.received_date) : r.received_estimated ? 'Not confirmed yet (deadline uses an estimate)' : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Due</td>
                    <td>
                      <b>{fmtDate(r.due_date)}</b> {r.due_date && <span className="muted">· {dueText(r.status, r.due_date)}</span>}
                      {r.received_estimated && r.due_date && <div className="muted" style={{ fontSize: '0.82rem' }}>Estimated. Record the delivery date to make it exact.</div>}
                    </td>
                  </tr>
                  {r.answered_date && <tr><td className="muted">Answered</td><td>{fmtDate(r.answered_date)}</td></tr>}
                  {r.tracking_number && (
                    <tr>
                      <td className="muted">Tracking</td>
                      <td>
                        <a href={uspsTrackingUrl(r.tracking_number)} target="_blank" rel="noreferrer" className="mono">
                          {r.tracking_number} <Icon name="external" size={13} />
                        </a>
                        {r.tracking_status && <div className="muted" style={{ fontSize: '0.85rem' }}>{r.tracking_status}{r.tracking_updated_at ? ` · ${fmtDateTime(r.tracking_updated_at)}` : ''}</div>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <p className="muted mt" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
              {t?.legalBasis}
              {t?.days ? ` · ${t.days} ${t.dayType} days from receipt${t.dayType === 'business' ? ', excluding weekends and California holidays' : '; a deadline on a weekend or holiday moves to the next business day'}.` : ''}
            </p>
          </div>

          {canEdit && (
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Next step</h3>
              {r.status === 'draft' && (
                <>
                  <p className="ink2" style={{ margin: 0 }}>
                    Download the PDF, sign it, and send it. {t?.deliveryNote ?? 'Certified Mail with a return receipt gives the best proof.'}
                  </p>
                  <div className="row">
                    <button className="btn primary" onClick={() => setPanel('sent')}>
                      <Icon name="send" /> I sent it
                    </button>
                    {mailEnabled && (
                      <button className="btn" onClick={() => setPanel('mail')}>
                        <Icon name="truck" /> Mail it for me
                      </button>
                    )}
                    <button className="btn danger ghost" onClick={deleteDraft}>
                      <Icon name="trash" /> Delete draft
                    </button>
                  </div>
                  {!mailEnabled && (
                    <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                      No printer? Upload the PDF to an online certified-mail service (for example LetterStream, Mailform, or
                      CertifiedMail.com). They print and mail it and give you a tracking number to enter here.
                    </p>
                  )}
                </>
              )}
              {['sent', 'received', 'acknowledged'].includes(r.status) && (
                <div className="row">
                  {r.status === 'sent' && (
                    <button className="btn primary" onClick={() => setPanel('received')}>
                      <Icon name="check" /> Record delivery date
                    </button>
                  )}
                  <button className={`btn ${r.status !== 'sent' ? 'primary' : ''}`} onClick={() => setPanel('answered')}>
                    HOA responded
                  </button>
                  {r.status !== 'acknowledged' && (
                    <button className="btn" onClick={() => update({ status: 'acknowledged' }, 'acknowledged')}>
                      HOA acknowledged it
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => update({ status: 'withdrawn' }, 'withdrawn')}>
                    Withdraw
                  </button>
                </div>
              )}
              {['answered', 'deemed_denied', 'deemed_approved', 'closed', 'withdrawn'].includes(r.status) && (
                <div className="row">
                  {r.status !== 'closed' && (
                    <button className="btn" onClick={() => update({ status: 'closed' }, 'closed')}>
                      Close
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => update({ status: r.received_date || r.received_estimated ? 'received' : 'sent' }, 'reopened')}>
                    Reopen
                  </button>
                </div>
              )}

              {panel === 'sent' && (
                <div className="stack card" style={{ background: 'var(--surface-2)' }}>
                  <label className="field">
                    Method
                    <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                      {Object.entries(METHODS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    </select>
                    <span className="hint">{METHODS[method].note}</span>
                  </label>
                  <label className="field">
                    Date sent / delivered
                    <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  {['certified', 'certified_rr', 'online_certified'].includes(method) && (
                    <label className="field">
                      USPS tracking number
                      <input className="mono" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="9407 1000 0000 0000 0000 00" />
                      <span className="hint">On the green certified-mail receipt (PS Form 3800), or from the online service.</span>
                    </label>
                  )}
                  <label className="field">
                    Note (optional)
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Hand-delivered to the manager; signed receipt attached" />
                  </label>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    {(() => {
                      const d = computeDeadline({ type: r.type, method, sentDate: date })
                      return d.dueDate ? `Estimated deadline: ${fmtDate(d.dueDate)}. ${d.explanation}` : d.explanation
                    })()}
                  </p>
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={markSent}>Save</button>
                    <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {panel === 'mail' && (
                <div className="stack card" style={{ background: 'var(--surface-2)' }}>
                  <p style={{ margin: 0 }}>
                    The mailing service (Lob) prints this letter and mails it by USPS to {association.care_of}, {association.street},{' '}
                    {association.city_state_zip}. USPS scans appear in the history automatically, and the deadline updates with them.
                  </p>
                  {mail?.test ? (
                    <div className="notice warn">Test mode: the service will accept this letter but won't actually mail it.</div>
                  ) : (
                    <div className="notice bad">
                      <b>Live:</b> this mails a real letter through USPS and charges the site's Lob account about $
                      {MAIL_TIERS[tier].price.toFixed(2)}.
                    </div>
                  )}
                  <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
                    <legend className="field" style={{ marginBottom: 6, fontSize: '0.88rem', fontWeight: 500, color: 'var(--ink-2)' }}>
                      How to mail it
                    </legend>
                    {(Object.keys(MAIL_TIERS) as MailTier[]).map((k) => {
                      const m = MAIL_TIERS[k]
                      const blocked = k === 'first_class' && t?.requiresCertified
                      return (
                        <label key={k} className="check card" style={{ padding: '10px 12px', opacity: blocked ? 0.55 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}>
                          <input type="radio" name="tier" checked={tier === k} disabled={blocked} onChange={() => setTier(k)} />
                          <span>
                            <b>{m.label}</b> · about ${m.price.toFixed(2)}
                            {t?.mailTier === k && <span className="badge brand" style={{ marginLeft: 8 }}>Recommended for this request</span>}
                            <br />
                            <span className="muted" style={{ fontSize: '0.85rem' }}>
                              {blocked ? 'Not allowed here: CC&R §7.3 requires certified mail or personal delivery.' : `${m.summary} ${m.deadlines}`}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </fieldset>
                  <label className="field">
                    Return address
                    <textarea style={{ minHeight: 70 }} value={returnAddress} onChange={(e) => setReturnAddress(e.target.value)} placeholder={`Your name\n428 Hill Street, Unit ${profile.unit_id}\nSanta Monica, CA 90405`} />
                  </label>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    {mail?.price_note || 'The mailing service charges per letter; the site admin covers or splits the cost.'} Your unit can mail{' '}
                    {mailLeft} more {mailLeft === 1 ? 'letter' : 'letters'} this month.
                  </p>
                  <div className="row">
                    <button
                      className="btn primary"
                      style={{ whiteSpace: 'normal', textAlign: 'center', height: 'auto' }}
                      disabled={busy || mailLeft === 0}
                      onClick={() => {
                        const m = MAIL_TIERS[tier]
                        if (mail?.test || confirm(`Mail this letter for real by ${m.label}? About $${m.price.toFixed(2)} will be charged.`)) sendViaService()
                      }}
                    >
                      {busy ? 'Sending…' : `Send by ${MAIL_TIERS[tier].label} (~$${MAIL_TIERS[tier].price.toFixed(2)})`}
                    </button>
                    <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {panel === 'received' && (
                <div className="stack card" style={{ background: 'var(--surface-2)' }}>
                  <label className="field">
                    Date the HOA received it
                    <input type="date" value={date} min={r.sent_date ?? undefined} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
                    <span className="hint">From USPS tracking ("Delivered") or the signed return receipt.</span>
                  </label>
                  {r.tracking_number && (
                    <a href={uspsTrackingUrl(r.tracking_number)} target="_blank" rel="noreferrer">
                      Check USPS tracking <Icon name="external" size={13} />
                    </a>
                  )}
                  <label className="field">
                    Note (optional)
                    <input value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={markReceived}>Save</button>
                    <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {panel === 'answered' && (
                <div className="stack card" style={{ background: 'var(--surface-2)' }}>
                  <label className="field">
                    Date of the HOA's response
                    <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label className="field">
                    What they said or provided
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facts only, e.g. Provided policy forms CMP-4101 and CMP-4696; did not provide invoices." />
                  </label>
                  <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Attach the response below so other owners can see it.</p>
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={() => update({ status: 'answered', answered_date: date, outcome: note || null }, 'answered', note)}>Save</button>
                    <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {panel === 'deemed' && deemedOutcome && (
                <div className="stack card" style={{ background: 'var(--surface-2)' }}>
                  <p style={{ margin: 0 }}>
                    Record that the deadline passed without a written response, so the request is{' '}
                    <b>{deemedOutcome === 'deemed_approved' ? 'deemed approved' : 'deemed denied'}</b> under {t?.legalBasis}.
                  </p>
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={() => update({ status: deemedOutcome, outcome: `No response by ${fmtDate(r.due_date)}` }, deemedOutcome, `No response by ${fmtDate(r.due_date)}`)}>Confirm</button>
                    <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h3>Summary</h3>
            <p className="ink2" style={{ whiteSpace: 'pre-wrap' }}>{r.summary || '—'}</p>
            {r.outcome && (
              <>
                <h3>Outcome</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{r.outcome}</p>
              </>
            )}
            {canEdit && (
              <label className="check mt">
                <input
                  type="checkbox"
                  checked={r.visibility === 'private'}
                  onChange={(e) => update({ visibility: e.target.checked ? 'private' : 'owners' }, 'note', e.target.checked ? 'Made private' : 'Shared with owners')}
                />
                <span>Private to my unit</span>
              </label>
            )}
          </div>

          {r.type === 'membership_list' && (
            <div className="notice warn">
              <b>Keep the list private.</b> When the HOA sends it, attach it here with this request set to private, not in the shared
              Document library. Use it only to contact owners about association matters (Corp. Code §8338).
            </div>
          )}

          <Attachments requestId={r.id} canUpload={canEdit} />
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>History</h3>
              {canEdit && panel !== 'note' && <button className="btn sm" onClick={() => setPanel('note')}>Add note</button>}
            </div>
            {panel === 'note' && (
              <div className="stack mt">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called LBPM; told the request was forwarded to the Board" />
                <div className="row">
                  <button className="btn primary sm" disabled={!note.trim() || busy} onClick={() => update({}, 'note', note)}>Add</button>
                  <button className="btn ghost sm" onClick={() => setPanel(null)}>Cancel</button>
                </div>
              </div>
            )}
            <ul className="timeline mt">
              {events.map((e) => (
                <li key={e.id}>
                  <div className="when">{fmtDateTime(e.at)}</div>
                  <div><b>{EVENT_LABEL[e.kind] ?? e.kind}</b>{e.note ? ` — ${e.note.replace(/\s*\[[^\]]*\]$/, '')}` : ''}</div>
                </li>
              ))}
            </ul>
          </div>

          {(canEdit || r.status !== 'draft') && (
            <div className="card">
              <div className="row between">
                <h3 style={{ margin: 0 }}>Letter</h3>
                {canEdit && r.status === 'draft' && !editing && (
                  <button className="btn sm" onClick={() => { setLetterDraft(r.letter_body ?? ''); setEditing(true) }}>Edit</button>
                )}
              </div>
              {editing ? (
                <div className="stack mt">
                  <textarea className="letter" style={{ minHeight: '50vh' }} value={letterDraft} onChange={(e) => setLetterDraft(e.target.value)} />
                  <div className="row">
                    <button className="btn primary sm" onClick={saveLetter}>Save</button>
                    <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : r.visibility === 'owners' || canEdit ? (
                <div className="letter mt">{(r.letter_body ?? '').replace(/\f/g, '\n— — — — —\n')}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
