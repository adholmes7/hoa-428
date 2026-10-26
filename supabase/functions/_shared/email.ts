// Email copies of request letters, sent through Resend (https://resend.com).
// The wording lives in letter-copy.ts so the website can preview exactly what is sent.
//
// Secrets:
//   RESEND_API_KEY   required to send email copies
//   MAIL_FROM        sender on a domain verified in Resend, e.g. "428 Hill Street Owners <letters@428hillstreet.com>"
//   RESEND_API_BASE  optional, for local testing against a fake server

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { composeLetterCopy, type LetterCopyInput } from "./letter-copy.ts";

export { hoaRecipients } from "./letter-copy.ts";

export function emailEnabled() {
  return Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("MAIL_FROM"));
}

export const mailFrom = () => Deno.env.get("MAIL_FROM") ?? null;

type Copy = LetterCopyInput & {
  sb: SupabaseClient; // service-role client, for the history entry
  requestId: string;
  pdf: Uint8Array;
  actorId: string;
};

/** Email the letter PDF (see composeLetterCopy for who gets it). Records the result on the request's history; never throws. */
export async function sendLetterCopy(c: Copy): Promise<{ ok: boolean; to: string[]; error?: string }> {
  const m = composeLetterCopy(c);
  if (m.to.length === 0) return { ok: false, to: [], error: "No email addresses to send to" };

  let b64 = "";
  for (let i = 0; i < c.pdf.length; i += 0x8000) b64 += String.fromCharCode(...c.pdf.subarray(i, i + 0x8000));
  b64 = btoa(b64);

  const base = (Deno.env.get("RESEND_API_BASE") ?? "https://api.resend.com").replace(/\/$/, "");
  let result: { ok: boolean; to: string[]; error?: string };
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mailFrom(),
        to: m.to,
        cc: m.cc.length ? m.cc : undefined,
        reply_to: m.replyTo.length ? m.replyTo : undefined,
        subject: m.subject,
        text: m.text,
        attachments: [{ filename: m.attachment, content: b64 }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const out = await res.json().catch(() => ({}));
    result = res.ok ? { ok: true, to: [...m.to, ...m.cc] } : { ok: false, to: [], error: out?.message ?? `Email service error ${res.status}` };
  } catch (e) {
    result = { ok: false, to: [], error: e instanceof Error ? e.message : String(e) };
  }

  await c.sb.from("request_events").insert({
    request_id: c.requestId,
    kind: "note",
    note: result.ok
      ? `Email copy sent to ${result.to.join(", ")}${c.test ? " (test mode: the board was not emailed)" : ""}`
      : `Email copy not sent: ${result.error}`,
    created_by: c.actorId,
  });
  return result;
}
