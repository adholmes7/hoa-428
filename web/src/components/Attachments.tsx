import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { errMsg, signedUrl, supabase } from '../lib/supabase'
import { Icon } from './Icon'

type Row = { id: string; storage_path: string; file_name: string; label: string | null; size_bytes: number | null; uploaded_by: string; created_at: string }

const MAX_MB = 25

export function Attachments({ requestId, incidentId, canUpload }: { requestId?: string; incidentId?: string; canUpload: boolean }) {
  const profile = useProfile()
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const q = supabase.from('attachments').select('*').order('created_at')
    const { data } = await (requestId ? q.eq('request_id', requestId) : q.eq('incident_id', incidentId!))
    setRows((data as Row[]) ?? [])
  }, [requestId, incidentId])

  useEffect(() => {
    load()
  }, [load])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_MB} MB`)
        const safe = file.name.replace(/[^\w.-]+/g, '_')
        const path = `${profile.id}/${crypto.randomUUID()}-${safe}`
        const { error: upErr } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type })
        if (upErr) throw upErr
        const { error: rowErr } = await supabase.from('attachments').insert({
          request_id: requestId ?? null,
          incident_id: incidentId ?? null,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          label: label || null,
          uploaded_by: profile.id,
        })
        if (rowErr) throw rowErr
      }
      setLabel('')
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function open(row: Row) {
    try {
      window.open(await signedUrl('attachments', row.storage_path), '_blank', 'noopener')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function remove(row: Row) {
    if (!confirm(`Remove ${row.file_name}?`)) return
    await supabase.from('attachments').delete().eq('id', row.id)
    await supabase.storage.from('attachments').remove([row.storage_path])
    load()
  }

  return (
    <div className="card">
      <h3>Files</h3>
      {rows.length ? (
        <div className="item-list">
          {rows.map((row) => (
            <div key={row.id} className="item" style={{ alignItems: 'center' }}>
              <Icon name="paperclip" size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href="#" onClick={(e) => (e.preventDefault(), open(row))} style={{ wordBreak: 'break-all' }}>
                  {row.file_name}
                </a>
                <div className="s">
                  {row.label ? `${row.label} · ` : ''}
                  {fmtDate(row.created_at)}
                </div>
              </div>
              {row.uploaded_by === profile.id && (
                <button className="btn ghost sm" onClick={() => remove(row)} aria-label="Remove">
                  <Icon name="trash" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No files yet.</p>
      )}
      {canUpload && (
        <div className="stack mt">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional), e.g. Certified mail receipt, HOA response" />
          <div className="row">
            <input ref={input} type="file" multiple onChange={(e) => upload(e.target.files)} style={{ display: 'none' }} />
            <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="paperclip" /> {busy ? 'Uploading…' : 'Add photo or file'}
            </button>
          </div>
          <span className="muted" style={{ fontSize: '0.8rem' }}>Photos of receipts work fine. Up to {MAX_MB} MB each.</span>
        </div>
      )}
      {error && <div className="notice bad mt">{error}</div>}
    </div>
  )
}
