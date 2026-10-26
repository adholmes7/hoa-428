import { useState } from 'react'
import { useAuth, useProfile } from '../lib/auth'
import { errMsg, supabase } from '../lib/supabase'

export default function ProfilePage() {
  const profile = useProfile()
  const { refresh, session } = useAuth()
  const [f, setF] = useState({
    display_name: profile.display_name,
    contact_email: profile.contact_email ?? '',
    phone: profile.phone ?? '',
    mailing_address: profile.mailing_address ?? '',
    chat_opt_in: profile.chat_opt_in,
    directory_opt_in: profile.directory_opt_in,
  })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')

  async function save() {
    setMsg('')
    setErr('')
    const { error } = await supabase
      .from('profiles')
      .update({ ...f, contact_email: f.contact_email || null, phone: f.phone || null, mailing_address: f.mailing_address || null })
      .eq('id', profile.id)
    if (error) return setErr(errMsg(error))
    await refresh()
    setMsg('Saved')
  }

  async function changePw() {
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return setErr(errMsg(error))
    setPw('')
    setMsg('Password updated')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your profile</h1>
          <p>Unit {profile.unit_id} · signed in as {session?.user.email}{profile.role === 'admin' ? ' · site admin' : ''}</p>
        </div>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <label className="field">Display name<input value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
          <label className="field">
            Mailing address for letters
            <textarea style={{ minHeight: 70 }} value={f.mailing_address} onChange={(e) => setF({ ...f, mailing_address: e.target.value })} placeholder={`428 Hill Street, Unit ${profile.unit_id}\nSanta Monica, CA 90405`} />
            <span className="hint">Used as the return address on letters you generate.</span>
          </label>
          <label className="field">Email for replies<input type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></label>
          <label className="field">Phone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={f.chat_opt_in} onChange={(e) => setF({ ...f, chat_opt_in: e.target.checked })} />
            <span><b>Owner chat.</b> Show me in chat so other opted-in owners can message me.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.directory_opt_in} onChange={(e) => setF({ ...f, directory_opt_in: e.target.checked })} />
            <span><b>Share my email and phone</b> with other signed-in owners.</span>
          </label>
          {err && <div className="notice bad">{err}</div>}
          {msg && <div className="notice ok">{msg}</div>}
          <div><button className="btn primary" onClick={save}>Save</button></div>
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Password</h3>
          <input type="password" minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (10+ characters)" />
          <div><button className="btn" disabled={pw.length < 10} onClick={changePw}>Change password</button></div>
          <hr />
          <h3 style={{ margin: 0 }}>Install on your phone</h3>
          <p className="ink2" style={{ margin: 0, fontSize: '0.92rem' }}>
            iPhone: open this site in Safari, tap Share, then <b>Add to Home Screen</b>. Android: in Chrome, open the ⋮ menu and choose{' '}
            <b>Install app</b>.
          </p>
        </div>
      </div>
    </>
  )
}
