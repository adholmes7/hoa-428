// Owner assistant: answers questions from the CC&Rs and HOA documents and suggests requests.
//
// Works with any OpenAI-compatible chat API. Configure with secrets:
//   AI_API_KEY   (required)
//   AI_BASE_URL  default https://generativelanguage.googleapis.com/v1beta/openai  (Google Gemini, free tier)
//   AI_MODEL     default gemini-flash-latest; may be a comma-separated list (fallbacks, OpenRouter only)
//   AI_DAILY_LIMIT  questions per owner per day, default 40
// Set AI_PROVIDER=mock to test without a key (returns the retrieved passages).

import { REQUEST_TYPES } from "../_shared/deadlines.ts";
import { adminClient, cors, json, requireOwner } from "../_shared/http.ts";

type Msg = { role: "user" | "assistant"; content: string };
type Ctx = { kind: string; ref: string; title: string; content: string; page: number | null };

const SITE_GUIDE = `
This is the independent owners' portal for 428 Hill Street, Santa Monica (Four Twenty-Eight Hill Street HOA, 22 units, managed by LBPM). Pages:
- Requests (/requests): owners file written requests to the Board. "New request" walks through: pick type, fill details, review the generated letter, save draft, download PDF, record how it was sent (personal, first-class, certified, certified with return receipt, online certified service, email). Then record the delivery date (from USPS tracking or the return receipt); the site computes the legal deadline and flags it when overdue. Owners can record the HOA's response, mark deemed denied/approved, attach files, and escalate.
- CC&Rs (/ccrs): searchable, linkable by section, e.g. /ccrs/6.3.
- Documents (/documents): budget, reserve study, insurance, records obtained.
- Who is responsible? (/responsibilities): plain-language maintenance and leak responsibility matrix.
- Maintenance log (/incidents), Board meetings (/meetings), Finances (/finances), Owner chat (/chat, opt-in), Search (/search), Profile (/profile).
Request types (id: label — deadline):
${REQUEST_TYPES.map((t) => `- ${t.id}: ${t.label} — ${t.days ? `${t.days} ${t.dayType} days (${t.legalBasis})` : "no deadline"}`).join("\n")}
Key delivery rule (CC&R §14.12): notices go by personal delivery or first-class mail; email counts only if the recipient agreed to email in writing. Architectural/flooring requests must go by personal delivery or certified mail to the Secretary (§7.3). Official address: c/o LBPM, 4730 Woodman Ave. #200, Sherman Oaks, CA 91423, Attn: Lida Ibrahimpasic.
`;

const RULES = `You are the helper for this owners' portal. Answer in plain, short language.
- Base answers on the PASSAGES provided and the site guide. Cite CC&R sections as §6.3(c) style and documents by title and page. If the passages don't cover it, say so and suggest where to look or what to request. Never invent section numbers, figures, or deadlines.
- You are not a lawyer; for anything with real stakes, add a one-line suggestion to confirm with an HOA attorney. Don't repeat that disclaimer every paragraph.
- Stick to facts about the documents. Don't characterize or speculate about individual owners, Board members, or the manager.
- When the owner should send something to the Board, say which request type fits and why, and then end your reply with exactly one line:
SUGGEST: {"type":"<request type id>","description":"<one or two factual sentences the owner can use as a starting point>"}
- Use short paragraphs or bullet lists. Keep it under about 250 words unless asked for more.`;

function extractSuggest(text: string) {
  const m = text.match(/^\s*SUGGEST:\s*(\{.*\})\s*$/m);
  if (!m) return { answer: text.trim(), suggest: null };
  let suggest: { type: string; description: string } | null = null;
  try {
    const parsed = JSON.parse(m[1]);
    if (REQUEST_TYPES.some((t) => t.id === parsed.type)) suggest = { type: parsed.type, description: String(parsed.description ?? "") };
  } catch {
    /* ignore malformed */
  }
  return { answer: text.replace(m[0], "").trim(), suggest };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const owner = await requireOwner(req);
    if ("error" in owner) return owner.error;
    const { sb, user } = owner;

    const body = await req.json().catch(() => ({}));
    const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: Msg) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10)
      .map((m: Msg) => ({ role: m.role, content: m.content.slice(0, 4000) }));
    const question = [...messages].reverse().find((m) => m.role === "user")?.content;
    if (!question) return json({ error: "Ask a question" }, 400);

    // Daily limit per owner (protects the free API quota)
    const limit = Number(Deno.env.get("AI_DAILY_LIMIT") ?? 40);
    const admin = adminClient();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const { data: usage } = await admin.from("ai_usage").select("count").eq("user_id", user.id).eq("day", today).maybeSingle();
    const used = usage?.count ?? 0;
    if (used >= limit) return json({ error: `You've reached today's limit of ${limit} questions. It resets at midnight.` }, 429);

    // Retrieval: keyword search over CC&Rs and documents, plus any sections cited by number
    const prevUser = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join(" ");
    const { data: hits, error: ctxErr } = await sb.rpc("assistant_context", { q: prevUser });
    if (ctxErr) throw ctxErr;
    const ctx: Ctx[] = (hits as Ctx[]) ?? [];
    const cited = [...new Set([...prevUser.matchAll(/(?:§|section\s+)(\d{1,2}\.\d{1,2})/gi)].map((m) => m[1]))];
    for (const id of cited) {
      if (ctx.some((c) => c.kind === "ccr" && c.ref === id)) continue;
      const { data } = await sb.from("ccr_sections").select("id, title, text, pdf_page").eq("id", id).maybeSingle();
      if (data) ctx.unshift({ kind: "ccr", ref: data.id, title: data.title, content: data.text.slice(0, 4000), page: data.pdf_page });
    }
    const passages = ctx
      .map((c) =>
        c.kind === "ccr"
          ? `[CC&R §${c.ref} ${c.title}, PDF p.${c.page}]\n${c.content.replace(/\s+/g, " ")}`
          : `[Document: ${c.title}, p.${c.page}]\n${c.content.replace(/\s+/g, " ")}`
      )
      .join("\n\n---\n\n");
    const sources = ctx.map(({ kind, ref, title, page }) => ({ kind, ref, title, page }));

    let text: string;
    if (Deno.env.get("AI_PROVIDER") === "mock") {
      text = `(Test mode: no AI key configured.) I found ${ctx.length} relevant passages: ${
        ctx.map((c) => (c.kind === "ccr" ? `§${c.ref}` : c.title)).join(", ")
      }.`;
    } else {
      const key = Deno.env.get("AI_API_KEY");
      if (!key) return json({ error: "The assistant isn't set up yet. An admin needs to add an AI API key (see the README)." }, 503);
      const base = (Deno.env.get("AI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
      // AI_MODEL may list fallbacks, comma-separated; OpenRouter tries them in order if one is unavailable
      const models = (Deno.env.get("AI_MODEL") ?? "gemini-flash-latest").split(",").map((m) => m.trim()).filter(Boolean);
      const model = models[0];
      const fallbacks = base.includes("openrouter.ai") && models.length > 1 ? { models } : {};
      const chatMessages = [
        { role: "system", content: `${RULES}\n\nSITE GUIDE:${SITE_GUIDE}` },
        { role: "system", content: `PASSAGES:\n\n${passages || "(no matching passages found)"}` },
        ...messages,
      ];
      const call = (params: Record<string, unknown>) =>
        fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: chatMessages, ...fallbacks, ...params }),
        });
      let res = await call({ temperature: 0.2, max_tokens: 1200 });
      // Newer OpenAI models reject temperature and max_tokens; retry once with the parameters they accept
      if (res.status === 400) {
        const body = await res.clone().text();
        if (/max_tokens|temperature|unsupported/i.test(body)) res = await call({ max_completion_tokens: 2000 });
      }
      if (!res.ok) {
        const detail = await res.text();
        console.error("AI provider error", res.status, detail.slice(0, 500));
        // Pass the provider's own message through (it never contains the key) so setup problems are diagnosable
        let reason = "";
        try {
          const parsed = JSON.parse(detail);
          reason = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message ?? "";
        } catch {
          reason = detail.slice(0, 200);
        }
        if (res.status === 429) {
          return json({ error: `The AI service is busy or its free allowance is used up (shared by all owners). Try again later.${reason ? ` Details: ${reason}` : ""}` }, 502);
        }
        return json({ error: `The AI service returned an error (${res.status} from ${model})${reason ? `: ${reason}` : "."}` }, 502);
      }
      const out = await res.json();
      text = out.choices?.[0]?.message?.content ?? "";
    }

    await admin.from("ai_usage").upsert({ user_id: user.id, day: today, count: used + 1 });
    const { answer, suggest } = extractSuggest(text);
    return json({ answer, suggest, sources: sources.slice(0, 8), remaining: limit - used - 1 });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
