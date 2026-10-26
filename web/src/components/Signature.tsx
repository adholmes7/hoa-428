import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile } from '../lib/auth'
import { errMsg, supabase } from '../lib/supabase'

/** The signed-in owner's saved signature (a PNG data URL), readable only by them. */
export function useSignature() {
  const profile = useProfile()
  const [image, setImage] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase
      .from('signatures')
      .select('image')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        setImage(data?.image ?? null)
        setLoaded(true)
      })
  }, [profile.id])

  const save = useCallback(
    async (img: string) => {
      const { error } = await supabase.from('signatures').upsert({ user_id: profile.id, image: img, updated_at: new Date().toISOString() })
      if (error) throw new Error(errMsg(error))
      setImage(img)
    },
    [profile.id],
  )

  const remove = useCallback(async () => {
    await supabase.from('signatures').delete().eq('user_id', profile.id)
    setImage(null)
  }, [profile.id])

  return { image, loaded, save, remove }
}

const W = 560
const H = 170

/** Draw a signature with a finger, stylus or mouse. Returns a cropped PNG data URL. */
export function SignaturePad({ onSave, onCancel }: { onSave: (png: string) => Promise<void> | void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const c = ref.current!
    const dpr = Math.max(2, window.devicePixelRatio || 1)
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#15233f'
    ctx.lineWidth = 2.4
  }, [])

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  function down(e: React.PointerEvent) {
    ref.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    const ctx = ref.current!.getContext('2d')!
    ctx.beginPath()
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
    ctx.fillStyle = '#15233f'
    ctx.fill()
    setEmpty(false)
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return
    const p = point(e)
    const ctx = ref.current!.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function up() {
    drawing.current = false
    last.current = null
  }

  function clear() {
    const c = ref.current!
    c.getContext('2d')!.clearRect(0, 0, W, H)
    setEmpty(true)
  }

  // Crop to the ink so the signature sits neatly on the letter's signature line
  function cropped(): string {
    const c = ref.current!
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    let x0 = width, y0 = height, x1 = 0, y1 = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    const pad = 8
    x0 = Math.max(0, x0 - pad)
    y0 = Math.max(0, y0 - pad)
    x1 = Math.min(width - 1, x1 + pad)
    y1 = Math.min(height - 1, y1 + pad)
    // Downscale to keep the stored image small
    const scale = Math.min(1, 600 / (x1 - x0 + 1))
    const out = document.createElement('canvas')
    out.width = Math.round((x1 - x0 + 1) * scale)
    out.height = Math.round((y1 - y0 + 1) * scale)
    out.getContext('2d')!.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  async function save() {
    setBusy(true)
    setErr('')
    try {
      await onSave(cropped())
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="sigpad">
        <canvas
          ref={ref}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Signature drawing area"
        />
        <div className="sigpad-line" aria-hidden>
          <span>✕</span>
        </div>
      </div>
      <span className="hint">Sign with your finger, a stylus or the mouse.</span>
      {err && <div className="notice bad">{err}</div>}
      <div className="row">
        <button className="btn primary sm" disabled={empty || busy} onClick={save}>{busy ? 'Saving…' : 'Save signature'}</button>
        <button className="btn sm" disabled={empty} onClick={clear}>Clear</button>
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Shows the saved signature with change/remove controls, or a prompt to add one. */
export function SignatureSettings({ sig, compact }: { sig: ReturnType<typeof useSignature>; compact?: boolean }) {
  const [drawing, setDrawing] = useState(false)
  if (!sig.loaded) return null
  if (drawing) return <SignaturePad onSave={async (png) => { await sig.save(png); setDrawing(false) }} onCancel={() => setDrawing(false)} />
  if (sig.image) {
    return (
      <div className="row" style={{ alignItems: 'center' }}>
        <img src={sig.image} alt="Your saved signature" className="sigimg" />
        <button className="btn sm" onClick={() => setDrawing(true)}>Change</button>
        {!compact && <button className="btn ghost sm" onClick={() => confirm('Remove your saved signature?') && sig.remove()}>Remove</button>}
      </div>
    )
  }
  return (
    <div>
      <button className="btn sm" onClick={() => setDrawing(true)}>Add your signature</button>
    </div>
  )
}
