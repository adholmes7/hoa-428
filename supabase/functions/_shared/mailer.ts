// Mailing a request letter through Lob (https://lob.com), shared by send-letter (admins, sent right away)
// and stripe-webhook (owners, sent once their payment clears).
//
// Secrets:
//   LOB_API_KEY   required. A test_ key accepts letters without mailing them.
//   LOB_API_BASE  optional, for local testing against a fake server

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { addCalendarDays, computeDeadline, todayISO } from "./deadlines.ts";
import { emailEnabled, hoaRecipients, sendLetterCopy } from "./email.ts";
import { envelopeTo, howSentText } from "./letter-copy.ts";

export type Addr = {
  name: string;
  company?: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
};

/** Parse "Name\nStreet\n[Line 2]\nCity, ST 12345" style text. */
export function parseAddress(text: string, fallbackName: string): Addr | null {
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
export const SERVICES = {
  first_class: { extra: null, price: 1.16, method: "first_class", label: "First-class mail" },
  certified: { extra: "certified", price: 8.11, method: "online_certified", label: "Certified Mail" },
  certified_rr: {
    extra: "certified_return_receipt",
    price: 11.02,
    method: "online_certified",
    label: "Certified Mail with electronic return receipt",
  },
} as const;
export type Service = keyof typeof SERVICES;

export const lobKey = () => Deno.env.get("LOB_API_KEY") ?? null;
export const lobTest = () => Boolean(lobKey()?.startsWith("test_"));

export async function associationAddress(sb: SupabaseClient) {
  const { data: setting } = await sb.from("site_settings").select("value").eq("key", "association").maybeSingle();
  return {
    name: "Four Twenty-Eight Hill Street Homeowners Association",
    care_of: "c/o LBPM",
    attn: "Attn: Lida Ibrahimpasic",
    street: "4730 Woodman Ave., #200",
    city_state_zip: "Sherman Oaks, CA 91423",
    ...(setting?.value ?? {}),
  } as Record<string, string>;
}

/** Envelope addresses for a letter, or a message saying what's wrong. */
export function envelopes(a: Record<string, string>, returnAddress: string | undefined, owner: { display_name: string; unit_id: number }) {
  const env = envelopeTo(a as Parameters<typeof envelopeTo>[0]);
  const to = parseAddress(`${env.name}\n${env.street}\n${env.cityStateZip}`, env.name);
  const from = parseAddress(
    returnAddress?.trim() || `${owner.display_name}\n428 Hill Street, Unit ${owner.unit_id}\nSanta Monica, CA 90405`,
    owner.display_name,
  );
  if (!to) return { error: "The association address in Admin settings couldn't be read" } as const;
  if (!from) return { error: 'Return address must end with a line like "Santa Monica, CA 90405"' } as const;
  to.company = env.company;
  return { to, from } as const;
}

type Sender = { id: string; display_name: string; unit_id: number; email: string | null };

/**
 * Send a draft request's letter (a PDF already in the attachments bucket) through Lob, mark the request sent with
 * tracking and the deadline estimate, save the PDF on the request, and email the copy if asked.
 * Uses the service-role client, since after a payment there's no signed-in caller.
 */
export async function mailLetter(o: {
  admin: SupabaseClient;
  requestId: string;
  service: Service;
  to: Addr;
  from: Addr;
  pdfPath: string;
  emailCopy: boolean;
  sender: Sender;
  paidCents?: number | null;
}): Promise<{ ok: true; id: string; tracking_number: string | null; test: boolean; expected_delivery_date: string | null; email: unknown } | { ok: false; error: string; status: number }> {
  const { admin, sender } = o;
  const key = lobKey();
  if (!key) return { ok: false, error: "The mailing service isn't set up yet. An admin needs to add a Lob API key.", status: 503 };
  const service = SERVICES[o.service];
  const { data: r } = await admin.from("requests").select("*").eq("id", o.requestId).maybeSingle();
  if (!r) return { ok: false, error: "The request was deleted before it could be mailed", status: 404 };
  if (r.status !== "draft") return { ok: false, error: "This request has already been sent", status: 409 };

  const { data: att, error: attErr } = await admin
    .from("attachments")
    .insert({
      request_id: r.id,
      storage_path: o.pdfPath,
      file_name: `request-${r.ref_no}-as-mailed.pdf`,
      mime_type: "application/pdf",
      label: `Letter as mailed (${service.label})`,
      uploaded_by: sender.id,
    })
    .select("id")
    .single();
  if (attErr) throw attErr;
  // Lob fetches the PDF from a short-lived link
  const { data: signed, error: signErr } = await admin.storage.from("attachments").createSignedUrl(o.pdfPath, 60 * 60);
  if (signErr) throw signErr;

  const base = (Deno.env.get("LOB_API_BASE") ?? "https://api.lob.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/letters`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      description: `428 Hill owner request #${r.ref_no}`.slice(0, 255),
      to: o.to,
      from: o.from,
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
    // The letter wasn't accepted, so don't keep it as "as mailed"
    await admin.from("attachments").delete().eq("id", att.id);
    return { ok: false, error: out?.error?.message ?? "The mailing service rejected the letter", status: 502 };
  }

  // Lob prints and hands the letter to USPS on its send date; until the delivery scan, estimate
  // receipt from Lob's expected delivery date (falling back to the method's transit estimate)
  const test = key.startsWith("test_");
  const sentDate = typeof out.send_date === "string" ? out.send_date.slice(0, 10) : todayISO();
  const expected = typeof out.expected_delivery_date === "string" ? out.expected_delivery_date.slice(0, 10) : null;
  const d = computeDeadline({ type: r.type, method: service.method, sentDate, receivedDate: expected });
  await admin
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
      mail_paid_cents: o.paidCents ?? null,
    })
    .eq("id", r.id);
  await admin.from("request_events").insert({
    request_id: r.id,
    kind: "sent",
    note: [
      `${service.label} via Lob (${out.id})`,
      test ? "TEST MODE, not mailed" : null,
      o.paidCents ? `paid $${(o.paidCents / 100).toFixed(2)} by card` : null,
      expected ? `expected delivery ${expected}` : `estimated delivery ${addCalendarDays(sentDate, 4)}`,
      d.dueDate ? `estimated deadline ${d.dueDate} until USPS confirms delivery` : null,
    ]
      .filter(Boolean)
      .join("; "),
    created_by: sender.id,
  });

  let email: unknown = null;
  if (o.emailCopy && emailEnabled()) {
    const { data: file } = await admin.storage.from("attachments").download(o.pdfPath);
    const a = await associationAddress(admin);
    email = await sendLetterCopy({
      sb: admin,
      requestId: r.id,
      refNo: r.ref_no,
      subject: r.title,
      ownerName: sender.display_name,
      ownerEmail: sender.email,
      hoa: hoaRecipients(a),
      pdf: new Uint8Array(await file!.arrayBuffer()),
      howSent: howSentText(service.label, sentDate, out.tracking_number),
      test,
      letterText: r.letter_body,
      actorId: sender.id,
    });
  }
  return { ok: true, id: out.id, tracking_number: out.tracking_number ?? null, test, expected_delivery_date: expected, email };
}
