# 428 Hill Street owners' portal

A private website for the 22 owners of 428 Hill Street. Owners can:

- **File requests with the Board** as ready-to-mail letters with the required legal wording: records requests, maintenance notices, meet and confer (CC&R §12.5, with §12.5 attached automatically), Request for Resolution (Civ. Code §5935), flooring/architectural approval, appeals, estoppel, lease approval, seller documents, and special-meeting petitions.
- **Track every request against its deadline.** Record how it was sent and when the HOA received it. The site counts business days (skipping California holidays) or calendar days, flags overdue requests, and offers the next step (deemed denied/approved, escalate).
- **Send Certified Mail without a printer** (optional). The letter goes to Lob, which prints it and mails it by USPS Certified Mail with an electronic return receipt. Tracking updates arrive automatically, and the delivery date starts the clock.
- **Read the CC&Rs** section by section with search and links (`/ccrs/6.3`), plus the budget, reserve study and insurance documents.
- **Keep shared records:** a maintenance and incident log, Board meetings and minutes (flags minutes later than 30 days), and finance charts.
- **Walk through the budget:** where the money comes from and goes (a flow diagram), what each unit's dues pay for, every line item, what changed, and the reserve fund's 30-year outlook under each funding plan.
- **Chat** (opt-in): public channels, private group chats and direct messages, in real time.
- **Ask the assistant:** an AI helper that answers from the CC&Rs and documents, cites sections, and can start the right request.
- **Use it on a phone:** the layout is mobile-first, and owners can add it to their home screen like an app.

Only owners can get in. Each unit gets a hand-delivered letter with a unique code. An account sees nothing until it claims a unit with that code, and every database table enforces this with row-level security.

## How it's built

| Piece | Service | Cost |
|---|---|---|
| Website (static React app) | GitHub Pages, your domain | Free (domain about $12/yr) |
| Accounts, database, file storage, live chat | Supabase free tier | Free |
| AI assistant | Claude Haiku 5.5 via the Anthropic API (or any OpenAI-compatible API) | About $0.001 per question |
| Certified mail (optional) | Lob | About $6–9 per letter |
| Login emails (recommended) | Resend free tier as SMTP | Free |

The code in this repository is safe to make public. **HOA documents never go into the repository.** They live in Supabase storage behind owner-only access and are loaded from the `private-data/` folder, which git ignores. Records obtained as a member can't be published (Civ. Code §5230).

```
web/                 React app (Vite + TypeScript)
supabase/migrations  Database schema and security rules
supabase/functions   Server code: assistant, send-letter (Lob), lob-webhook
supabase/functions/_shared/deadlines.ts   Request types, deadline rules, CA holidays
scripts/seed.mjs     Loads units, CC&Rs, documents, finance figures
scripts/parse_ccrs.py  Splits the CC&R text into sections
private-data/        Your HOA files (not committed)
```

## Setup, step by step

You need a GitHub account, a domain, and about an hour.

### 1. Supabase project

1. Create a free account at [supabase.com](https://supabase.com) and a new project (region: West US). Save the database password.
2. In **Project Settings → API**, copy the **Project URL**, the **anon public** key and the **service_role** key. Keep the service_role key secret; it bypasses all security.
3. From this folder, push the schema:

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref YOUR-PROJECT-REF
   ```

   ```bash
   npx supabase db push
   ```

4. In **Authentication → URL Configuration**, set **Site URL** to `https://your-domain.com` and add `https://your-domain.com/reset` to Redirect URLs.
5. In **Authentication → Providers → Email**, keep "Confirm email" on.
6. Recommended: Supabase's built-in email sends only a few messages per hour. Create a free [Resend](https://resend.com) account, verify your domain, and enter its SMTP details under **Authentication → Emails → SMTP Settings**.

### 2. Load the data

```bash
cd web && npm install && cd ..
```

```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY node scripts/seed.mjs --bootstrap-unit 18
```

This loads the units, all 140 CC&R sections, the five PDFs with their page text (for search and the assistant), the finance figures, and the starter channels. It also prints a **bootstrap code for Unit 18**: your own code for signing up first.

If the CC&R text changes, re-run `python3 scripts/parse_ccrs.py private-data/text/428_HillStreet_CCRs_Final.txt private-data/seed/ccr_sections.json` before seeding.

### 3. Server functions

```bash
npx supabase functions deploy assistant
```

```bash
npx supabase functions deploy send-letter
```

```bash
npx supabase functions deploy lob-webhook --no-verify-jwt
```

**AI assistant:** create an API key in the [Anthropic Console](https://console.anthropic.com) (Settings → API Keys; add a little prepaid credit under Billing), then:

```bash
npx supabase secrets set AI_PROVIDER=anthropic AI_MODEL=claude-haiku-5-5 ANTHROPIC_API_KEY=your-key
```

Each owner gets 20 questions a day (`AI_DAILY_LIMIT`). Claude Haiku 5.5 costs about a tenth of a cent per question here, and Anthropic doesn't train on API data. To use an OpenAI-compatible provider instead (OpenRouter, Groq, Gemini), unset `AI_PROVIDER` and set `AI_BASE_URL`, `AI_MODEL` (comma-separated fallbacks allowed) and `AI_API_KEY`.

### 4. Website on GitHub Pages

1. Create a GitHub repository (it can be public) and push this folder to `main`.
2. In the repository, go to **Settings → Secrets and variables → Actions → Variables** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY`. (The anon key is designed to be public; security comes from the database rules.)
3. Go to **Settings → Pages** and set **Source** to "GitHub Actions". The **Deploy site** workflow runs on every push.
4. Custom domain: in **Settings → Pages**, enter your domain. At your registrar, point it to GitHub:
   - an apex domain (`example.com`): A records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - a subdomain (`owners.example.com`): a CNAME to `YOUR-GITHUB-USERNAME.github.io`

   Then tick **Enforce HTTPS**.
5. The **Keep database awake** workflow pings Supabase twice a week so the free project doesn't pause.

### 5. Become the admin and invite owners

1. Open your site, choose **Create an account**, confirm your email, then claim Unit 18 with the bootstrap code.
2. Make yourself admin:

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs --make-admin your@email.com
   ```

3. On the site, open **Admin**:
   - Check **Where letters go**, and add the manager's email if you have one (used by "Email copy").
   - Under **Invite letters**, select the units (unit numbers default to 1–22; edit `scripts/seed.mjs` if the building numbers differ), check the website address, and generate. You get one PDF with a letter per unit to print and hand-deliver. Codes are shown once; only their hash is stored. Each code works for up to 3 people in that unit.
4. When a unit sells, pause the old accounts in Admin and generate a new code for that unit.

### 6. Optional: Certified Mail through Lob

1. Create an account at [lob.com](https://lob.com). Start with the **test** API key: Lob accepts letters but doesn't mail them.
2. Set the key:

   ```bash
   npx supabase secrets set LOB_API_KEY=test_xxx
   ```

3. In the Lob dashboard, add a webhook to `https://YOUR-PROJECT.supabase.co/functions/v1/lob-webhook` for the `letter.certified.*` events, then:

   ```bash
   npx supabase secrets set LOB_WEBHOOK_SECRET=the-webhook-secret
   ```

4. In **Admin → Certified mail service**, turn on the button and add a cost note.
5. Send one test letter, check it in the Lob dashboard, then switch to the live key.

Lob puts an address cover page in front of the letter (`insert_blank_page`), so each letter has one extra page. Without Lob, owners can mail at the post office or upload the PDF to an online certified-mail service, then type the tracking number into the site.

## Running it locally

Requires Docker.

```bash
npx supabase start
```

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase status> node scripts/seed.mjs --bootstrap-unit 18
```

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

```bash
npm --prefix web run dev
```

Put `AI_PROVIDER=mock` in `supabase/functions/.env` to test the assistant without a key. Copy `web/.env.example` to `web/.env.local` with the local URL and anon key. Login emails appear in Mailpit at http://127.0.0.1:54324.

## Guardrails built in

- Owners-only access on every table and file, enforced in the database.
- Requests can be marked **private to the unit**. Drafts are always private.
- Other owners' email and phone stay hidden unless they opt in. Chat is off until each owner turns it on.
- Maintenance-log entries require a consent statement: first-hand knowledge, common area or your own unit, no other owner's personal details.
- The site is labeled as independent, not an official HOA site, and is hidden from search engines.
- Letters state facts and cite sections. The assistant is told not to characterize individuals.

## Things to verify

- **Unit numbers** are assumed to be 1–22.
- **Deadlines:** the request types in `supabase/functions/_shared/deadlines.ts` cite their sources. Have an HOA attorney review them once, especially the special-meeting petition (marked VERIFY).
- **Holidays:** business-day counting uses California judicial holidays. Calendar-day deadlines that land on a weekend or holiday roll to the next business day.
- **The CC&R copy on file has blank signature and notary blocks.** Confirm the recorded version with the LA County Recorder.
- **The CC&Rs cite pre-2014 Civil Code numbers** (e.g. §1350, §1363.03). The Davis-Stirling Act was renumbered to §§4000–6150 in 2014; the letters use current numbers.
- **Budget walkthrough figures** were transcribed by hand from the scanned budget (PDF pp. 5–7) and the reserve study's 30-year table (PDF p. 11). All category totals match the printed subtotals to the cent. The data lives in `private-data/seed/budget_2026.json` and `reserve_projection.json`.
- **The manager's email:** the OCR reads "4041@ibpm.com", which is probably 4041@lbpm.com. Confirm before using it.

Not legal advice.
