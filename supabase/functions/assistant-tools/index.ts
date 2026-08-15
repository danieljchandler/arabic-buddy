// Tool execution for the live voice tutor.
//
// The text assistant plans and runs its lookups inside `assistant-chat`,
// because it owns the whole turn. A Realtime voice session does not work that
// way: the model emits a function call over the WebRTC data channel, the
// browser is the only thing listening, and the result has to go back the same
// way. So the browser needs somewhere to send it — this.
//
// The browser is not trusted with any of it. It relays a tool name and
// arguments; the URL allow-list, the learner's identity, and every query run
// on their behalf are resolved here from their JWT and the page context they
// posted. `read_source` in particular can only ever open a URL the caller
// also sent as part of their context, which is why the whole context comes
// along rather than just the URL.
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireActiveSubscription } from "../_shared/usageCap.ts";
import { allowedUrlsFromContext } from "../_shared/assistantToolsCore.ts";
import { executeAssistantTool } from "../_shared/assistantTools.ts";
import { clampPageContext, VOICE_BUDGET, type PageContextPayload } from "../_shared/pageContextCore.ts";
import type { Dialect } from "../_shared/dialectTypes.ts";

interface RequestBody {
  name?: string;
  args?: Record<string, unknown>;
  dialect?: Dialect;
  pageContext?: PageContextPayload;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Same gate as the voice session itself: this only exists to serve a live
  // call, and a live call is subscribers-only.
  const cap = await requireActiveSubscription(req, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = (await req.json()) as RequestBody;
    const name = typeof body.name === "string" ? body.name : "";
    const args = body.args && typeof body.args === "object" ? body.args : {};
    const dialect: Dialect = body.dialect || "Gulf";

    if (!name) {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const page = clampPageContext(body.pageContext, VOICE_BUDGET);
    const result = await executeAssistantTool(name, args, {
      userId: cap.userId,
      dialect,
      allowedUrls: allowedUrlsFromContext(page.document?.sourceUrl),
      currentSourceId: page.document?.sourceId,
    });

    // Always 200 with a readable body: a refusal is a result the model should
    // relay ("I can only open the source behind what you're looking at"), not
    // an error that leaves the call hanging on a promise that never resolves.
    return new Response(JSON.stringify({ ok: result.ok, text: result.text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("assistant-tools error", err);
    return new Response(
      JSON.stringify({ ok: false, text: "That lookup failed. Tell the learner you couldn't check." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
