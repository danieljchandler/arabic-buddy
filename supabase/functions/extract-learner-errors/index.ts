// extract-learner-errors — record what the tutor corrected in one turn of
// open conversation (docs/language-learning-plan-2026-09.md, Phase 1).
//
// Six scoring functions write learner_errors from a reference the learner was
// trying to match. The two surfaces where a learner produces the most Arabic —
// the free-chat text tutor and the realtime voice tutor — had no reference and
// recorded nothing, so the richest production source fed nothing into the
// mistake drill. This closes that: the client posts one completed turn, a
// UTILITY-lineup model lists the errors the tutor itself corrected, and the
// pure core (_shared/learnerErrorExtractionCore.ts) drops everything else.
//
// Fire-and-forget from the client's point of view: it never blocks a reply and
// a failure here costs the learner nothing but a missing drill row.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { recordLearnerErrors } from "../_shared/learnerErrors.ts";
import {
  buildExtractionPrompt,
  clipInput,
  CONVERSATION_SOURCES,
  normalizeExtraction,
  type ConversationSource,
  type RawExtraction,
} from "../_shared/learnerErrorExtractionCore.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";

function toDialect(d?: unknown): Dialect {
  if (d === "Egyptian") return "Egyptian";
  if (d === "Yemeni") return "Yemeni";
  return "Gulf";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  // Cheap per call, but it runs a model once per corrected turn, so it is
  // capped like every other model-calling function.
  const cap = await enforceDailyCap(req, "extract-learner-errors", 40, corsHeaders);
  if (cap.limited) return cap.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON body required" }), { status: 400, headers: jsonHeaders });
  }

  const source = body.source as ConversationSource;
  if (!CONVERSATION_SOURCES.includes(source)) {
    return new Response(
      JSON.stringify({ error: `source must be one of ${CONVERSATION_SOURCES.join(", ")}` }),
      { status: 400, headers: jsonHeaders },
    );
  }
  const userText = clipInput(body.userText);
  const assistantText = clipInput(body.assistantText);
  if (!userText || !assistantText) {
    return new Response(
      JSON.stringify({ error: "userText and assistantText are required" }),
      { status: 400, headers: jsonHeaders },
    );
  }
  const correction = typeof body.correction === "string" ? clipInput(body.correction) : null;
  const asrProvider = typeof body.asrProvider === "string" ? body.asrProvider.slice(0, 60) : null;
  const dialect = toDialect(body.dialect);
  const dialectLabel = getDialectLabel(dialect);

  const prompt = buildExtractionPrompt({ dialectLabel, source, userText, assistantText, correction });

  try {
    const brain = await askBrain<RawExtraction>({
      purpose: "learner_error_extraction",
      dialect,
      strategy: "solo",
      models: [MODEL_IDS.GEMINI_FAST],
      temperature: 0.1,
      maxTokens: 600,
      systemPromptExtra: prompt.systemPromptExtra,
      userPrompt: prompt.userPrompt,
      tool: prompt.tool,
      // The targets are the tutor's own corrections. A repair pass that
      // "fixed" them would change the record of what the tutor said, so the
      // leak scan stays read-only here.
      skipRepair: true,
      arabicTextPath: (p) => {
        const items = (p as RawExtraction | null)?.items;
        return Array.isArray(items)
          ? items.map((i) => (i as { target_arabic?: unknown })?.target_arabic).filter((t) => typeof t === "string").join("\n")
          : "";
      },
    });

    const rows = normalizeExtraction(brain.output, { source, dialect, asrProvider, correction });
    await recordLearnerErrors(cap.userId, rows);

    emitMetric({
      feature: "extract-learner-errors",
      event: "turn_extracted",
      dialect,
      status: "ok",
      count: rows.length,
      userId: cap.userId,
      meta: { source, model: brain.models[0] ?? null },
    });

    return new Response(JSON.stringify({ recorded: rows.length }), { headers: jsonHeaders });
  } catch (e) {
    if (e instanceof BrainHttpError) {
      const status = e.status === 429 ? 429 : e.status === 402 ? 402 : 502;
      return new Response(JSON.stringify({ error: "AI service unavailable" }), { status, headers: jsonHeaders });
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("extract-learner-errors error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders });
  }
});
