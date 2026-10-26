import { useEffect, useMemo, useState } from 'react'
import { supabase, type DirectoryEntry } from '../lib/supabase'

export const CATEGORIES: Record<string, string> = {
  general: 'General',
  notice: 'Notice',
  question: 'Question',
  event: 'Event',
  poll: 'Poll',
}

export function CategoryBadge({ category }: { category: string }) {
  const cls = category === 'notice' ? 'warn' : category === 'poll' ? 'brand' : category === 'event' ? 'ok' : ''
  return <span className={`badge ${cls}`}>{CATEGORIES[category] ?? category}</span>
}

/** Owner names by id, for authors and reactions. */
export function usePeople() {
  const [people, setPeople] = useState<DirectoryEntry[]>([])
  useEffect(() => {
    supabase
      .from('owner_directory')
      .select('*')
      .then(({ data }) => setPeople((data as DirectoryEntry[]) ?? []))
  }, [])
  return useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])) as Record<string, DirectoryEntry>, [people])
}

export function pollClosed(closesAt: string | null) {
  return Boolean(closesAt && new Date(closesAt).getTime() <= Date.now())
}
