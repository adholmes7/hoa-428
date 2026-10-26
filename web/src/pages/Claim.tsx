import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { errMsg, supabase } from '../lib/supabase'

export function Claim() {
  const { session, refresh, signOut } = useAuth()
  const [unit, setUnit] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('claim_invite', { p_unit: Number(unit), p_code: code, p_display_name: name })
    setBusy(false)
    if (error) return setError(errMsg(error))
    await refresh()
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <form className="card stack" onSubmit={submit}>
          <h2>Confirm you're an owner</h2>
          <p className="ink2">
            Enter your unit number and the owner code from the letter delivered to your unit. Signed in as{' '}
            <b>{session?.user.email}</b>.
          </p>
          <label className="field">
            Unit number
            <input inputMode="numeric" required value={unit} onChange={(e) => setUnit(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">
            Owner code
            <input
              required
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ fontFamily: 'var(--mono)', letterSpacing: '0.08em' }}
            />
          </label>
          <label className="field">
            Your name as other owners will see it
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pat L." />
          </label>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
            <span>
              I'm an owner of this unit. I'll keep records from this site within the owner community (Civ. Code §5230), share
              facts rather than opinions about individuals, and not post other owners' private information.
            </span>
          </label>
          {error && <div className="notice bad">{error}</div>}
          <button className="btn primary" disabled={busy || !agree}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" className="btn ghost" onClick={signOut}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
