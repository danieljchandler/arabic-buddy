// screen-shared-content — AI triage for content shared into the app.
//
// The share sheet delivers a bare payload (a message, a screenshot) with no
// intent attached. This function makes one call to the cheapest model in the
// registry, with a forced tool call (same shape as assistantToolRouter.ts),
// to decide which feature the payload belongs to — and converts it on the way:
// a screenshot of a chat comes back as the extracted Arabic text ready for
// /translate, a meme screenshot is flagged for the meme analyzer.
//
// Deterministic cases (audio files, video files, known URLs) never reach this
// function — src/lib/shareRouting.ts routes them client-side for free.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { DEFAULT_FAST } from "../_shared/modelRegistry.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const MAX_TEXT_CHARS = 4000;
// A downscaled screenshot data URI; generous but bounded.
const MAX_IMAGE_CHARS = 2_000_000;

const DESTINATIONS = ["translate", "how_do_i_say", "meme", "none"] as const;
type Destination = (typeof DESTINATIONS)[number];

interface ScreenShape {
  destination?: string;
  extracted_text?: string;
  reason?: string;
}

const SCREEN_TOOL = {
  name: "route_shared_content",
  description: "Decide which feature the shared content belongs to.",
  parameters: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        enum: [...DESTINATIONS],
        description:
          "translate: Arabic text the user wants to understand (message, caption, screenshot of text/chat). " +
          "how_do_i_say: English text asking how to express something in Arabic. " +
          "meme: an image that is a meme or humorous social-media post where the joke/visual matters, not just the text. " +
          "none: nothing an Arabic-learning app can work with.",
      },
      extracted_text: {
        type: "string",
        description:
          "For translate: the Arabic text, cleaned of UI chrome/emoji-only lines — transcribed verbatim from the image when the input is a screenshot. " +
          "For how_do_i_say: the English phrase to express. Empty otherwise.",
      },
      reason: { type: "string", description: "One short sentence for the routing decision." },
    },
    required: ["destination"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  `You triage content shared into Hakiya, an app for learning spoken Arabic. You do not answer or translate beyond what the tool call asks for.\n\n` +
  `Rules:\n` +
  `- Text containing Arabic the user likely wants to understand → translate, with the Arabic as extracted_text.\n` +
  `- English text that asks (or implies wanting) how to say something in Arabic → how_do_i_say, with the English phrase as extracted_text.\n` +
  `- A screenshot of a chat, post, sign, menu, or document whose value is its TEXT → translate; transcribe the Arabic verbatim into extracted_text, top to bottom, skipping usernames, timestamps and UI labels.\n` +
  `- An image that is a meme or joke post, where understanding needs the visual context → meme.\n` +
  `- Mixed Arabic/English chat: extract only the Arabic lines.\n` +
  `- Nothing usable (a selfie, a landscape photo, gibberish) → none.`;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cap = await enforceDailyCap(req, "screen-shared-content", 30, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const requestedDialect = typeof body?.dialect === "string" ? body.dialect : "Gulf";
    const dialect: Dialect = ["Gulf", "Egyptian", "Yemeni"].includes(requestedDialect)
      ? requestedDialect
      : "Gulf";

    if (!text && !imageBase64) {
      return new Response(JSON.stringify({ error: "missing_content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (imageBase64 && (!imageBase64.startsWith("data:image/") || imageBase64.length > MAX_IMAGE_CHARS)) {
      return new Response(JSON.stringify({ error: "invalid_image" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const promptText = imageBase64
      ? `Route this shared image.${text ? ` It was shared with this caption:\n"""\n${text}\n"""` : ""}`
      : `Route this shared text:\n"""\n${text}\n"""`;

    const userPrompt = imageBase64
      ? [
          { type: "text" as const, text: promptText },
          { type: "image_url" as const, image_url: { url: imageBase64 } },
        ]
      : promptText;

    let destination: Destination;
    let extractedText = "";
    let reason = "";
    let fallback = false;

    try {
      const result = await askBrain<ScreenShape>({
        purpose: "screen-shared-content",
        dialect,
        strategy: "solo",
        // The router transcribes but writes no Arabic of its own; skip the
        // MSA repair machinery.
        skipRepair: true,
        models: [DEFAULT_FAST],
        maxTokens: 1500,
        temperature: 0,
        callTimeoutMs: 20_000,
        budgetMs: 25_000,
        tool: SCREEN_TOOL,
        systemPromptExtra: SYSTEM_PROMPT,
        userPrompt,
      });

      const out = result.output ?? {};
      destination = (DESTINATIONS as readonly string[]).includes(out.destination ?? "")
        ? (out.destination as Destination)
        : "none";
      extractedText = typeof out.extracted_text === "string" ? out.extracted_text.trim() : "";
      reason = typeof out.reason === "string" ? out.reason : "";
    } catch (err) {
      // A screener that cannot decide falls back to the most likely home:
      // shared text goes to translate as-is, a shared image to the meme
      // analyzer (which does its own OCR). The share still lands somewhere.
      console.warn("[screen-shared-content] screening failed:", err);
      destination = text && !imageBase64 ? "translate" : "meme";
      extractedText = text;
      fallback = true;
    }

    // translate with nothing extracted from a pure image is a dead end the
    // client can't render; the meme analyzer's own OCR is the better failure.
    if (destination === "translate" && !extractedText && !text && imageBase64) {
      destination = "meme";
    }
    if (destination === "translate" && !extractedText) extractedText = text;

    return new Response(
      JSON.stringify({ destination, extractedText, reason, fallback }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[screen-shared-content] error", msg);
    return new Response(JSON.stringify({ error: "server_error", detail: msg.slice(0, 400) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
