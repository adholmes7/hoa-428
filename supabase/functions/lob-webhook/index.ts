// Receives Lob tracking webhooks and updates the matching request.
// On delivery it records the received date and recomputes the deadline from it.
//
// Secret: LOB_WEBHOOK_SECRET (from the Lob dashboard when you create the webhook).
// Deploy with --no-verify-jwt; Lob signs requests instead.

import { computeDeadline, type Method } from "../_shared/deadlines.ts";
import { adminClient } from "../_shared/http.ts";

const LABELS: Record<string, string> = {
  "letter.certified.mailed": "Mailed",
  "letter.certified.in_transit": "In transit",
  "letter.certified.in_local_area": "In local area",
  "letter.certified.processed_for_delivery": "Out for delivery",
  "letter.certified.delivered": "Delivered",
  "letter.certified.pickup_available": "Available for pickup at post office",
  "letter.certified.re-routed": "Re-routed",
  "letter.certified.returned_to_sender": "Returned to sender",
  "letter.certified.issue": "Delivery issue",
  "letter.rendered_pdf": "Letter prepared",
  "letter.created": "Accepted by mailing service",
};

async function verify(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get("LOB_WEBHOOK_SECRET");
  if (!secret) return false;
  const sig = req.headers.get("lob-signature");
  const ts = req.headers.get("lob-signature-timestamp");
  if (!sig || !ts) return false;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${ts}.${raw}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!(await verify(req, raw))) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw);
  const type: string = event?.event_type?.id ?? "";
  const letter = event?.body ?? {};
  if (!letter.id || !LABELS[type]) return new Response("ignored");

  const sb = adminClient();
  const { data: r } = await sb.from("requests").select("*").eq("mail_provider_id", letter.id).maybeSingle();
  if (!r) return new Response("no match");

  const at = event.date_created ? new Date(event.date_created) : new Date();
  const label = LABELS[type];
  const patch: Record<string, unknown> = {
    tracking_status: label,
    tracking_updated_at: at.toISOString(),
    tracking_number: letter.tracking_number ?? r.tracking_number,
  };
  if (type === "letter.certified.delivered" && ["sent", "draft"].includes(r.status)) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at);
    const d = computeDeadline({ type: r.type, method: r.method as Method, sentDate: r.sent_date, receivedDate: day });
    Object.assign(patch, { status: "received", received_date: day, received_estimated: false, due_date: d.dueDate });
  }
  await sb.from("requests").update(patch).eq("id", r.id);
  await sb.from("request_events").insert({
    request_id: r.id,
    kind: type === "letter.certified.delivered" ? "received" : "tracking",
    note: `USPS: ${label}`,
    created_by: null,
  });
  return new Response("ok");
});
