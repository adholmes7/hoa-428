import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile } from '../lib/auth'
import { supabase, type DirectoryEntry } from '../lib/supabase'

export const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '👀', '✅', '🎉'] as const

type Column = 'post_id' | 'reply_id' | 'message_id'
export type Reaction = { id: number; post_id: number | null; reply_id: number | null; message_id: number | null; user_id: string; emoji: string }

/** Reactions for a set of posts, replies or messages, kept live. */
export function useReactions(column: Column, ids: number[]) {
  const [rows, setRows] = useState<Reaction[]>([])
  const key = ids.join(',')
  const idsRef = useRef(ids)

  const load = useCallback(async () => {
    const list = idsRef.current
    if (list.length === 0) return setRows([])
    // Chunk to keep the query string short
    const out: Reaction[] = []
    for (let i = 0; i < list.length; i += 150) {
      const { data } = await supabase.from('reactions').select('*').in(column, list.slice(i, i + 150))
      out.push(...((data as Reaction[]) ?? []))
    }
    setRows(out)
  }, [column])

  useEffect(() => {
    idsRef.current = ids
    load()
  }, [load, key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ch = supabase
      .channel(`reactions-${column}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, (p) => {
        const n = p.new as Partial<Reaction>
        // Deletes only carry the id, so reload when it's one we're showing
        if ((n && n[column] != null && idsRef.current.includes(n[column] as number)) || p.eventType === 'DELETE') load()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [column, load])

  const forTarget = (id: number) => rows.filter((r) => r[column] === id)
  return { rows, forTarget, reload: load, setRows }
}

/** Reaction chips plus an add button. Clicking a chip toggles your reaction. */
export function Reactions({
  column,
  target,
  rows,
  names,
  onChange,
  disabled,
}: {
  column: Column
  target: number
  rows: Reaction[]
  names: Record<string, DirectoryEntry>
  onChange: (rows: Reaction[]) => void
  disabled?: boolean
}) {
  const profile = useProfile()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  async function toggle(emoji: string) {
    setOpen(false)
    const mine = rows.find((r) => r.emoji === emoji && r.user_id === profile.id)
    if (mine) {
      onChange(rows.filter((r) => r.id !== mine.id))
      await supabase.from('reactions').delete().eq('id', mine.id)
    } else {
      const { data } = await supabase.from('reactions').insert({ [column]: target, emoji, user_id: profile.id }).select().single()
      if (data) onChange([...rows, data as Reaction])
    }
  }

  const groups = EMOJI.map((e) => ({ emoji: e, list: rows.filter((r) => r.emoji === e) })).filter((g) => g.list.length > 0)

  return (
    <div className="reactions" ref={box}>
      {groups.map((g) => {
        const mine = g.list.some((r) => r.user_id === profile.id)
        const who = g.list.map((r) => (r.user_id === profile.id ? 'You' : (names[r.user_id]?.display_name ?? 'Former owner'))).join(', ')
        return (
          <button key={g.emoji} type="button" className={`react-chip ${mine ? 'mine' : ''}`} title={who} aria-label={`${g.emoji} ${g.list.length}: ${who}`} disabled={disabled} onClick={() => toggle(g.emoji)}>
            <span>{g.emoji}</span>
            {g.list.length}
          </button>
        )
      })}
      {!disabled && (
        <span style={{ position: 'relative' }}>
          <button type="button" className="react-chip add" aria-label="Add a reaction" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="12" r="8" />
              <path d="M8 14s1.2 2 3 2 3-2 3-2M8.5 9.5h.01M13.5 9.5h.01M20 3v5M17.5 5.5h5" />
            </svg>
          </button>
          {open && (
            <div className="react-picker" role="menu">
              {EMOJI.map((e) => (
                <button key={e} type="button" role="menuitem" onClick={() => toggle(e)} aria-label={`React with ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  )
}
