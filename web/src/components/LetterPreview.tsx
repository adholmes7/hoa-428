// The letter as text, with the saved signature drawn on the signature line (same placement as the PDF).

export function LetterPreview({ text, signature }: { text: string; signature: string | null }) {
  const body = text.replace(/\f/g, '\n— — — — —\n')
  const lines = body.split('\n')
  const close = lines.findIndex((l) => l.trim() === 'Sincerely,')
  const at = signature && close >= 0 ? lines.findIndex((l, i) => i > close && /^_{10,}$/.test(l.trim())) : -1
  if (at < 0) return <div className="letter mt">{body}</div>
  return (
    <div className="letter mt">
      {lines.slice(0, at).join('\n')}
      {'\n'}
      <span className="letter-sig">
        <img src={signature!} alt="Your signature" />
        {lines[at]}
      </span>
      {'\n'}
      {lines.slice(at + 1).join('\n')}
    </div>
  )
}
