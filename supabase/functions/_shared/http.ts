import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Supabase client acting as the signed-in caller (row-level security applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

/** Service-role client. Bypasses row-level security; use only for narrow, checked writes. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export async function requireOwner(req: Request) {
  const sb = userClient(req);
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: json({ error: "Sign in first" }, 401) } as const;
  const { data: profile } = await sb.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (!profile || !profile.active) return { error: json({ error: "Owners only" }, 403) } as const;
  return { sb, user: auth.user, profile } as const;
}
