// Mails a request letter through Lob (see _shared/mailer.ts) by USPS first-class mail, Certified Mail, or
// Certified Mail with electronic return receipt.
//
// Owners pay for each letter by card: { checkout: true } starts a Stripe Checkout and stripe-webhook mails the
// letter once the payment clears. Admins can also send right away at the site's expense.
//
// Secrets: LOB_API_KEY (see mailer.ts), STRIPE_* (see stripe.ts), RESEND_* (see email.ts), and
//   MAIL_MONTHLY_LIMIT  optional: letters per unit per calendar month, default 4
//
// POST { status: true }   -> { enabled, test, limit, used, price_note, payment, prices, owner_prices, email }
// POST { admin_log: true } -> every letter mailed through the site (admins only)
// POST { request_id, pdf_base64, return_address, service, email_copy, checkout? }
//   checkout: true  -> { url } of the Stripe payment page
//   otherwise       -> sends now (admins only)

import { requestType, todayISO } from "../_shared/deadlines.ts";
import { emailEnabled, hoaRecipients, mailFrom } from "../_shared/email.ts";
import { adminClient, cors, json, requireOwner } from "../_shared/http.ts";
import { associationAddress, envelopes, lobKey, lobTest, mailLetter, SERVICES, type Service } from "../_shared/mailer.ts";
import { ownerPriceCents, paymentsReady, stripe } from "../_shared/stripe.ts";

const monthStart = () => todayISO().slice(0, 8) + "01";

/** Where Stripe sends the owner back to: this site (or a local dev server), never an arbitrary origin. */
function returnOrigin(req: Request, siteUrl: unknown) {
  const o = req.headers.get("origin") ?? "";
  if (/^https:\/\/(www\.)?428hillstreet\.com$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)) return o;
  if (typeof siteUrl === "string" && siteUrl && o === siteUrl.replace(/\/$/, "")) return o;
  return typeof siteUrl === "string" && siteUrl ? siteUrl.replace(/\/$/, "") : "https://428hillstreet.com";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const owner = await requireOwner(req);
    if ("error" in owner) return owner.error;
    const { sb, profile, user } = owner;
    const isAdmin = profile.role === "admin";

    const key = lobKey();
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
      if (!isAdmin) return json({ error: "Admins only" }, 403);
      const { data } = await admin
        .from("requests")
        .select("id, ref_no, unit_id, type, title, visibility, sent_date, status, tracking_status, mail_cost_estimate, mail_paid_cents")
        .eq("mail_provider", "lob")
        .order("sent_date", { ascending: false })
        .limit(200);
      return json({
        letters: (data ?? []).map((l) => ({ ...l, title: l.visibility === "private" ? "(private request)" : l.title })),
      });
    }

    const pay = paymentsReady();
    if (body.status) {
      const { data: setting } = await sb.from("site_settings").select("value").eq("key", "mail_service").maybeSingle();
      return json({
        email: { enabled: emailEnabled(), from: mailFrom(), hoa: hoaRecipients(await associationAddress(sb)), owner: profile.contact_email || user.email || null },
        enabled: Boolean(key),
        test: lobTest(),
        limit,
        used: used ?? 0,
        price_note: setting?.value?.price_note ?? "",
        // "card": pays by card first; "free": admin may send at the site's expense (or pay, to try checkout)
        payment: { card: pay.ok, free: isAdmin, why: pay.ok ? null : pay.why },
        prices: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.price])),
        owner_prices: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, ownerPriceCents(v.price) / 100])),
      });
    }

    if (!key) return json({ error: "The mailing service isn't set up yet. An admin needs to add a Lob API key." }, 503);
    if ((used ?? 0) >= limit) {
      return json({ error: `Your unit has already mailed ${limit} letters through the service this month. Ask the site admin if you need more.` }, 429);
    }
    const checkout = Boolean(body.checkout);
    if (!checkout && !isAdmin) return json({ error: "Letters are paid for by card. Reload the page and try again." }, 403);
    if (checkout && !pay.ok) return json({ error: pay.why }, 503);

    const { request_id, pdf_base64, return_address } = body;
    if (!(body.service in SERVICES)) return json({ error: "Choose a mailing option" }, 400);
    const serviceKey = body.service as Service;
    const service = SERVICES[serviceKey];
    const { data: r } = await sb.from("requests").select("*").eq("id", request_id).maybeSingle();
    if (!r || r.unit_id !== profile.unit_id) return json({ error: "Request not found" }, 404);
    if (r.status !== "draft") return json({ error: "This request has already been sent" }, 409);
    if (serviceKey === "first_class" && requestType(r.type)?.requiresCertified) {
      return json({ error: "This request must go by certified mail or personal delivery (CC&R §7.3)." }, 400);
    }
    const env = envelopes(await associationAddress(sb), return_address, profile);
    if ("error" in env) return json({ error: env.error }, 400);

    const pdf = Uint8Array.from(atob(pdf_base64 ?? ""), (c) => c.charCodeAt(0));
    if (pdf.length === 0 || pdf.length > 5_000_000) return json({ error: "Letter PDF is missing or too large" }, 400);
    // Keep the exact PDF being mailed (it becomes the "as mailed" copy on the request)
    const path = `${user.id}/${crypto.randomUUID()}-request-${r.ref_no}-as-mailed.pdf`;
    const { error: upErr } = await sb.storage.from("attachments").upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;
    const emailCopy = body.email_copy !== false;

    if (!checkout) {
      const sent = await mailLetter({
        admin,
        requestId: r.id,
        service: serviceKey,
        to: env.to,
        from: env.from,
        pdfPath: path,
        emailCopy,
        sender: { id: user.id, display_name: profile.display_name, unit_id: profile.unit_id, email: profile.contact_email || user.email || null },
      });
      if (!sent.ok) {
        await admin.storage.from("attachments").remove([path]);
        return json({ error: sent.error }, sent.status);
      }
      return json(sent);
    }

    // Starting over (e.g. after backing out of the payment page) closes any earlier unpaid checkout for this letter
    const { data: open } = await admin.from("mail_orders").select("id, stripe_session_id").eq("request_id", r.id).eq("status", "pending");
    for (const o of open ?? []) {
      if (o.stripe_session_id) await stripe(`checkout/sessions/${o.stripe_session_id}/expire`).catch(() => null);
      await admin.from("mail_orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", o.id).eq("status", "pending");
    }

    const amount = ownerPriceCents(service.price);
    const { data: order, error: oErr } = await admin
      .from("mail_orders")
      .insert({
        request_id: r.id,
        user_id: user.id,
        unit_id: profile.unit_id,
        service: serviceKey,
        email_copy: emailCopy,
        to_addr: env.to,
        from_addr: env.from,
        pdf_path: path,
        amount_cents: amount,
        lob_cost: service.price,
      })
      .select("id")
      .single();
    if (oErr) throw oErr;

    const { data: siteUrl } = await sb.from("site_settings").select("value").eq("key", "site_url").maybeSingle();
    const origin = returnOrigin(req, siteUrl?.value);
    let session: { id: string; url: string };
    try {
      session = await stripe<{ id: string; url: string }>("checkout/sessions", {
      mode: "payment",
      success_url: `${origin}/requests/${r.id}?paid=${order.id}`,
      cancel_url: `${origin}/requests/${r.id}?mail=cancelled`,
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "payment_intent_data[metadata][order_id]": order.id,
      "payment_intent_data[description]": `428 Hill owner request #${r.ref_no}: ${service.label}`,
      customer_email: profile.contact_email || user.email || undefined,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": amount,
      "line_items[0][price_data][product_data][name]": `${service.label}: owner request #${r.ref_no}`,
      "line_items[0][price_data][product_data][description]":
        `Printed and mailed by USPS to the HOA board. $${service.price.toFixed(2)} printing and postage plus card processing.`,
      // Stripe's minimum; an unpaid checkout closes after this
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      });
    } catch (e) {
      await admin.from("mail_orders").update({ status: "failed", error: String(e) }).eq("id", order.id);
      await admin.storage.from("attachments").remove([path]);
      return json({ error: `The payment page couldn't be opened: ${e instanceof Error ? e.message : e}` }, 502);
    }
    await admin.from("mail_orders").update({ stripe_session_id: session.id, checkout_url: session.url }).eq("id", order.id);
    return json({ url: session.url, order_id: order.id });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
