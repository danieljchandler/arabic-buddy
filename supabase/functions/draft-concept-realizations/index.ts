// Clip pipeline: draft per-dialect surface forms for vocabulary concepts.
//
// vocab_concepts is language-neutral ('dog', 'good_morning'); mining can only
// search the caption index once each concept has dialect realizations with
// spelling variants. This function drafts them with askBrain into
// concept_realizations as status='draft' — the native-review lane approves or
// rejects, and mine-clip-candidates only ever uses approved rows. Same
// draft→approve shape as dialect_rules.
//
// Variants are the load-bearing part: caption search is word-boundary exact,
// so without الكلب listed as a variant of كلب every definite occurrence is
// invisible. The prompt asks for cliticized and spelling variants explicitly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";
import { normalizeArabic } from "../_shared/msaLeakDetector.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isContentManager(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user?.id) return false;
  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "content_reviewer"]);
  return Array.isArray(roles) && roles.length > 0;
}

async function hasPipelineSecret(req: Request): Promise<boolean> {
  return await hasSharedSecret(req, "x-pipeline-secret", "CLIP_PIPELINE_SECRET");
}

interface DraftedRealization {
  concept_key: string;
  surface: string;
  variants: string[];
  phonetic?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!(await hasPipelineSecret(req)) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const dialect = typeof body.dialect === "string" ? body.dialect : null;
    if (!dialect || !["Gulf", "Egyptian", "Yemeni"].includes(dialect)) {
      return json({ error: "dialect_required" }, 400, corsHeaders);
    }
    // One model call drafts a batch; bounded so the call stays reliable.
    const limit = Math.max(1, Math.min(20, Number(body.limit) || 10));
    const onlyKeys: string[] = Array.isArray(body.conceptKeys)
      ? body.conceptKeys.filter((k: unknown) => typeof k === "string")
      : [];

    // Concepts that have no realization for this dialect yet (any status —
    // a rejected draft is a decision, not a gap).
    let conceptQuery = admin()
      .from("vocab_concepts")
      .select("id, key, english_gloss, category")
      .order("sort_order", { ascending: true });
    if (onlyKeys.length > 0) conceptQuery = conceptQuery.in("key", onlyKeys);
    const { data: conceptRows, error: conceptErr } = await conceptQuery;
    if (conceptErr) throw new Error(`vocab_concepts fetch failed: ${conceptErr.message}`);
    const concepts = (conceptRows ?? []) as Array<{ id: string; key: string; english_gloss: string; category: string }>;

    const { data: existingRows } = await admin()
      .from("concept_realizations")
      .select("concept_id")
      .eq("dialect", dialect);
    const has = new Set(
      ((existingRows ?? []) as Array<{ concept_id: string }>).map((r) => r.concept_id),
    );
    const targets = concepts.filter((c) => !has.has(c.id)).slice(0, limit);
    if (targets.length === 0) {
      return json({ drafted: 0, note: "every concept already has realizations" }, 200, corsHeaders);
    }

    const conceptList = targets
      .map((c) => `- ${c.key}: "${c.english_gloss}" (${c.category})`)
      .join("\n");

    const brain = await askBrain<{ realizations: DraftedRealization[] }>({
      purpose: "concept_realizations",
      dialect,
      strategy: "solo",
      models: [...getLineup("CONTENT").drafters],
      // Single words in isolation confuse the MSA repair pass; the native
      // review lane is the quality gate for these, not the repairer.
      skipRepair: true,
      maxTokens: 3000,
      temperature: 0.2,
      userPrompt:
        `For each concept below, give the everyday SPOKEN ${dialect} Arabic word or phrase — ` +
        `the form a native speaker actually says, never MSA/فصحى.\n\n${conceptList}\n\n` +
        `For each: "surface" is the most common informal Arabic spelling. "variants" lists ` +
        `OTHER written forms a YouTube caption might use for the same spoken word: the ` +
        `definite form with ال, common alternative spellings (ج/چ, و/ؤ, hamza variants), and ` +
        `frequent cliticized forms (والـ, بالـ). 2-5 variants each. "phonetic" is a simple ` +
        `Latin transliteration. If a concept has two genuinely common ${dialect} words, pick ` +
        `the most common as surface and put the other in variants.`,
      tool: {
        name: "emit_realizations",
        description: `Spoken ${dialect} realizations for the listed concepts.`,
        parameters: {
          type: "object",
          properties: {
            realizations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concept_key: { type: "string" },
                  surface: { type: "string" },
                  variants: { type: "array", items: { type: "string" } },
                  phonetic: { type: "string" },
                },
                required: ["concept_key", "surface", "variants"],
              },
            },
          },
          required: ["realizations"],
        },
      },
    });

    const byKey = new Map(targets.map((c) => [c.key, c]));
    const rows = (brain.output?.realizations ?? [])
      .filter((r) => byKey.has(r.concept_key) && typeof r.surface === "string" && r.surface.trim())
      .map((r) => ({
        concept_id: byKey.get(r.concept_key)!.id,
        dialect,
        surface: r.surface.trim(),
        // Deduplicate against the surface post-normalization; a variant that
        // normalizes identically adds search noise, not coverage.
        variants: [...new Set(
          (r.variants ?? [])
            .map((v) => String(v).trim())
            .filter((v) => v && normalizeArabic(v) !== normalizeArabic(r.surface)),
        )].slice(0, 6),
        phonetic: r.phonetic?.trim() || null,
        status: "draft",
        source: `ai:${brain.models.join(",")}`,
      }));

    if (rows.length > 0) {
      const { error: insertErr } = await admin()
        .from("concept_realizations")
        .upsert(rows as unknown as never, {
          onConflict: "concept_id,dialect,surface",
          ignoreDuplicates: true,
        });
      if (insertErr) throw new Error(`concept_realizations insert failed: ${insertErr.message}`);
    }

    return json(
      {
        drafted: rows.length,
        requested: targets.length,
        dialect,
        keys: rows.map((r) => targets.find((t) => t.id === r.concept_id)?.key ?? "?"),
        note: "drafts await native review before mining can use them",
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    console.error("[draft-concept-realizations] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
