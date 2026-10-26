// Receives Stripe webhooks for letter payments (see send-letter and _shared/stripe.ts):
// - checkout.session.completed (paid): mails the letter through Lob; refunds the owner if Lob rejects it
// - checkout.session.expired: closes the unpaid order and deletes its stored PDF
//
// Deploy with --no-verify-jwt; Stripe signs requests instead. Subscribe the endpoint to
// checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.expired.

import { adminClient } from "../_shared/http.ts";
import { mailLetter, type Service } from "../_shared/mailer.ts";
import { stripe, verifyStripe } from "../_shared/stripe.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Session = { id: string; payment_status: string; payment_intent: string | null; metadata?: { order_id?: string } };

async function fulfil(s: Session) {
  const admin = adminClient();
  const orderId = s.metadata?.order_id;
  if (!orderId) return;
  // Claim the order so a retried webhook can never mail the letter twice. A checkout the owner restarted
  // ("cancelled") can still be paid in a race; it's claimed too, and refunded below if the letter already went.
  const { data: order } = await admin
    .from("mail_orders")
    .update({ status: "processing", stripe_payment_intent: s.payment_intent, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["pending", "cancelled", "expired"])
    .select("*")
    .maybeSingle();
  if (!order) return;

  const done = (patch: Record<string, unknown>) =>
    admin.from("mail_orders").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", order.id);
  const refund = async (why: string) => {
    let note = `Payment of $${(order.amount_cents / 100).toFixed(2)} refunded: ${why}`;
    try {
      if (s.payment_intent) await stripe("refunds", { payment_intent: s.payment_intent, "metadata[order_id]": order.id });
      await done({ status: "refunded", error: why });
    } catch (e) {
      note = `The letter wasn't mailed (${why}) and the automatic refund failed (${e instanceof Error ? e.message : e}). The site admin needs to refund $${(order.amount_cents / 100).toFixed(2)} in Stripe.`;
      await done({ status: "failed", error: note });
    }
    if (order.request_id) await admin.from("request_events").insert({ request_id: order.request_id, kind: "note", note, created_by: null });
  };

  try {
    if (!order.request_id) return await refund("the request was deleted");
    const { data: profile } = await admin.from("profiles").select("display_name, unit_id, contact_email").eq("id", order.user_id).maybeSingle();
    const { data: u } = await admin.auth.admin.getUserById(order.user_id);
    if (!profile) return await refund("the owner's account is no longer active");
    const sent = await mailLetter({
      admin,
      requestId: order.request_id,
      service: order.service as Service,
      to: order.to_addr,
      from: order.from_addr,
      pdfPath: order.pdf_path,
      emailCopy: order.email_copy,
      sender: { id: order.user_id, display_name: profile.display_name, unit_id: profile.unit_id, email: profile.contact_email || u?.user?.email || null },
      paidCents: order.amount_cents,
    });
    if (sent.ok) await done({ status: "sent", error: null });
    else await refund(sent.error);
  } catch (e) {
    console.error(e);
    await refund(e instanceof Error ? e.message : String(e));
  }
}

async function expire(s: Session) {
  const admin = adminClient();
  const { data: order } = await admin
    .from("mail_orders")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("stripe_session_id", s.id)
    .in("status", ["pending", "cancelled"])
    .select("pdf_path")
    .maybeSingle();
  if (order) await admin.storage.from("attachments").remove([order.pdf_path]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!(await verifyStripe(req.headers.get("stripe-signature"), raw))) return new Response("bad signature", { status: 401 });
  const event = JSON.parse(raw);
  const s = event?.data?.object as Session;

  let work: Promise<unknown> | null = null;
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && s?.payment_status === "paid") {
    work = fulfil(s);
  } else if (event.type === "checkout.session.expired") {
    work = expire(s);
  }
  if (!work) return new Response("ignored");
  // Answer Stripe right away; mailing (Lob + email) continues in the background
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return new Response("ok");
});
