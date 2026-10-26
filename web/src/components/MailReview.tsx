import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MAIL_TIERS, type MailTier } from '@shared/deadlines.ts'
import { composeLetterCopy, envelopeTo, howSentText, type LetterCopy } from '@shared/letter-copy.ts'
import type { Association } from '../lib/auth'
import { Icon } from './Icon'
import { LetterPreview } from './LetterPreview'

export type MailStatus = {
  enabled: boolean
  test: boolean
  limit: number
  used: number
  price_note: string
  email?: { enabled: boolean; from: string | null; hoa: string[]; owner: string | null }
  // card: owners can pay by card; free: this user (an admin) may send at the site's expense
  payment?: { card: boolean; free: boolean; why: string | null }
  owner_prices?: Record<string, number>
}

/** Opt-out checkbox for emailing a copy of the letter to the HOA and the owner. */
export function EmailCopyOption({ on, set, mail, test }: { on: boolean; set: (v: boolean) => void; mail: MailStatus; test: boolean }) {
  const hoa = mail.email?.hoa ?? []
  const me = mail.email?.owner
  return (
    <label className="check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        <b>Email a copy</b> of the letter (PDF) {test ? 'to you only' : hoa.length ? `to the HOA (${hoa.join(', ')})` : 'to you'}
        {!test && hoa.length > 0 && me ? `, copying you (${me})` : test && me ? ` (${me})` : ''}.
        <br />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {test
            ? "Test mode: the board isn't emailed about letters that aren't really mailed."
            : hoa.length
              ? 'For reference only; the mailed letter is the formal delivery.'
              : 'No HOA email is set in Admin settings, so only you get a copy.'}
        </span>
      </span>
    </label>
  )
}

/** The email exactly as it will be sent (bracketed parts are filled in when the letter is sent). */
export function EmailPreview({ copy, from }: { copy: LetterCopy; from: string | null }) {
  const row = (label: string, value: string) => (
    <div className="email-row">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  )
  return (
    <div className="email-preview">
      <div className="email-head">
        {row('From', from ?? '(sender not set)')}
        {row('To', copy.to.join(', ') || '(nobody)')}
        {copy.cc.length > 0 && row('Cc', copy.cc.join(', '))}
        {copy.replyTo.length > 0 && row('Reply-to', copy.replyTo.join(', '))}
        {row('Subject', copy.subject)}
      </div>
      <div className="email-body">{copy.text}</div>
      <div className="email-attach">
        <Icon name="paperclip" size={14} /> {copy.attachment} <span className="muted">(the same PDF that's mailed)</span>
      </div>
    </div>
  )
}

type ReviewProps = {
  refNo: number
  title: string
  letter: string
  signature: string | null
  tier: MailTier
  returnAddress: string
  association: Association
  ownerName: string
  unit: number
  mail: MailStatus
  emailCopy: boolean
  paying: boolean // pays by card through Stripe before it's sent
  price: number
  busy: boolean
  error: string
  onBack: () => void
  onSend: () => void
  onDownload: () => void
}

/** Full-screen staging area: shows the envelope, the letter and the email copy before anything is sent. */
export function MailReview(p: ReviewProps) {
  const m = MAIL_TIERS[p.tier]
  const env = envelopeTo(p.association)
  const test = p.mail.test
  const certified = p.tier !== 'first_class'
  const copy = p.emailCopy
    ? composeLetterCopy({
        refNo: p.refNo,
        subject: p.title,
        ownerName: p.ownerName,
        ownerEmail: p.mail.email?.owner ?? null,
        hoa: p.mail.email?.hoa ?? [],
        howSent: howSentText(m.label, '[mailing date set by Lob]', certified ? '[USPS tracking number]' : null),
        test,
        letterText: p.letter,
      })
    : null

  // Lock the page behind the sheet; Escape goes back (unless a send is in progress)
  const latest = useRef(p)
  useEffect(() => {
    latest.current = p
  })
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !latest.current.busy && latest.current.onBack()
    window.addEventListener('keydown', esc)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', esc)
    }
  }, [])

  const price = `$${p.price.toFixed(2)}`
  const sendLabel = p.busy
    ? p.paying
      ? 'Opening the payment page…'
      : 'Sending…'
    : p.paying
      ? `Pay ${price} and send${copy ? ' with the email copy' : ''}`
      : `${test ? 'Send test letter' : `Mail it for real (~${price})`}${copy ? ' and email the copy' : ''}`

  // Rendered at the top of the page so no card or column can clip it
  return createPortal(
    <div className="review-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="review-sheet">
        <div className="review-top">
          <button className="btn ghost sm" onClick={p.onBack} disabled={p.busy} aria-label="Back to the options">
            <Icon name="back" /> Back
          </button>
          <h2 id="review-title" style={{ margin: 0, flex: 1 }}>Review before sending</h2>
          <span className={`badge ${test ? 'warn' : 'bad'}`}>{test ? 'Test mode' : 'Live'}</span>
        </div>

        <div className="review-scroll">
          <p className="ink2" style={{ marginTop: 0 }}>
            Nothing has been sent yet. Check the envelope, the letter and the email below.{' '}
            {p.paying
              ? `The button at the bottom takes you to Stripe's secure page to pay ${price}. As soon as the payment goes through, the letter goes to Lob${copy ? ' and the email copy goes out' : ''}, and you come back here.`
              : `The button at the bottom does both: it sends the letter to Lob${copy ? ' and then emails the copy' : ''}.`}
          </p>

          <section className="review-section">
            <h3><span className="step-num">1</span> Letter by {m.label} <span className="muted" style={{ fontWeight: 400 }}>· {p.paying ? `${price} by card` : `about ${price}`}</span></h3>
            <div className="envelope">
              <div>
                <div className="muted env-label">From</div>
                <div className="env-addr">{p.returnAddress.trim() || `${p.ownerName}\n428 Hill Street, Unit ${p.unit}\nSanta Monica, CA 90405`}</div>
              </div>
              <div>
                <div className="muted env-label">To</div>
                <div className="env-addr">{[env.name, env.company, env.street, env.cityStateZip].join('\n')}</div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Lob adds a blank address page in front, prints in black and white, and hands it to USPS
              {certified ? ' with a Certified Mail tracking number' : ''}.{' '}
              {test ? 'In test mode nothing is printed or mailed.' : ''}
            </p>
            <LetterPreview text={p.letter} signature={p.signature} />
            <button className="btn sm mt" onClick={p.onDownload}><Icon name="download" /> Open the exact PDF</button>
          </section>

          <section className="review-section">
            <h3><span className="step-num">2</span> Email copy</h3>
            {copy ? (
              <>
                <EmailPreview copy={copy} from={p.mail.email?.from ?? null} />
                <p className="muted" style={{ fontSize: '0.84rem' }}>
                  Sent right after Lob accepts the letter. The bracketed parts are filled in then.
                  {test && ' Test mode: it goes to you only, never to the board.'}
                </p>
              </>
            ) : (
              <p className="muted">No email copy: you unticked it.</p>
            )}
          </section>
        </div>

        <div className="review-foot">
          {p.paying ? (
            <div className={`notice ${test ? 'warn' : 'bad'}`} style={{ margin: 0 }}>
              {test ? (
                <>
                  <b>Test mode:</b> pay with Stripe's test card 4242 4242 4242 4242 (any future date, any CVC). Nothing is charged or
                  mailed.
                </>
              ) : (
                <>
                  <b>Live:</b> you pay {price} by card and a real letter is mailed by USPS. If the mailing service rejects it, the payment
                  is refunded automatically.
                </>
              )}
            </div>
          ) : (
            !test && (
              <div className="notice bad" style={{ margin: 0 }}>
                <b>Live:</b> this mails a real letter through USPS and charges the site's Lob account about {price}.
              </div>
            )
          )}
          {p.error && <div className="notice bad" style={{ margin: 0 }}>{p.error}</div>}
          <div className="row">
            <button className="btn primary" style={{ whiteSpace: 'normal', height: 'auto' }} disabled={p.busy} onClick={p.onSend}>
              <Icon name="send" /> {sendLabel}
            </button>
            <button className="btn ghost" disabled={p.busy} onClick={p.onBack}>Back</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
