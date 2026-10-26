import { useCallback, useEffect, useState } from 'react'
import { useProfile } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { errMsg, supabase } from '../lib/supabase'

type Invite = { id: number; uses: number; max_uses: number; revoked: boolean; created_at: string }

/** Lets an owner give a co-owner or household member a one-time code for their own unit. */
export function HouseholdInvite() {
  const profile = useProfile()
  const [code, setCode] = useState('')
  const [invites, setInvites] = useState<Invite[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('unit_invites')
      .select('id, uses, max_uses, revoked, created_at')
      .eq('kind', 'household')
      .eq('unit_id', profile.unit_id) // admins can read every unit's codes; show only this unit's
      .order('created_at', { ascending: false })
      .limit(10)
    setInvites((data as Invite[]) ?? [])
  }, [profile.unit_id])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    setBusy(true)
    setError('')
    setCopied(false)
    const { data, error } = await supabase.rpc('create_household_invite')
    setBusy(false)
    if (error) return setError(errMsg(error))
    setCode(data as string)
    load()
  }

  async function cancel(id: number) {
    await supabase.rpc('cancel_household_invite', { p_id: id })
    load()
  }

  const message = `You're invited to the 428 Hill Street owners' portal.\n\n1. Go to ${window.location.origin} and choose "Create an account".\n2. After confirming your email, enter unit ${profile.unit_id} and this one-time code: ${code}\n\nThe code works once and expires in 30 days.`
  const expired = (i: Invite) => Date.now() - new Date(i.created_at).getTime() > 30 * 86400000
  const pending = invites.filter((i) => !i.revoked && i.uses < i.max_uses && !expired(i))

  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Invite someone from your household</h3>
      <p className="ink2" style={{ margin: 0, fontSize: '0.92rem' }}>
        For a co-owner or family member of Unit {profile.unit_id}. The code works once and expires in 30 days. Up to 4 accounts per unit.
      </p>
      {code ? (
        <div className="notice ok">
          <div>
            One-time code for Unit {profile.unit_id}: <b className="mono" style={{ fontSize: '1.05rem', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{code}</b>
          </div>
          <div className="row mt">
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message)
                  setCopied(true)
                } catch {
                  setError('Copy failed; select the code and copy it by hand.')
                }
              }}
            >
              {copied ? 'Copied' : 'Copy invite message'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>Shown only once. Send it to them privately.</div>
        </div>
      ) : (
        <div>
          <button className="btn" disabled={busy} onClick={create}>
            {busy ? 'Creating…' : 'Create a one-time code'}
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="item-list">
          {pending.map((i) => (
            <div key={i.id} className="item" style={{ alignItems: 'center', padding: '6px 2px' }}>
              <span style={{ flex: 1, fontSize: '0.88rem' }}>Unused code created {fmtDate(i.created_at)}</span>
              <button className="btn sm ghost" onClick={() => cancel(i.id)}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
    </div>
  )
}
