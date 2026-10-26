// Sends a request letter through Lob (https://lob.com) as USPS Certified Mail with electronic
// return receipt, then marks the request as sent and stores the tracking number.
//
// Secrets: LOB_API_KEY (use a test_ key first: Lob accepts the letter but doesn't mail it).
// Optional: LOB_EXTRA_SERVICE (default certified_return_receipt; or certified).

import { computeDeadline } from "../_shared/deadlines.ts";
import { cors, json, requireOwner } from "../_shared/http.ts";

type Addr = { name: string; company?: string; address_line1: string; address_line2?: string; address_city: string; address_state: string; address_zip: string };

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

function appendAddr(form: FormData, prefix: string, a: Addr) {
  for (const [k, v] of Object.entries(a)) if (v) form.append(`${prefix}[${k}]`, v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const owner = await requireOwner(req);
    if ("error" in owner) return owner.error;
    const { sb, profile } = owner;

    const key = Deno.env.get("LOB_API_KEY");
    if (!key) return json({ error: "The mailing service isn't configured. An admin needs to add a Lob API key." }, 503);

    const { request_id, pdf_base64, return_address } = await req.json();
    const { data: r } = await sb.from("requests").select("*").eq("id", request_id).maybeSingle();
    if (!r || r.unit_id !== profile.unit_id) return json({ error: "Request not found" }, 404);
    if (r.status !== "draft") return json({ error: "This request has already been sent" }, 409);

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

    const form = new FormData();
    form.append("description", `428 Hill owner request #${r.ref_no}`.slice(0, 255));
    appendAddr(form, "to", to);
    appendAddr(form, "from", from);
    form.append("file", new Blob([pdf], { type: "application/pdf" }), `request-${r.ref_no}.pdf`);
    form.append("color", "false");
    form.append("double_sided", "false");
    form.append("address_placement", "insert_blank_page");
    form.append("extra_service", Deno.env.get("LOB_EXTRA_SERVICE") ?? "certified_return_receipt");
    form.append("use_type", "operational");
    form.append("metadata[request_id]", r.id);

    const res = await fetch("https://api.lob.com/v1/letters", {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
      body: form,
    });
    const out = await res.json();
    if (!res.ok) {
      console.error("Lob error", out);
      return json({ error: out?.error?.message ?? "The mailing service rejected the letter" }, 502);
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const d = computeDeadline({ type: r.type, method: "online_certified", sentDate: today });
    const test = key.startsWith("test_");
    await sb.from("requests").update({
      status: "sent",
      method: "online_certified",
      sent_date: today,
      mail_provider: "lob",
      mail_provider_id: out.id,
      carrier: "USPS",
      tracking_number: out.tracking_number ?? null,
      tracking_status: test ? "Test mode: not actually mailed" : "Submitted to mailing service",
      tracking_updated_at: new Date().toISOString(),
      due_date: d.dueDate,
      received_estimated: true,
    }).eq("id", r.id);
    await sb.from("request_events").insert({
      request_id: r.id,
      kind: "sent",
      note: `Certified Mail via Lob (${out.id})${test ? " — TEST MODE, not mailed" : ""}${out.expected_delivery_date ? `; expected delivery ${out.expected_delivery_date}` : ""}`,
      created_by: profile.id,
    });
    return json({ ok: true, id: out.id, tracking_number: out.tracking_number ?? null, test });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
