// Receives Lob tracking webhooks (first-class and certified letters) and updates the matching request:
// - Mailed: records the actual USPS acceptance date and re-estimates the deadline
// - Delivered (certified only): records the delivery date (the HOA's receipt) and sets the exact deadline
// - Processed for delivery (first-class has no delivery scan): uses that day as the estimated receipt
// - Pickup available / returned / re-routed / issue: notes it on the request's history
//
// Secret: LOB_WEBHOOK_SECRET (from the Lob dashboard when you create the webhook).
// Deploy with --no-verify-jwt; Lob signs requests instead.

import { computeDeadline, type Method } from "../_shared/deadlines.ts";
import { adminClient } from "../_shared/http.ts";

type Kind = "created" | "mailed" | "in_transit" | "local" | "out_for_delivery" | "delivered" | "pickup" | "returned" | "rerouted" | "issue";

const LABEL: Record<Kind, string> = {
  created: "Accepted by the mailing service",
  mailed: "Mailed (USPS accepted it)",
  in_transit: "In transit",
  local: "In local area",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  pickup: "USPS left a notice; awaiting pickup at the post office",
  returned: "Returned to sender",
  rerouted: "Re-routed",
  issue: "Delivery issue reported by USPS",
};

/** Lob's certified event ids look like "letter.certified.delivered"; match on the meaningful part. */
function kindOf(id: string): Kind | null {
  const s = id.toLowerCase();
  if (!s.startsWith("letter.")) return null;
  if (s.includes("returned")) return "returned";
  if (s.includes("pickup")) return "pickup";
  if (s.includes("re-routed") || s.includes("rerouted") || s.includes("re_routed")) return "rerouted";
  if (s.includes("issue")) return "issue";
  if (s.includes("processed_for_delivery")) return "out_for_delivery";
  if (s.includes("in_local_area")) return "local";
  if (s.includes("in_transit")) return "in_transit";
  if (s.includes("delivered")) return "delivered";
  if (s.includes("mailed")) return "mailed";
  if (s === "letter.created") return "created";
  return null;
}

const pacificDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);

async function verify(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get("LOB_WEBHOOK_SECRET");
  if (!secret) return false;
  const sig = req.headers.get("lob-signature");
  const ts = req.headers.get("lob-signature-timestamp");
  if (!sig || !ts) return false;
  // Reject replays older than 5 minutes (timestamp may be seconds or milliseconds)
  const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) return false;
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
  const kind = kindOf(event?.event_type?.id ?? "");
  const letter = event?.body ?? {};
  if (!kind || !letter.id) return new Response("ignored");

  const sb = adminClient();
  const { data: r } = await sb.from("requests").select("*").eq("mail_provider_id", letter.id).maybeSingle();
  if (!r) return new Response("no match");

  // Lob retries webhooks; skip an event we've already recorded
  const tag = `[${event.id ?? ""}]`;
  if (event.id) {
    const { count } = await sb.from("request_events").select("id", { count: "exact", head: true }).eq("request_id", r.id).like("note", `%${tag}%`);
    if (count) return new Response("duplicate");
  }

  // Use the USPS scan time when Lob includes it, otherwise when the event was created
  const scans: { time?: string; name?: string }[] = Array.isArray(letter.tracking_events) ? letter.tracking_events : [];
  const scanTime = scans.length ? scans[scans.length - 1].time : undefined;
  const at = new Date(scanTime ?? event.date_created ?? Date.now());
  const day = pacificDay(at);

  const patch: Record<string, unknown> = {
    tracking_status: LABEL[kind],
    tracking_updated_at: at.toISOString(),
    tracking_number: letter.tracking_number ?? r.tracking_number,
  };
  let note = `USPS: ${LABEL[kind]}`;
  let eventKind = "tracking";
  const open = r.status === "sent";

  if (kind === "mailed" && open && !r.received_date) {
    // Actual mailing date; re-estimate receipt with normal certified transit time until the delivery scan
    const d = computeDeadline({ type: r.type, method: r.method as Method, sentDate: day });
    Object.assign(patch, { sent_date: day, due_date: d.dueDate, received_estimated: true });
    note += ` on ${day}. Estimated deadline ${d.dueDate ?? "n/a"} until delivery is confirmed.`;
  }
  if (kind === "out_for_delivery" && open && r.method === "first_class") {
    // First-class mail never gets a "Delivered" scan, so the last USPS scan is the best receipt estimate
    const d = computeDeadline({ type: r.type, method: "first_class", sentDate: r.sent_date, receivedDate: day });
    Object.assign(patch, { due_date: d.dueDate, received_estimated: true });
    note += ` on ${day}. First-class mail has no delivery confirmation, so the deadline (${d.dueDate ?? "n/a"}) is estimated from this scan. Under CC&R §14.12, notice by first-class mail is complete when deposited.`;
  }
  if (kind === "delivered" && open) {
    const d = computeDeadline({ type: r.type, method: r.method as Method, sentDate: r.sent_date, receivedDate: day });
    Object.assign(patch, { status: "received", received_date: day, received_estimated: false, due_date: d.dueDate });
    note = `USPS: Delivered on ${day}. The HOA's deadline is ${d.dueDate ?? "n/a"} (${d.explanation})`;
    eventKind = "received";
  }
  if (kind === "pickup") {
    note += ". The deadline stays an estimate until it's picked up. If it is never claimed, CC&R §14.12 treats first-class mail as delivered when deposited; keep the tracking record.";
  }
  if (kind === "returned") {
    note += ". Keep the returned envelope unopened as evidence and check the HOA's address in Admin settings before re-sending. CC&R §14.12 treats first-class mail as delivered when deposited.";
  }

  await sb.from("requests").update(patch).eq("id", r.id);
  await sb.from("request_events").insert({ request_id: r.id, kind: eventKind, note: `${note} ${tag}`.trim(), created_by: null });
  return new Response("ok");
});
