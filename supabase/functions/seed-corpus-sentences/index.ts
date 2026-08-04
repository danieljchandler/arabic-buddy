// One-off seeder for public.dialect_corpus_sentences (Lisan Yemeni sample).
// Mirrors supabase/migrations/20260804140000_seed_yemeni_corpus_sentences.sql,
// which is too large to apply through the migration tool. Admin-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ROWS } from "./data.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "auth_required" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const { data: role } = await admin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!role) {
    return new Response(JSON.stringify({ error: "admin_only" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < ROWS.length; i += 500) {
    const batch = ROWS.slice(i, i + 500).map((r) => ({
      dialect: "Yemeni",
      text: r.t,
      token_count: r.n,
      source: "lisan",
      license: "CC BY 4.0",
      keyword_flagged: r.f,
    }));
    const { error } = await admin.from("dialect_corpus_sentences").insert(batch);
    if (error) errors.push(error.message);
    else inserted += batch.length;
  }

  const { count: total } = await admin
    .from("dialect_corpus_sentences")
    .select("id", { count: "exact", head: true })
    .eq("dialect", "Yemeni");

  return new Response(JSON.stringify({ inserted, total, errors }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
