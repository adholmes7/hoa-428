import { useState, type FormEvent } from 'react'
import { errMsg, supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'magic' | 'forgot'

export function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const redirect = window.location.origin

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
        if (error) throw error
        if (!data.session) setInfo('Check your email for a confirmation link, then come back and sign in.')
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } })
        if (error) throw error
        setInfo('Check your email for a sign-in link.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${redirect}/reset` })
        if (error) throw error
        setInfo('If that email has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const title = { signin: 'Sign in', signup: 'Create your account', magic: 'Email me a sign-in link', forgot: 'Reset your password' }[mode]

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <div>
            <b>428 Hill Street</b>
            <span>Independent owners' portal</span>
          </div>
        </div>
        <form className="card stack" onSubmit={submit}>
          <h2>{title}</h2>
          {mode === 'signup' && (
            <p className="notice">
              Only owners can use this site. After you create an account, you'll enter your unit number and the code from
              the letter delivered to your door.
            </p>
          )}
          <label className="field">
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {(mode === 'signin' || mode === 'signup') && (
            <label className="field">
              Password
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === 'signup' && <span className="hint">At least 10 characters.</span>}
            </label>
          )}
          {error && <div className="notice bad">{error}</div>}
          {info && <div className="notice ok">{info}</div>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Working…' : title}
          </button>
          <div className="row between" style={{ fontSize: '0.88rem' }}>
            {mode !== 'signin' ? (
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('signin'))}>
                Back to sign in
              </a>
            ) : (
              <a href="#" onClick={(e) => (e.preventDefault(), setMode('signup'))}>
                New here? Create an account
              </a>
            )}
            {mode === 'signin' && (
              <span className="row" style={{ gap: 12 }}>
                <a href="#" onClick={(e) => (e.preventDefault(), setMode('magic'))}>
                  Email me a link
                </a>
                <a href="#" onClick={(e) => (e.preventDefault(), setMode('forgot'))}>
                  Forgot password
                </a>
              </span>
            )}
          </div>
        </form>
        <p className="muted" style={{ fontSize: '0.8rem', textAlign: 'center', marginTop: 16 }}>
          An independent site run by owners. Not an official site of the Association or its management company.
        </p>
      </div>
    </div>
  )
}
