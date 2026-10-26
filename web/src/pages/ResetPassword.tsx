import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { errMsg, supabase } from '../lib/supabase'

export function ResetPassword() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(errMsg(error))
    nav('/')
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <label className="field">
          New password
          <input type="password" minLength={10} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="notice bad">{error}</div>}
        <button className="btn primary" disabled={busy}>
          Save password
        </button>
      </form>
    </div>
  )
}
