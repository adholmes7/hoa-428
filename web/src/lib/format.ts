import { STATUSES, urgency, daysBetween, todayISO, type Urgency } from '@shared/deadlines.ts'

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!d) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', opts)
  }
  return new Date(d).toLocaleDateString('en-US', opts)
}

export function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fmtTime(d: string) {
  const dt = new Date(d)
  const sameDay = dt.toDateString() === new Date().toDateString()
  return sameDay
    ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function money(n: number | null | undefined, digits = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function statusLabel(status: string, due: string | null) {
  const u = urgency(status, due)
  if (u === 'overdue') return 'Overdue'
  return STATUSES[status] ?? status
}

export function urgencyClass(u: Urgency) {
  return { none: '', ok: 'info', soon: 'warn', due: 'warn', overdue: 'bad', done: 'ok' }[u]
}

export function dueText(status: string, due: string | null) {
  if (!due) return ''
  const u = urgency(status, due)
  if (u === 'done' || u === 'none') return `Due ${fmtDate(due)}`
  const n = daysBetween(todayISO(), due)
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`
  if (n === 0) return 'Due today'
  return `Due in ${n} day${n === 1 ? '' : 's'}`
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function uspsTrackingUrl(n: string) {
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n.replace(/\s+/g, ''))}`
}
