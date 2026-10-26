// Loads the starting data into Supabase: units, CC&R sections, documents (PDF + page text),
// finance figures, settings and a few common-area maintenance entries.
//
// Usage (from the repo root):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs [options]
//
// Options:
//   --bootstrap-unit 18     create an invite code for that unit and print it (for the first admin)
//   --make-admin you@x.com  give the account with that email the admin role (after it has claimed a unit)
//   --skip-docs             don't upload the PDFs again
//
// Reads from private-data/ (never commit that folder).

import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] ?? true : null
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
const DATA = new URL('../private-data/', import.meta.url).pathname

async function must(p, what) {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

// ---------------------------------------------------------------------------
// Admin helpers (run on their own)
// ---------------------------------------------------------------------------

const makeAdmin = flag('--make-admin')
if (makeAdmin) {
  const { data } = await sb.auth.admin.listUsers({ perPage: 1000 })
  const user = data.users.find((u) => u.email?.toLowerCase() === String(makeAdmin).toLowerCase())
  if (!user) throw new Error(`No account with email ${makeAdmin}. Sign up on the site first.`)
  const rows = await must(sb.from('profiles').update({ role: 'admin' }).eq('id', user.id).select(), 'make admin')
  if (!rows.length) throw new Error('That account has not claimed a unit yet. Claim with the bootstrap code first.')
  console.log(`${makeAdmin} is now an admin.`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Units: 22 units. Unit numbers assumed 1–22; edit here if the building uses other numbers.
// ---------------------------------------------------------------------------

const units = Array.from({ length: 22 }, (_, i) => ({ id: i + 1, label: `Unit ${i + 1}` }))
await must(sb.from('units').upsert(units), 'units')
console.log(`units: ${units.length}`)

const bootstrap = flag('--bootstrap-unit')
if (bootstrap) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const code = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('')
  await must(sb.from('unit_invites').update({ revoked: true }).eq('unit_id', Number(bootstrap)).eq('revoked', false), 'revoke')
  await must(
    sb.from('unit_invites').insert({ unit_id: Number(bootstrap), code_hash: createHash('sha256').update(code).digest('hex'), max_uses: 3 }),
    'invite',
  )
  console.log(`\nBootstrap code for Unit ${bootstrap}: ${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}\n`)
}

// ---------------------------------------------------------------------------
// CC&R sections
// ---------------------------------------------------------------------------

const sections = JSON.parse(readFileSync(join(DATA, 'seed/ccr_sections.json'), 'utf8'))
await must(sb.from('ccr_sections').upsert(sections), 'ccr_sections')
console.log(`ccr_sections: ${sections.length}`)

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DOCS = [
  {
    file: 'docs/428_HillStreet_CCRs_Final.pdf', text: 'text/428_HillStreet_CCRs_Final.txt', split: 'ff',
    title: 'CC&Rs — Amended and Restated Declaration', category: 'governing', source: 'Association',
    obtained_via: 'Owner copy', notes: 'Printed page = PDF page − 10. The copy on file has blank signature and notary blocks; confirm the recorded version with the County Recorder.',
  },
  {
    file: 'docs/hoa-2026-budget-and-reserve-study.pdf', text: 'text/hoa-2026-budget-and-reserve-study.txt', split: 'marker',
    title: '2026 Budget Packet, Reserve Study and Annual Policy Statement', category: 'financial', doc_date: '2025-12-01',
    source: 'LBPM / Board', obtained_via: 'Annual mailing to owners (Dec 2025)',
    notes: 'Scanned; the operating budget tables (PDF pp. 5–7) OCR poorly, so read the PDF directly. Reserve study by McCaffery Reserve Consulting, site inspection Jan 31, 2024.',
  },
  {
    file: 'docs/hoa-master-policy-renewal-exp-2026-11-07.pdf', text: 'text/hoa-master-policy-renewal-exp-2026-11-07.txt', split: 'marker',
    title: 'HOA Master Policy Renewal Declarations, State Farm (Nov 7 2025 – Nov 7 2026)', category: 'insurance', doc_date: '2025-08-25',
    source: 'State Farm', obtained_via: 'Owner copy',
    notes: 'Policy 92-C0-4666-9. Building limit $8,548,500; deductible $5,000. Full forms CMP-4101 and CMP-4696 not yet obtained.',
  },
  {
    file: 'docs/hoa-insurance-2021-11.pdf', text: 'text/hoa-insurance-2021-11.txt', split: 'marker',
    title: 'HOA Master Policy Declarations, State Farm (2020–21)', category: 'insurance', doc_date: '2020-11-07',
    source: 'State Farm', obtained_via: 'Owner copy',
  },
  {
    file: 'docs/hoa-insurance-2021-2022.pdf', text: 'text/hoa-insurance-2021-2022.txt', split: 'marker',
    title: 'HOA Umbrella Policy (2021–22)', category: 'insurance', doc_date: '2021-11-07', source: 'Insurer', obtained_via: 'Owner copy',
  },
]

function pagesOf(text, split) {
  if (split === 'marker') {
    const parts = text.split(/===== PDF PAGE (\d+) =====/)
    const out = []
    for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), content: parts[i + 1].trim() })
    return out
  }
  return text.split('\f').map((content, i) => ({ page: i + 1, content: content.trim() }))
}

if (!args.includes('--skip-docs')) {
  for (const d of DOCS) {
    const path = join(DATA, d.file)
    if (!existsSync(path)) {
      console.warn(`missing ${d.file}, skipped`)
      continue
    }
    const storage_path = `seed/${basename(d.file)}`
    const bytes = readFileSync(path)
    await must(sb.storage.from('documents').upload(storage_path, bytes, { contentType: 'application/pdf', upsert: true }), `upload ${d.file}`)

    const existing = await must(sb.from('documents').select('id').eq('storage_path', storage_path).maybeSingle(), 'find doc')
    const row = {
      title: d.title, category: d.category, doc_date: d.doc_date ?? null, source: d.source, obtained_via: d.obtained_via,
      storage_path, file_name: basename(d.file), notes: d.notes ?? null, uploaded_by: null,
    }
    const doc = existing
      ? (await must(sb.from('documents').update(row).eq('id', existing.id).select().single(), 'update doc'))
      : (await must(sb.from('documents').insert(row).select().single(), 'insert doc'))

    const pages = pagesOf(readFileSync(join(DATA, d.text), 'utf8'), d.split).filter((p) => p.content.length > 20)
    await must(sb.from('document_pages').delete().eq('document_id', doc.id), 'clear pages')
    for (let i = 0; i < pages.length; i += 50) {
      await must(sb.from('document_pages').insert(pages.slice(i, i + 50).map((p) => ({ ...p, document_id: doc.id }))), 'pages')
    }
    await must(sb.from('documents').update({ page_count: pages.length ? Math.max(...pages.map((p) => p.page)) : null }).eq('id', doc.id), 'count')
    console.log(`document: ${d.title} (${pages.length} pages of text)`)
  }
}

// ---------------------------------------------------------------------------
// Finance figures
// ---------------------------------------------------------------------------

const BUDGET = '2026 budget packet, PDF p. 2'
const STUDY = 'Reserve study (McCaffery, Jan 2024), PDF p. 12'
const facts = [
  ['reserve_contribution', 'Actual (2026 budget)', '2026', 1001.16, 'usd', BUDGET],
  ['reserve_contribution', '5% threshold plan', '2024', 1245, 'usd', STUDY],
  ['reserve_contribution', 'Recommended plan', '2024', 1353, 'usd', STUDY],
  ['percent_funded', '2026', '2026', 62, 'pct', 'Disclosure summary, PDF p. 14'],
  ['percent_funded', '2027', '2027', 62, 'pct', 'Disclosure summary, PDF p. 14'],
  ['percent_funded', '2028', '2028', 61, 'pct', 'Disclosure summary, PDF p. 14'],
  ['percent_funded', '2029', '2029', 43, 'pct', 'Disclosure summary, PDF p. 14'],
  ['premium', '2020–21', '2020', 11737, 'usd', '2020–21 declarations'],
  ['premium', '2025–26', '2025', 25943, 'usd', '2025–26 renewal declarations', false],
  ['dues', '1 bedroom (12 units)', '2026', 370.82, 'usd', '2026 budget packet, PDF p. 1'],
  ['dues', '2 bedroom (8 units)', '2026', 426.24, 'usd', '2026 budget packet, PDF p. 1'],
  ['dues', '3 bedroom (2 units)', '2026', 563.43, 'usd', '2026 budget packet, PDF p. 1'],
  ['remaining_life', 'Flat roofing ($63,250)', '2024', 1, 'years', 'Reserve study component list'],
  ['remaining_life', 'Tile underlayment ($5,063)', '2024', 5, 'years', 'Reserve study component list'],
  ['remaining_life', 'Gutters & downspouts ($2,500)', '2024', 11, 'years', 'Reserve study component list'],
].map(([metric, label, period, value, unit, source, verified = true], sort) => ({ metric, label, period, value, unit, source, verified, sort }))
await must(sb.from('finance_facts').delete().gte('id', 0), 'clear facts')
await must(sb.from('finance_facts').insert(facts), 'facts')
console.log(`finance_facts: ${facts.length}`)

// ---------------------------------------------------------------------------
// Settings (only set if missing, so admin edits aren't overwritten)
// ---------------------------------------------------------------------------

const settings = [
  {
    key: 'association',
    value: {
      name: 'Four Twenty-Eight Hill Street Homeowners Association',
      care_of: 'c/o LBPM',
      attn: 'Attn: Lida Ibrahimpasic, Community Association Manager',
      street: '4730 Woodman Ave., #200',
      city_state_zip: 'Sherman Oaks, CA 91423',
      email: '',
    },
  },
  { key: 'mail_service', value: { enabled: false, price_note: '' } },
]
for (const s of settings) {
  const has = await must(sb.from('site_settings').select('key').eq('key', s.key).maybeSingle(), 'settings')
  if (!has) await must(sb.from('site_settings').insert(s), 'settings')
}

// ---------------------------------------------------------------------------
// Starter maintenance log: common-area items only. Add your own unit's entries on the site.
// ---------------------------------------------------------------------------

const incidents = [
  {
    title: 'Major water leak in the common garage',
    category: 'leak', location_type: 'common', location: 'Common garage',
    description: 'HOA plumbers investigated. No cause was diagnosed; the leak reportedly stopped on its own. Date to be confirmed.',
    diagnosed: false, resolved: false, fund: 'unknown', consent_confirmed: true,
  },
  {
    title: 'Contractors hired to seal areas of the roof',
    category: 'roof', location_type: 'common', location: 'Roof',
    description: 'The HOA hired contractors to seal areas of the roof. Scope, invoice, date and fund are not yet known; request the records.',
    diagnosed: null, resolved: false, fund: 'unknown', consent_confirmed: true,
  },
]
if (!(await sb.from('incidents').select('id').limit(1)).data?.length) {
  await must(sb.from('incidents').insert(incidents), 'incidents')
  console.log(`incidents: ${incidents.length}`)
}

const { data: chans } = await sb.from('channels').select('id').limit(1)
if (!chans?.length) {
  await must(
    sb.from('channels').insert([
      { name: 'general', topic: 'Anything building-related', kind: 'channel', created_by: null },
      { name: 'leaks-and-repairs', topic: 'Water, plumbing, roof and repair updates', kind: 'channel', created_by: null },
      { name: 'records-and-requests', topic: 'Coordinating records requests and Board letters', kind: 'channel', created_by: null },
    ]),
    'channels',
  )
  console.log('channels: 3')
}

console.log('\nDone.')
