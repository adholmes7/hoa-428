import { addDays, requestType, todayISO } from '@shared/deadlines.ts'
import type { Association } from './auth'

export type FieldDef = {
  key: string
  label: string
  kind: 'text' | 'textarea' | 'checklist' | 'date'
  hint?: string
  options?: string[]
  required?: boolean
  placeholder?: string
}

export const RECORD_ITEMS = [
  'Full insurance policies, including all forms and endorsements (e.g. State Farm CMP-4101 and CMP-4696)',
  'Current earthquake and umbrella insurance policies',
  'Any claims or notices of loss submitted to the association’s insurers, and related correspondence',
  'Invoices, receipts, and contracts for plumbing work, leak investigations, and roof repairs',
  'Records showing which fund (operating or reserve) paid for each of those items',
  'Operating and reserve account bank statements',
  'Any reserve transfer or borrowing resolutions (Civ. Code §5515)',
  'Minutes of board meetings, including those approving the above expenditures',
  'Interim and year-end financial statements and the general ledger',
  'Bylaws, Rules & Regulations, Fine Policy, Architectural Guidelines, and election rules',
  'Plumbing maintenance and repair records',
  'The most recent reserve study and any updates',
]

const DESCRIBE: FieldDef = { key: 'description', label: 'Describe the issue', kind: 'textarea', required: true }

export const LETTER_FIELDS: Record<string, FieldDef[]> = {
  records_current: [
    { key: 'items', label: 'Records requested', kind: 'checklist', options: RECORD_ITEMS },
    { key: 'other_items', label: 'Other records (one per line)', kind: 'textarea', placeholder: 'e.g. Contract with the roofing contractor for 2026 roof sealing' },
    { key: 'period', label: 'Time period', kind: 'text', placeholder: 'e.g. January 1, 2024 to present', required: true },
  ],
  records_prior: [
    { key: 'items', label: 'Records requested', kind: 'checklist', options: RECORD_ITEMS },
    { key: 'other_items', label: 'Other records (one per line)', kind: 'textarea' },
    { key: 'period', label: 'Time period', kind: 'text', placeholder: 'e.g. fiscal years 2024 and 2025', required: true },
  ],
  minutes: [
    { key: 'meetings', label: 'Which meetings', kind: 'textarea', placeholder: 'e.g. All open board meetings from January 2025 to present', required: true },
  ],
  insurance_review: [
    { key: 'policies', label: 'Policies to review', kind: 'textarea', required: true, placeholder: 'e.g. State Farm policy 92-C0-4666-9, all forms and endorsements; earthquake and umbrella policies' },
  ],
  maintenance: [
    { key: 'location', label: 'Location', kind: 'text', required: true, placeholder: 'e.g. Common-area plumbing in the wall/subfloor of Unit 18' },
    { key: 'first_noticed', label: 'First noticed', kind: 'date' },
    DESCRIBE,
    { key: 'asks', label: 'What you are asking the Board to do', kind: 'textarea', required: true, placeholder: 'e.g. Send a licensed plumber for leak detection; confirm in writing that the Association will repair the pipe and subfloor' },
  ],
  meet_confer: [
    { ...DESCRIBE, label: 'Brief description of the dispute', hint: 'Stick to facts and the governing-document sections involved.' },
    { key: 'resolution', label: 'Resolution you are seeking', kind: 'textarea' },
  ],
  adr_request: [
    { ...DESCRIBE, label: 'Brief description of the dispute' },
    { key: 'adr_form', label: 'Proposed form of ADR', kind: 'text', placeholder: 'Mediation with a neutral mediator, costs shared equally' },
  ],
  architectural: [
    { key: 'improvement', label: 'Proposed improvement', kind: 'textarea', required: true, placeholder: 'e.g. Like-for-like replacement of kitchen flooring and underlayment damaged by a water leak' },
    { key: 'materials', label: 'Materials and specifications', kind: 'textarea', placeholder: 'Product, sound rating (IIC/STC) of underlayment, area in sq ft' },
    { key: 'contractor', label: 'Contractor', kind: 'text' },
    { key: 'schedule', label: 'Proposed schedule', kind: 'text' },
  ],
  architectural_appeal: [
    { key: 'decision_date', label: 'Date of the committee decision', kind: 'date', required: true },
    { key: 'reasons', label: 'Why the decision should be reversed', kind: 'textarea', required: true },
  ],
  estoppel: [{ key: 'improvements', label: 'Improvements to be certified', kind: 'textarea', required: true }],
  lease: [
    { key: 'term', label: 'Proposed lease term', kind: 'text', required: true },
    { key: 'details', label: 'Other details', kind: 'textarea' },
  ],
  seller_docs: [
    { key: 'escrow', label: 'Escrow / title contact (optional)', kind: 'text' },
    { key: 'details', label: 'Notes', kind: 'textarea' },
  ],
  special_meeting: [
    { key: 'purpose', label: 'Purpose of the meeting', kind: 'textarea', required: true, hint: 'The notice may only cover business stated in the petition.' },
    { key: 'petitioners', label: 'Petitioning owners (name and unit, one per line)', kind: 'textarea', required: true, hint: 'At least 5% of the voting power: 2 of 22 owners. Each should sign the printed letter.' },
  ],
  general: [
    { key: 'subject', label: 'Subject', kind: 'text', required: true },
    { key: 'body', label: 'Letter', kind: 'textarea', required: true },
  ],
}

export type LetterContext = {
  ownerName: string
  unit: number
  ownerAddress: string
  ownerEmail: string
  date: string
  association: Association
  ccr125?: string
  method: string
}

export function longDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function lines(s: unknown): string[] {
  return String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function str(f: Record<string, unknown>, k: string) {
  return String(f[k] ?? '').trim()
}

const METHOD_LINE: Record<string, string> = {
  personal: 'Via personal delivery',
  first_class: 'Via first-class U.S. Mail',
  certified: 'Via U.S. Certified Mail',
  certified_rr: 'Via U.S. Certified Mail, Return Receipt Requested',
  online_certified: 'Via U.S. Certified Mail',
  email_consent: 'Via email (electronic delivery consented to in writing)',
  email_copy: 'Via email',
}

export function letterSubject(type: string, f: Record<string, unknown>): string {
  switch (type) {
    case 'records_current':
    case 'records_prior':
      return 'Request to Inspect and Copy Association Records (Civil Code §5200 et seq.)'
    case 'minutes':
      return 'Request for Board Meeting Minutes (Civil Code §§4950, 5210)'
    case 'insurance_review':
      return 'Request to Review Association Insurance Policies'
    case 'maintenance':
      return `Written Notice of Common Area Maintenance Issue: ${str(f, 'location')}`
    case 'meet_confer':
      return 'Request for Internal Dispute Resolution (Meet and Confer) under CC&R Section 12.5'
    case 'adr_request':
      return 'Request for Resolution (Civil Code §5935)'
    case 'architectural':
      return 'Request for Architectural Approval (CC&R Sections 5.4(b) and 7.3)'
    case 'architectural_appeal':
      return 'Appeal of Architectural Decision (CC&R Section 7.8)'
    case 'estoppel':
      return 'Written Demand for Estoppel Certificate (CC&R Section 7.13)'
    case 'lease':
      return 'Request for Approval to Lease (CC&R Section 5.3)'
    case 'seller_docs':
      return 'Request for Documents Required for Sale (Civil Code §§4525, 4530)'
    case 'special_meeting':
      return 'Petition for Special Meeting of the Members'
    default:
      return str(f, 'subject') || 'Letter to the Board of Directors'
  }
}

function bodyParagraphs(type: string, f: Record<string, unknown>, ctx: LetterContext): string[] {
  const p: string[] = []
  const items = [...((f.items as string[]) ?? []), ...lines(f.other_items)]
  const itemList = items.map((x, i) => `   ${i + 1}. ${x}`).join('\n')

  switch (type) {
    case 'records_current':
    case 'records_prior': {
      p.push(
        `As an owner and member of the Association (Unit ${ctx.unit}), I request to inspect and receive copies of the following association records under Civil Code Sections 5200 through 5240 and CC&R Section 3.10, for the period ${str(f, 'period')}:`,
      )
      if (itemList) p.push(itemList)
      p.push(
        'I request that the records be provided electronically by email where they exist in electronic form (Civil Code §5205). If any copying costs apply, please tell me the amount in advance.',
      )
      p.push(
        type === 'records_current'
          ? 'For records from the current fiscal year, Civil Code §5210(b)(1) requires that they be made available within ten (10) business days of receipt of this request.'
          : 'For records from the previous two fiscal years, Civil Code §5210(b)(2) requires that they be made available within thirty (30) calendar days of receipt of this request.',
      )
      p.push(
        'If the Association withholds or redacts any record, please identify it and state the legal basis in writing (Civil Code §5215). These records are requested for purposes reasonably related to my interests as a member.',
      )
      break
    }
    case 'minutes':
      p.push(
        `As an owner and member of the Association (Unit ${ctx.unit}), I request copies of the minutes, draft minutes, or minute summaries of the following meetings under Civil Code Sections 4950 and 5210(b)(4):`,
      )
      p.push(str(f, 'meetings'))
      p.push('Please provide them by email. Minutes must be available to members within 30 days of each meeting (Civil Code §4950(a)).')
      break
    case 'insurance_review':
      p.push(
        `As an owner and member of the Association (Unit ${ctx.unit}), I request to review the following Association insurance policies, including all declarations, coverage forms, and endorsements, as provided in the Association's annual budget report and Civil Code Section 5300, and as association records under Civil Code Section 5200 et seq.:`,
      )
      p.push(str(f, 'policies'))
      p.push('Please provide complete copies by email, or propose a time for inspection within ten (10) business days.')
      break
    case 'maintenance':
      p.push(`This letter is written notice to the Board of a maintenance issue in the Common Area: ${str(f, 'location')}.`)
      if (str(f, 'first_noticed')) p.push(`First noticed: ${longDate(str(f, 'first_noticed'))}.`)
      p.push(str(f, 'description'))
      p.push(
        'Under CC&R Section 6.3(c), the Association is responsible for the maintenance, repair and replacement of Common Area components, including "pipes, ducts, flues, chutes, conduits, wires, sprinkler systems and other utility installation, wherever located (except outlets when located within a Unit)," floors (as distinguished from interior surfaces), and roofs. Under Section 2.7(d), damage to utility lines from causes other than an owner\'s negligence, "including ordinary wear and tear and deterioration from lapse of time," is repaired by the Association as a common expense.',
      )
      p.push(`I ask that the Board:\n${lines(f.asks).map((x) => `   • ${x}`).join('\n')}`)
      p.push('Please respond in writing with the Association\'s plan and timeline. Any entry into my unit should be scheduled with at least 48 hours\' notice except in an emergency (CC&R §3.5(e)).')
      break
    case 'meet_confer':
      p.push(
        'Pursuant to Section 12.5 of the Amended and Restated Declaration of Covenants, Conditions and Restrictions ("CC&Rs") and Civil Code Sections 5900 through 5920, I request Internal Dispute Resolution and ask that the Association meet and confer with me in an effort to resolve the following dispute.',
      )
      p.push(`(A) Brief description of the dispute:\n${str(f, 'description')}`)
      if (str(f, 'resolution')) p.push(`Resolution I am seeking:\n${str(f, 'resolution')}`)
      p.push('(B) Request: I request Internal Dispute Resolution pursuant to CC&R Section 12.5.')
      p.push('(C) A copy of CC&R Section 12.5 is attached to this letter.')
      p.push(
        '(D) Notice: The Association is required to respond to this request in writing within thirty (30) days of receipt, or the request will be deemed rejected. Under Section 12.5(b)(ii), the Association may not refuse a request to meet and confer, and the Board must designate one director to meet with me (Section 12.5(b)(v)). The Association may not charge a fee for this process (Section 12.5(b)(ix)).',
      )
      break
    case 'adr_request':
      p.push(
        'This is a Request for Resolution under Civil Code Section 5935. I request alternative dispute resolution (ADR) of the following dispute before any further action is taken.',
      )
      p.push(`1. Brief description of the dispute:\n${str(f, 'description')}`)
      p.push(
        `2. Request for alternative dispute resolution: I propose ${str(f, 'adr_form') || 'mediation with a neutral mediator, with costs shared equally'}.`,
      )
      p.push(
        '3. Notice: The Association is required to respond to this Request for Resolution within thirty (30) days of receipt, or it will be deemed rejected (Civil Code §5935(c)). If accepted, the ADR must be completed within ninety (90) days of receipt of the acceptance unless extended by written stipulation (Civil Code §5940(b)).',
      )
      break
    case 'architectural':
      p.push(
        `I request the Board's prior written approval under CC&R Sections 5.4(b) and 7.3 for the following improvement to Unit ${ctx.unit}:`,
      )
      p.push(str(f, 'improvement'))
      if (str(f, 'materials')) p.push(`Materials and specifications:\n${str(f, 'materials')}`)
      if (str(f, 'contractor')) p.push(`Contractor: ${str(f, 'contractor')}`)
      if (str(f, 'schedule')) p.push(`Proposed schedule: ${str(f, 'schedule')}`)
      p.push(
        'Under CC&R Section 7.3 the Board must approve or disapprove this request in writing within sixty (60) days of submission. Please provide a written, dated receipt for this submission. Under Civil Code Section 4765, any decision must be in writing, and a disapproval must explain the reasons and the procedure for reconsideration.',
      )
      break
    case 'architectural_appeal':
      p.push(
        `I appeal to the Board the architectural decision dated ${longDate(str(f, 'decision_date'))} disapproving my submission for Unit ${ctx.unit}, under CC&R Section 7.8.`,
      )
      p.push(str(f, 'reasons'))
      p.push(
        'Under Section 7.8, the Board must render its written decision within thirty (30) days of receipt of this appeal. If it does not, the appeal is deemed decided in my favor.',
      )
      break
    case 'estoppel':
      p.push(
        `Under CC&R Section 7.13, I demand an estoppel certificate stating that the following improvements to Unit ${ctx.unit} comply with the Governing Documents:`,
      )
      p.push(str(f, 'improvements'))
      p.push('Please let me know any required fee. Section 7.13 requires the certificate within thirty (30) days of this written demand and payment of any fee.')
      break
    case 'lease':
      p.push(`I request the Board's written approval to lease Unit ${ctx.unit} for the following term: ${str(f, 'term')}.`)
      if (str(f, 'details')) p.push(str(f, 'details'))
      p.push(
        'Under the leasing provisions of CC&R Section 5.3, the Board must respond within ten (10) days. If no response is provided to my address of record within that time, permission is deemed granted.',
      )
      break
    case 'seller_docs':
      p.push(
        `I am selling Unit ${ctx.unit} and request the documents the Association must provide under Civil Code Sections 4525 and 4530, together with an itemized list of any fees (Civil Code §4528).`,
      )
      if (str(f, 'escrow')) p.push(`Escrow / title contact: ${str(f, 'escrow')}`)
      if (str(f, 'details')) p.push(str(f, 'details'))
      p.push('Civil Code Section 4530 requires the documents within ten (10) days of this request.')
      break
    case 'special_meeting':
      p.push(
        'The undersigned members, holding at least five percent (5%) of the voting power of the Association, request a special meeting of the members under Corporations Code Section 7510(e) for the following purpose:',
      )
      p.push(str(f, 'purpose'))
      p.push(
        'Within twenty (20) days of receipt of this request, the Board must give notice of a meeting to be held not less than thirty-five (35) nor more than ninety (90) days after receipt. If notice is not given, the requesting members may give notice themselves (Corporations Code §7510(e)).',
      )
      p.push(`Petitioning members:\n${lines(f.petitioners).map((x) => `   ${x}    Signature: ______________________`).join('\n')}`)
      break
    default:
      p.push(str(f, 'body'))
  }
  return p
}

export function composeLetter(type: string, f: Record<string, unknown>, ctx: LetterContext): string {
  const a = ctx.association
  const out: string[] = []
  out.push(ctx.ownerName)
  if (ctx.ownerAddress) out.push(ctx.ownerAddress)
  else out.push(`428 Hill Street, Unit ${ctx.unit}\nSanta Monica, CA 90405`)
  if (ctx.ownerEmail) out.push(ctx.ownerEmail)
  out.push('')
  out.push(longDate(ctx.date))
  out.push('')
  out.push(METHOD_LINE[ctx.method] ?? 'Via U.S. Mail')
  out.push('')
  out.push('Board of Directors')
  out.push(a.name)
  if (type === 'architectural') out.push('Attn: Secretary of the Association')
  out.push(a.care_of)
  out.push(a.attn)
  out.push(a.street)
  out.push(a.city_state_zip)
  out.push('')
  out.push(`Re: ${letterSubject(type, f)}`)
  out.push(`Owner: ${ctx.ownerName}, Unit ${ctx.unit}, 428 Hill Street`)
  out.push('')
  out.push('Dear Members of the Board:')
  out.push('')
  for (const para of bodyParagraphs(type, f, ctx)) {
    out.push(para)
    out.push('')
  }
  out.push('Please send your written response to me at the address above' + (ctx.ownerEmail ? ' or by email.' : '.'))
  out.push('')
  out.push('Sincerely,')
  out.push('')
  out.push('')
  out.push('______________________________')
  out.push(ctx.ownerName)
  out.push(`Owner, Unit ${ctx.unit}`)

  if (type === 'meet_confer' && ctx.ccr125) {
    out.push('')
    out.push('\f')
    out.push('ATTACHMENT: CC&R SECTION 12.5 (DISPUTE RESOLUTION)')
    out.push('Amended and Restated Declaration of Covenants, Conditions and Restrictions for Four Twenty-Eight Hill Street Homeowners Association')
    out.push('')
    out.push('Section 12.5. Dispute Resolution.')
    out.push('')
    out.push(cleanCcrText(ctx.ccr125))
  }
  return out.join('\n')
}

/** Reflow the fixed-width CC&R text into paragraphs. */
export function cleanCcrText(t: string): string {
  return t
    .split(/\n\s*\n/)
    .map((para) => para.split('\n').map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

export function defaultTitle(type: string, f: Record<string, unknown>): string {
  const t = requestType(type)
  if (type === 'maintenance' && str(f, 'location')) return `Maintenance: ${str(f, 'location')}`.slice(0, 120)
  if (type === 'general' && str(f, 'subject')) return str(f, 'subject')
  return t?.label ?? 'Request'
}

export function defaultSummary(f: Record<string, unknown>): string {
  const items = [...((f.items as string[]) ?? []), ...lines(f.other_items)]
  if (items.length) return `Requested: ${items.join('; ')}`.slice(0, 600)
  const first = ['description', 'improvement', 'meetings', 'policies', 'purpose', 'reasons', 'improvements', 'term', 'body']
    .map((k) => str(f, k))
    .find(Boolean)
  return (first ?? '').slice(0, 600)
}

export function suggestedSendDate() {
  return todayISO()
}

export function followUpDate(due: string | null) {
  return due ? addDays(due, 1) : null
}
