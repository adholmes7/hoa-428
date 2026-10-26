// Emails a copy of a request letter the owner mailed themselves to the HOA, with the owner copied.
// (Letters sent with "Mail it for me" get their copy from send-letter.)
//
// POST { request_id, pdf_base64 } -> { ok, to } or { error }

import { emailEnabled, hoaRecipients, sendLetterCopy } from "../_shared/email.ts";
import { METHODS, type Method } from "../_shared/deadlines.ts";
import { adminClient, cors, json, requireOwner } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const owner = await requireOwner(req);
    if ("error" in owner) return owner.error;
    const { sb, profile, user } = owner;
    if (!emailEnabled()) return json({ error: "Email copies aren't set up yet. An admin needs to add the email service key." }, 503);

    const { request_id, pdf_base64 } = await req.json().catch(() => ({}));
    const { data: r } = await sb.from("requests").select("*").eq("id", request_id).maybeSingle();
    if (!r || r.unit_id !== profile.unit_id) return json({ error: "Request not found" }, 404);
    if (r.status === "draft") return json({ error: "Mark the letter as sent first" }, 409);
    const pdf = Uint8Array.from(atob(pdf_base64 ?? ""), (c) => c.charCodeAt(0));
    if (pdf.length === 0 || pdf.length > 5_000_000) return json({ error: "Letter PDF is missing or too large" }, 400);

    const { data: setting } = await sb.from("site_settings").select("value").eq("key", "association").maybeSingle();
    const how = METHODS[r.method as Method]?.label ?? "mail";
    const result = await sendLetterCopy({
      sb: adminClient(),
      requestId: r.id,
      refNo: r.ref_no,
      subject: r.title,
      ownerName: profile.display_name,
      ownerEmail: profile.contact_email || user.email || null,
      hoa: hoaRecipients(setting?.value ?? {}),
      pdf,
      howSent: `${how}${r.sent_date ? ` on ${r.sent_date}` : ""}${r.tracking_number ? ` (tracking ${r.tracking_number})` : ""}`,
      test: false,
      letterText: r.letter_body,
      actorId: user.id,
    });
    return result.ok ? json(result) : json({ error: result.error }, 502);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
