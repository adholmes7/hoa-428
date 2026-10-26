import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { requestType } from '@shared/deadlines.ts'
import { Icon } from '../components/Icon'
import { errMsg, supabase } from '../lib/supabase'

type Source = { kind: string; ref: string; title: string; page: number | null }
type Turn = { role: 'user' | 'assistant'; content: string; sources?: Source[]; suggest?: { type: string; description: string } | null }

const STARTERS = [
  'Water is coming through my ceiling. Who is responsible and what should I send the Board?',
  'I want to replace my flooring. What approval do I need?',
  'How do I get copies of invoices for the roof work?',
  'The Board hasn’t answered my records request. What are my options?',
  'What does the CC&R say about pipes inside walls?',
]

const KEY = 'assistant-history-v1'

function render(md: string) {
  // Turn bare "§6.3" style references into links to the CC&R viewer
  const linked = md.replace(/§\s?(\d{1,2}\.\d{1,2})(\([a-z]\))?/g, (_m, id, sub) => `[§${id}${sub ?? ''}](/ccrs/${id})`)
  return DOMPurify.sanitize(marked.parse(linked, { async: false }) as string)
}

export default function Assistant() {
  const [params] = useSearchParams()
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    } catch {
      return []
    }
  })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-20)))
    } catch {
      /* storage unavailable */
    }
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setError('')
    setText('')
    const next: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(next)
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('assistant', {
        body: { messages: next.slice(-10).map(({ role, content }) => ({ role, content })) },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
        throw new Error(detail?.error ?? error.message)
      }
      setTurns([...next, { role: 'assistant', content: data.answer, sources: data.sources, suggest: data.suggest }])
      if (typeof data.remaining === 'number') setRemaining(data.remaining)
    } catch (e) {
      setError(errMsg(e))
      setTurns(next)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const q = params.get('q')
    if (q && !asked.current) {
      asked.current = true
      ask(q)
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ask the assistant</h1>
          <p>
            Ask about the CC&Rs, the HOA's documents, or how to use this site. It answers from the documents and cites sections, and can
            start the right request for you. It's an AI: check what it cites, and it isn't legal advice.
          </p>
        </div>
        {turns.length > 0 && (
          <button className="btn ghost" onClick={() => setTurns([])}>
            Clear
          </button>
        )}
      </div>

      <div className="ai-msgs">
        {turns.length === 0 && (
          <div className="card">
            <h3>Try asking</h3>
            <div className="stack" style={{ gap: 8 }}>
              {STARTERS.map((s) => (
                <button key={s} className="btn" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="ai-msg user">{t.content}</div>
          ) : (
            <div key={i} className="ai-msg bot">
              <div dangerouslySetInnerHTML={{ __html: render(t.content) }} />
              {t.suggest && requestType(t.suggest.type) && (
                <Link
                  className="btn primary mt"
                  to={`/requests/new?type=${t.suggest.type}&description=${encodeURIComponent(t.suggest.description ?? '')}`}
                >
                  <Icon name="send" /> Start: {requestType(t.suggest.type)!.label}
                </Link>
              )}
              {t.sources && t.sources.length > 0 && (
                <div className="ai-sources">
                  {t.sources.map((s) =>
                    s.kind === 'ccr' ? (
                      <Link key={s.kind + s.ref} className="badge brand" to={`/ccrs/${s.ref}`}>§{s.ref}</Link>
                    ) : (
                      <Link key={s.kind + s.ref + s.page} className="badge" to="/documents">
                        {s.title}{s.page ? ` p.${s.page}` : ''}
                      </Link>
                    ),
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {busy && <div className="ai-msg bot muted">Reading the documents…</div>}
        {error && <div className="notice bad">{error}</div>}
        <div ref={end} />
      </div>

      <form
        className="card row mt"
        style={{ position: 'sticky', bottom: 'calc(76px + env(safe-area-inset-bottom))', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <textarea
          rows={2}
          style={{ flex: 1, minHeight: 48 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your situation or ask a question"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) {
              e.preventDefault()
              ask(text)
            }
          }}
        />
        <button className="btn primary" disabled={busy || !text.trim()}>
          <Icon name="send" /> Ask
        </button>
      </form>
      {remaining != null && <p className="muted" style={{ fontSize: '0.8rem' }}>{remaining} questions left today.</p>}
    </>
  )
}
