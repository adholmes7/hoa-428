// Card payments for mailed letters through Stripe Checkout (https://stripe.com/docs/payments/checkout).
// Owners pay Lob's cost plus Stripe's fee on Stripe's own page; the site never sees card details.
//
// Secrets:
//   STRIPE_SECRET_KEY      sk_test_... or sk_live_... (or a restricted rk_ key with Checkout Sessions and Refunds write)
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint for stripe-webhook
//   STRIPE_API_BASE        optional, for local testing against a fake server

import { lobKey } from "./mailer.ts";

const key = () => Deno.env.get("STRIPE_SECRET_KEY") ?? null;
const stripeTest = () => /^(sk|rk)_test_/.test(key() ?? "");

/**
 * Whether owners can pay for letters. Stripe and Lob must both be in test mode or both live:
 * test payments must never mail real letters, and real payments must never go to test letters.
 */
export function paymentsReady(): { ok: true } | { ok: false; why: string } {
  if (!key() || !Deno.env.get("STRIPE_WEBHOOK_SECRET")) return { ok: false, why: "Online payment isn't set up yet." };
  const lobIsTest = Boolean(lobKey()?.startsWith("test_"));
  if (stripeTest() !== lobIsTest) {
    return { ok: false, why: "Payments and mailing are in different modes (one is test, one is live), so mailing is paused." };
  }
  return { ok: true };
}

/** What the owner pays, in cents: Lob's price plus Stripe's card fee (2.9% + 30¢), rounded up. */
export function ownerPriceCents(lobPrice: number) {
  return Math.ceil((Math.round(lobPrice * 100) + 30) / (1 - 0.029));
}

function form(params: Record<string, string | number | undefined>) {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) f.append(k, String(v));
  return f;
}

export async function stripe<T = Record<string, unknown>>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const base = (Deno.env.get("STRIPE_API_BASE") ?? "https://api.stripe.com").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
    signal: AbortSignal.timeout(20_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message ?? `Stripe error ${res.status}`);
  return out as T;
}

/** Check the Stripe-Signature header (t=timestamp,v1=hex HMAC of "t.body"), rejecting events older than 5 minutes. */
export async function verifyStripe(header: string | null, raw: string): Promise<boolean> {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const pairs = header.split(",").map((p) => p.trim().split("=", 2));
  const t = pairs.find(([k]) => k === "t")?.[1];
  const sigs = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.includes(hex);
}
