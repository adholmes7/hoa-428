import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  // Shown in the console so a misconfigured deploy is easy to diagnose
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export type Profile = {
  id: string
  unit_id: number
  display_name: string
  role: 'owner' | 'admin'
  active: boolean
  chat_opt_in: boolean
  directory_opt_in: boolean
  contact_email: string | null
  phone: string | null
  mailing_address: string | null
  email_consent_on_file: boolean
  created_at: string
}

export type RequestRow = {
  id: string
  ref_no: number
  type: string
  title: string
  summary: string | null
  letter_body: string | null
  letter_fields: Record<string, unknown>
  requester_id: string
  unit_id: number
  visibility: 'owners' | 'private'
  legal_basis: string | null
  day_type: 'business' | 'calendar' | null
  deadline_days: number | null
  deadline_kind: string | null
  if_missed: string | null
  method: string | null
  sent_date: string | null
  received_date: string | null
  received_estimated: boolean
  due_date: string | null
  status: string
  carrier: string | null
  tracking_number: string | null
  tracking_status: string | null
  tracking_updated_at: string | null
  mail_provider: string | null
  mail_provider_id: string | null
  outcome: string | null
  answered_date: string | null
  created_at: string
  updated_at: string
}

export type RequestEvent = { id: number; request_id: string; at: string; kind: string; note: string | null; created_by: string | null }

export type Incident = {
  id: string
  title: string
  category: string
  location_type: 'common' | 'unit'
  location: string | null
  occurred_on: string | null
  reported_on: string | null
  description: string | null
  reported_to: string | null
  hoa_response: string | null
  diagnosed: boolean | null
  diagnosis: string | null
  resolved: boolean
  cost: number | null
  fund: string | null
  unit_id: number | null
  created_by: string | null
  created_at: string
}

export type DocumentRow = {
  id: string
  title: string
  category: string
  doc_date: string | null
  source: string | null
  obtained_via: string | null
  storage_path: string | null
  file_name: string | null
  notes: string | null
  page_count: number | null
  uploaded_by: string | null
  created_at: string
}

export type CcrSection = {
  id: string
  article: number
  article_title: string
  title: string
  pdf_page: number
  pdf_page_end: number
  printed_page: number
  sort: number
  text: string
}

export type Meeting = {
  id: string
  meeting_date: string
  kind: string
  title: string | null
  agenda_document_id: string | null
  minutes_document_id: string | null
  minutes_received_on: string | null
  decisions: string | null
  open_items: string | null
  created_by: string | null
}

export type DirectoryEntry = {
  id: string
  display_name: string
  unit_id: number
  chat_opt_in: boolean
  role: string
  contact_email: string | null
  phone: string | null
}

export async function signedUrl(bucket: string, path: string, download?: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10, download ? { download } : undefined)
  if (error) throw error
  return data.signedUrl
}

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong'
}
