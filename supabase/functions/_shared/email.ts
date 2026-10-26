// Email copies of request letters, sent through Resend (https://resend.com).
//
// Secrets:
//   RESEND_API_KEY   required to send email copies
//   MAIL_FROM        sender on a domain verified in Resend, e.g. "428 Hill Street Owners <letters@428hillstreet.com>"
//   RESEND_API_BASE  optional, for local testing against a fake server

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export function emailEnabled() {
  return Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("MAIL_FROM"));
}

const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);

/** The HOA addresses from Admin settings: the manager email plus any board emails (comma or line separated). */
export function hoaRecipients(association: Record<string, unknown>): string[] {
  const raw = [association.email, association.board_email].filter((x) => typeof x === "string").join(",");
  return [...new Set(raw.split(/[,;\n]/).map((s) => s.trim()).filter(isEmail))];
}

type Copy = {
  sb: SupabaseClient; // service-role client, for the history entry
  requestId: string;
  refNo: number;
  subject: string;
  ownerName: string;
  ownerEmail: string | null;
  hoa: string[];
  pdf: Uint8Array;
  howSent: string; // e.g. "USPS Certified Mail on Oct 28, 2026 (tracking 9407...)"
  test: boolean;
  actorId: string;
};

/**
 * Email the letter PDF to the HOA with the owner copied, as a courtesy copy of the mailed letter.
 * In Lob test mode only the owner gets it, so the board never receives a copy of a letter that wasn't mailed.
 * Records the result on the request's history; never throws.
 */
export async function sendLetterCopy(c: Copy): Promise<{ ok: boolean; to: string[]; error?: string }> {
  const to = c.test ? [] : c.hoa;
  const cc = c.ownerEmail && isEmail(c.ownerEmail) ? [c.ownerEmail] : [];
  if (to.length === 0 && cc.length === 0) return { ok: false, to: [], error: "No email addresses to send to" };

  const prefix = c.test ? "[TEST, not mailed] " : "";
  const text = [
    c.hoa.length && !c.test ? "To the Board of Directors," : `Hi ${c.ownerName},`,
    "",
    c.test
      ? `This is a test copy of request #${c.refNo}. The mailing service is in test mode, so nothing was mailed and the board was not emailed.`
      : `Attached is a copy of a letter from ${c.ownerName}, sent to the Association by ${c.howSent}. This email is a courtesy copy for reference; the mailed letter is the formal delivery.`,
    "",
    c.test ? "" : `Please reply to ${c.ownerName}${cc.length ? ` at ${cc[0]}` : ""}.`,
    "",
    "Sent from the 428 Hill Street owners' portal.",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");

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
        from: Deno.env.get("MAIL_FROM"),
        to: to.length ? to : cc,
        cc: to.length ? cc : undefined,
        reply_to: cc.length ? cc : undefined,
        subject: `${prefix}${c.subject} (Unit owner request #${c.refNo})`.slice(0, 250),
        text,
        attachments: [{ filename: `request-${c.refNo}.pdf`, content: b64 }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const out = await res.json().catch(() => ({}));
    result = res.ok ? { ok: true, to: [...to, ...cc] } : { ok: false, to: [], error: out?.message ?? `Email service error ${res.status}` };
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
