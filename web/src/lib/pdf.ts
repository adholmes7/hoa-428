import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 72

// Standard PDF fonts only cover WinAnsi; swap anything else for a close ASCII equivalent.
function sanitize(s: string, font: PDFFont): string {
  const replacements: Record<string, string> = { '→': '->', '≤': '<=', '≥': '>=', '✓': 'x', '\t': '    ' }
  let out = ''
  for (const ch of s) {
    const r = replacements[ch] ?? ch
    try {
      font.encodeText(r)
      out += r
    } catch {
      out += '?'
    }
  }
  return out
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const indent = text.match(/^\s*/)?.[0] ?? ''
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let cur = indent
  for (const w of words) {
    const test = cur.trim() ? `${cur} ${w}` : `${indent}${w}`
    if (font.widthOfTextAtSize(test, size) > width && cur.trim()) {
      lines.push(cur)
      // Hang wrapped lines only for indented items (numbered or bulleted lists)
      cur = `${indent ? indent + '   ' : ''}${w}`
    } else {
      cur = test
    }
  }
  lines.push(cur)
  return lines
}

export type PdfOptions = { footer?: string }

/** Render a plain-text letter (\f = page break) to a letter-size PDF. */
export async function letterPdf(text: string, opts: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const size = 11.5
  const lead = size * 1.38
  const width = PAGE_W - MARGIN * 2

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }

  for (const raw of text.split('\n')) {
    if (raw.trim() === '\f') {
      newPage()
      continue
    }
    const isHeading = /^(Re:|ATTACHMENT:)/.test(raw)
    const f = isHeading ? bold : font
    const clean = sanitize(raw, f)
    const parts = clean.trim() === '' ? [''] : wrap(clean, f, size, width)
    for (const line of parts) {
      if (y < MARGIN + lead) newPage()
      if (line) page.drawText(line, { x: MARGIN, y, size, font: f, color: rgb(0.07, 0.07, 0.07) })
      y -= lead
    }
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const label = sanitize(`${opts.footer ? opts.footer + '   ·   ' : ''}Page ${i + 1} of ${pages.length}`, font)
    p.drawText(label, { x: MARGIN, y: 36, size: 8.5, font, color: rgb(0.45, 0.45, 0.45) })
  })
  return doc.save()
}

/** Merge several letters into one PDF (used for printing invite letters). */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return out.save()
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
