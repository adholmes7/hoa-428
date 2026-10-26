import { useCallback, useEffect, useState } from 'react'
import { AiUsage } from '../components/AiUsage'
import { DEFAULT_ASSOCIATION, useAssociation, useAuth, useProfile, type Association } from '../lib/auth'
import { fmtDate } from '../lib/format'
import { downloadBytes, letterPdf, mergePdfs } from '../lib/pdf'
import { errMsg, supabase, type Profile } from '../lib/supabase'

type Unit = { id: number; label: string; bedrooms: number | null }
type Invite = { id: number; unit_id: number; uses: number; max_uses: number; revoked: boolean; created_at: string; kind: string }

function inviteLetter(unit: Unit, code: string, siteUrl: string, from: string) {
  return [
    `To the owner(s) of ${unit.label}`,
    '428 Hill Street, Santa Monica, CA 90405',
    '',
    new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    '',
    'Re: Your invitation to the 428 Hill Street owners’ portal',
    '',
    'Dear neighbor,',
    '',
    'A few owners have set up a private website for the 22 owners of 428 Hill Street. It is independent: it is not run by the Board or by LBPM. It is meant to make it quick to:',
    '   • read the CC&Rs, budget, reserve study and insurance documents in one place, with search;',
    '   • send written requests to the Board (records requests, maintenance notices, flooring approvals, meet-and-confer) as ready-to-mail letters that include the legally required wording;',
    '   • track when the HOA received each request and the deadline it has to answer by, including certified-mail tracking;',
    '   • keep a shared log of leaks, repairs and Board meetings; and',
    '   • if you choose to, chat with other owners in group or private conversations.',
    '',
    'Using it is entirely optional. Only owners can join. The code below is unique to your unit and works for up to three people in your household. Please keep it private.',
    '',
    `   Website:      ${siteUrl}`,
    `   Your unit:    ${unit.id}`,
    `   Owner code:   ${code}`,
    '',
    'To join: go to the website, choose “Create an account,” confirm your email, then enter your unit number and the code above.',
    '',
    'What others see: your display name and unit number. Your email and phone stay hidden unless you choose to share them. Chat is off until you turn it on.',
    '',
    'Questions? Contact me directly.',
    '',
    'Sincerely,',
    '',
    from,
  ].join('\n')
}

export default function Admin() {
  const profile = useProfile()
  const { settings, refresh } = useAuth()
  const assoc = useAssociation()
  const [units, setUnits] = useState<Unit[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [siteUrl, setSiteUrl] = useState(String(settings.site_url ?? window.location.origin))
  const [from, setFrom] = useState(`${profile.display_name}, Unit ${profile.unit_id}`)
  const [codes, setCodes] = useState<{ unit: number; code: string }[]>([])
  const [a, setA] = useState<Association>(assoc)
  const [mail, setMail] = useState<{ enabled: boolean; price_note: string }>({
    enabled: false,
    price_note: '',
    ...((settings.mail_service as object) ?? {}),
  })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: u }, { data: i }, { data: m }] = await Promise.all([
      supabase.from('units').select('*').order('id'),
      supabase.from('unit_invites').select('id, unit_id, uses, max_uses, revoked, created_at, kind').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('unit_id'),
    ])
    setUnits((u as Unit[]) ?? [])
    setInvites((i as Invite[]) ?? [])
    setMembers((m as Profile[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const activeInvite = (unit: number) => invites.find((i) => i.unit_id === unit && !i.revoked && i.kind === 'admin')

  async function generate() {
    if (!selected.length) return
    if (selected.some((u) => activeInvite(u)) && !confirm('Some selected units already have codes. Generating new ones cancels the old codes. Continue?')) return
    setBusy(true)
    setErr('')
    try {
      const out: { unit: number; code: string }[] = []
      for (const u of selected) {
        const { data, error } = await supabase.rpc('admin_create_invite', { p_unit: u, p_max_uses: 3 })
        if (error) throw error
        out.push({ unit: u, code: data as string })
      }
      setCodes(out)
      const pdfs = await Promise.all(out.map(({ unit, code }) => letterPdf(inviteLetter(units.find((x) => x.id === unit)!, code, siteUrl, from))))
      downloadBytes(await mergePdfs(pdfs), `invite-letters-${new Date().toISOString().slice(0, 10)}.pdf`)
      setSelected([])
      await load()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings() {
    setErr('')
    const rows = [
      { key: 'association', value: a },
      { key: 'mail_service', value: mail },
      { key: 'site_url', value: siteUrl },
    ]
    const { error } = await supabase.from('site_settings').upsert(rows)
    if (error) return setErr(errMsg(error))
    await refresh()
    setMsg('Settings saved')
  }

  async function setMember(id: string, patch: Partial<Profile>) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) setErr(errMsg(error))
    load()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Invite owners, manage accounts, and set the HOA's mailing details.</p>
        </div>
      </div>
      {err && <div className="notice bad mb">{err}</div>}
      {msg && <div className="notice ok mb">{msg}</div>}

      <div className="card">
        <h2>Invite letters</h2>
        <p className="ink2">
          Pick units and generate codes. You'll get one PDF with a letter per unit to print and hand-deliver. Each code works for up to 3
          accounts in that unit. Codes are shown once and only a hash is stored, so print before leaving this page.
        </p>
        <div className="grid grid-2 mb">
          <label className="field">Website address printed on the letters<input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} /></label>
          <label className="field">Signed by<input value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        </div>
        <div className="row mb">
          <button className="btn sm" onClick={() => setSelected(units.map((u) => u.id))}>Select all</button>
          <button className="btn sm" onClick={() => setSelected(units.filter((u) => !activeInvite(u.id) && !members.some((m) => m.unit_id === u.id)).map((u) => u.id))}>Select units without a code</button>
          <button className="btn sm ghost" onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th></th><th>Unit</th><th>Code</th><th>Accounts</th></tr></thead>
            <tbody>
              {units.map((u) => {
                const inv = activeInvite(u.id)
                const n = members.filter((m) => m.unit_id === u.id).length
                return (
                  <tr key={u.id}>
                    <td><input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} /></td>
                    <td>{u.label}</td>
                    <td>{inv ? <span className="badge ok">Active · {inv.uses}/{inv.max_uses} used · {fmtDate(inv.created_at)}</span> : <span className="badge">None</span>}</td>
                    <td>{n}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn primary mt" disabled={busy || !selected.length} onClick={generate}>
          {busy ? 'Generating…' : `Generate codes and letters (${selected.length})`}
        </button>
        {codes.length > 0 && (
          <div className="notice warn mt">
            <b>New codes (shown once):</b>
            <div className="mono" style={{ marginTop: 6 }}>{codes.map((c) => <div key={c.unit}>Unit {c.unit}: {c.code}</div>)}</div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Members</h2>
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Name</th><th>Unit</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.display_name}</td>
                  <td>{m.unit_id}</td>
                  <td>{m.contact_email}</td>
                  <td>{m.role}</td>
                  <td>{m.active ? <span className="badge ok">Active</span> : <span className="badge bad">Paused</span>}</td>
                  <td className="row" style={{ gap: 6 }}>
                    {m.id !== profile.id && (
                      <>
                        <button className="btn sm" onClick={() => setMember(m.id, { active: !m.active })}>{m.active ? 'Pause' : 'Restore'}</button>
                        <button className="btn sm ghost" onClick={() => confirm(`Make ${m.display_name} ${m.role === 'admin' ? 'a regular owner' : 'an admin'}?`) && setMember(m.id, { role: m.role === 'admin' ? 'owner' : 'admin' })}>
                          {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>When a unit sells, pause the old owner's accounts and generate a new code for the unit.</p>
      </div>

      <AiUsage members={members} />

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Where letters go</h2>
        <p className="ink2" style={{ margin: 0 }}>The Association's official address for written communications (Civ. Code §4035), from the 2026 annual policy statement.</p>
        <div className="grid grid-2">
          {(Object.keys(DEFAULT_ASSOCIATION) as (keyof Association)[]).map((k) => (
            <label key={k} className="field">
              {{ name: 'Association name', care_of: 'Care of', attn: 'Attention', street: 'Street', city_state_zip: 'City, state, ZIP', email: 'Manager email (for email copies)' }[k]}
              <input value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <h3 style={{ margin: '8px 0 0' }}>Certified mail service</h3>
        <label className="check">
          <input type="checkbox" checked={mail.enabled} onChange={(e) => setMail({ ...mail, enabled: e.target.checked })} />
          <span>Show the “Mail it as Certified Mail for me” button. This needs the Lob API key set on the server (see the README).</span>
        </label>
        <label className="field">Cost note shown to owners<input value={mail.price_note} onChange={(e) => setMail({ ...mail, price_note: e.target.value })} placeholder="e.g. About $8 per letter, covered by the owners' fund" /></label>
        <div><button className="btn primary" onClick={saveSettings}>Save settings</button></div>
      </div>
    </>
  )
}
