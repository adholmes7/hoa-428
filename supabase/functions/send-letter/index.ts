// Sends a request letter through Lob (https://lob.com) by USPS first-class mail, Certified Mail, or
// Certified Mail with electronic return receipt, then marks the request as sent and records tracking
// and the deadline estimate.
//
// Secrets:
//   LOB_API_KEY         required. A test_ key accepts letters without mailing them.
//   MAIL_MONTHLY_LIMIT  optional: letters per unit per calendar month, default 4
//   LOB_API_BASE        optional, for local testing against a fake server
//
// POST { status: true }                      -> { enabled, test, limit, used, price_note, email: { enabled, hoa } }
// POST { request_id, pdf_base64, return_address, service, email_copy } -> sends the letter
//   email_copy (default true): also email the PDF to the HOA with the owner copied (see _shared/email.ts)
//   service: "first_class" | "certified" | "certified_rr"

import { addCalendarDays, computeDeadline, requestType, todayISO } from "../_shared/deadlines.ts";
import { emailEnabled, hoaRecipients, sendLetterCopy } from "../_shared/email.ts";
import { adminClient, cors, json, requireOwner } from "../_shared/http.ts";

type Addr = {
  name: string;
  company?: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
};

/** Parse "Name\nStreet\n[Line 2]\nCity, ST 12345" style text. */
function parseAddress(text: string, fallbackName: string): Addr | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const last = lines[lines.length - 1].match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!last) return null;
  const body = lines.slice(0, -1);
  // If the first line has no digits it's a name line
  const name = body.length > 1 && !/\d/.test(body[0]) ? body.shift()! : fallbackName;
  return {
    name: name.slice(0, 40),
    address_line1: body[0],
    address_line2: body[1],
    address_city: last[1].replace(/,$/, ""),
    address_state: last[2].toUpperCase(),
    address_zip: last[3],
  };
}

// Lob Developer-plan list prices (Oct 2026): B&W first-class letter $1.06, certified $6.95,
// certified with electronic return receipt $9.86, each extra page (the address page) $0.10
const SERVICES = {
  first_class: { extra: null, price: 1.16, method: "first_class", label: "First-class mail" },
  certified: { extra: "certified", price: 8.11, method: "online_certified", label: "Certified Mail" },
  certified_rr: {
    extra: "certified_return_receipt",
    price: 11.02,
    method: "online_certified",
    label: "Certified Mail with electronic return receipt",
  },
} as const;
type Service = keyof typeof SERVICES;

function monthStart() {
  return todayISO().slice(0, 8) + "01";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const owner = await requireOwner(req);
    if ("error" in owner) return owner.error;
    const { sb, profile, user } = owner;

    const key = Deno.env.get("LOB_API_KEY");
    const limit = Number(Deno.env.get("MAIL_MONTHLY_LIMIT") ?? 4);
    const admin = adminClient();
    // Count this unit's letters mailed through the service this month (service role, so private requests count too)
    const { count: used } = await admin
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", profile.unit_id)
      .eq("mail_provider", "lob")
      .gte("sent_date", monthStart());

    const body = await req.json().catch(() => ({}));
    if (body.admin_log) {
      // Admins see every letter sent through the service, including private requests (no letter text)
      if (profile.role !== "admin") return json({ error: "Admins only" }, 403);
      const { data } = await admin
        .from("requests")
        .select("id, ref_no, unit_id, type, title, visibility, sent_date, status, tracking_status, mail_cost_estimate")
        .eq("mail_provider", "lob")
        .order("sent_date", { ascending: false })
        .limit(200);
      return json({
        letters: (data ?? []).map((l) => ({ ...l, title: l.visibility === "private" ? "(private request)" : l.title })),
      });
    }
    if (body.status) {
      const { data: setting } = await sb.from("site_settings").select("value").eq("key", "mail_service").maybeSingle();
      const { data: assoc } = await sb.from("site_settings").select("value").eq("key", "association").maybeSingle();
      return json({
        email: { enabled: emailEnabled(), hoa: hoaRecipients(assoc?.value ?? {}), owner: profile.contact_email || user.email || null },
        enabled: Boolean(key),
        test: Boolean(key?.startsWith("test_")),
        limit,
        used: used ?? 0,
        price_note: setting?.value?.price_note ?? "",
        prices: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.price])),
      });
    }

    if (!key) return json({ error: "The mailing service isn't set up yet. An admin needs to add a Lob API key." }, 503);
    if ((used ?? 0) >= limit) {
      return json({ error: `Your unit has already mailed ${limit} letters through the service this month. Ask the site admin if you need more.` }, 429);
    }

    const { request_id, pdf_base64, return_address } = body;
    if (!(body.service in SERVICES)) return json({ error: "Choose a mailing option" }, 400);
    const service = SERVICES[body.service as Service];
    const { data: r } = await sb.from("requests").select("*").eq("id", request_id).maybeSingle();
    if (!r || r.unit_id !== profile.unit_id) return json({ error: "Request not found" }, 404);
    if (r.status !== "draft") return json({ error: "This request has already been sent" }, 409);
    if (body.service === "first_class" && requestType(r.type)?.requiresCertified) {
      return json({ error: "This request must go by certified mail or personal delivery (CC&R §7.3)." }, 400);
    }

    const { data: setting } = await sb.from("site_settings").select("value").eq("key", "association").maybeSingle();
    const a = {
      name: "Four Twenty-Eight Hill Street Homeowners Association",
      care_of: "c/o LBPM",
      attn: "Attn: Lida Ibrahimpasic",
      street: "4730 Woodman Ave., #200",
      city_state_zip: "Sherman Oaks, CA 91423",
      ...(setting?.value ?? {}),
    };
    const to = parseAddress(`Board of Directors\n${a.street}\n${a.city_state_zip}`, "Board of Directors");
    const from = parseAddress(
      return_address?.trim() || `${profile.display_name}\n428 Hill Street, Unit ${profile.unit_id}\nSanta Monica, CA 90405`,
      profile.display_name,
    );
    if (!to) return json({ error: "The association address in Admin settings couldn't be read" }, 400);
    if (!from) return json({ error: 'Return address must end with a line like "Santa Monica, CA 90405"' }, 400);
    to.company = `${a.name} ${a.care_of}`.slice(0, 40);

    const pdf = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
    if (pdf.length > 5_000_000) return json({ error: "Letter PDF is too large" }, 400);

    // Save the exact PDF being mailed on the request (proof of contents), then give Lob a short-lived link to it
    const path = `${user.id}/${crypto.randomUUID()}-request-${r.ref_no}-as-mailed.pdf`;
    const { error: upErr } = await sb.storage.from("attachments").upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;
    const { data: att, error: attErr } = await sb
      .from("attachments")
      .insert({
        request_id: r.id,
        storage_path: path,
        file_name: `request-${r.ref_no}-as-mailed.pdf`,
        mime_type: "application/pdf",
        size_bytes: pdf.length,
        label: `Letter as mailed (${service.label})`,
        uploaded_by: user.id,
      })
      .select("id")
      .single();
    if (attErr) throw attErr;
    const { data: signed, error: signErr } = await admin.storage.from("attachments").createSignedUrl(path, 60 * 60);
    if (signErr) throw signErr;

    const base = (Deno.env.get("LOB_API_BASE") ?? "https://api.lob.com").replace(/\/$/, "");
    const res = await fetch(`${base}/v1/letters`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `428 Hill owner request #${r.ref_no}`.slice(0, 255),
        to,
        from,
        file: signed.signedUrl,
        color: false,
        double_sided: false,
        // Our letters aren't laid out for the envelope window, so Lob adds an address page in front
        address_placement: "insert_blank_page",
        mail_type: "usps_first_class",
        extra_service: service.extra,
        use_type: "operational",
        metadata: { request_id: r.id },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Lob error", res.status, out);
      // The letter wasn't accepted, so don't keep the "as mailed" copy
      await sb.from("attachments").delete().eq("id", att.id);
      await sb.storage.from("attachments").remove([path]);
      return json({ error: out?.error?.message ?? "The mailing service rejected the letter" }, 502);
    }

    // Lob prints and hands the letter to USPS on its send date; until the delivery scan, estimate
    // receipt from Lob's expected delivery date (falling back to the method's transit estimate)
    const test = key.startsWith("test_");
    const sentDate = typeof out.send_date === "string" ? out.send_date.slice(0, 10) : todayISO();
    const expected = typeof out.expected_delivery_date === "string" ? out.expected_delivery_date.slice(0, 10) : null;
    const d = computeDeadline({ type: r.type, method: service.method, sentDate, receivedDate: expected });
    await sb
      .from("requests")
      .update({
        status: "sent",
        method: service.method,
        sent_date: sentDate,
        mail_provider: "lob",
        mail_provider_id: out.id,
        carrier: "USPS",
        // First-class letters have no USPS tracking number; Lob's mail scans still arrive by webhook
        tracking_number: out.tracking_number ?? null,
        tracking_status: test ? "Test mode: not actually mailed" : "Accepted by the mailing service",
        tracking_updated_at: new Date().toISOString(),
        due_date: d.dueDate,
        received_date: null,
        received_estimated: true,
        mail_cost_estimate: service.price,
      })
      .eq("id", r.id);
    await sb.from("request_events").insert({
      request_id: r.id,
      kind: "sent",
      note: [
        `${service.label} via Lob (${out.id})`,
        test ? "TEST MODE, not mailed" : null,
        expected ? `expected delivery ${expected}` : `estimated delivery ${addCalendarDays(sentDate, 4)}`,
        d.dueDate ? `estimated deadline ${d.dueDate} until USPS confirms delivery` : null,
      ]
        .filter(Boolean)
        .join("; "),
      created_by: user.id,
    });
    let email: Awaited<ReturnType<typeof sendLetterCopy>> | null = null;
    if (body.email_copy !== false && emailEnabled()) {
      email = await sendLetterCopy({
        sb: admin,
        requestId: r.id,
        refNo: r.ref_no,
        subject: r.title,
        ownerName: profile.display_name,
        ownerEmail: profile.contact_email || user.email || null,
        hoa: hoaRecipients(setting?.value ?? {}),
        pdf,
        howSent: `${service.label} via USPS, mailing ${sentDate}${out.tracking_number ? ` (tracking ${out.tracking_number})` : ""}`,
        test,
        actorId: user.id,
      });
    }
    return json({ ok: true, id: out.id, tracking_number: out.tracking_number ?? null, test, expected_delivery_date: expected, email });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
