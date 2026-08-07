/**
 * Canned responses for the external services the edge functions call.
 *
 * Every one of these is reached with `fetch`, so a routing fetch stub is the
 * whole mocking strategy — no module interception needed. The shapes are the
 * minimum each caller actually reads; a test that cares about more overrides it.
 */

export type UpstreamHandler = (request: Request) => Response | Promise<Response>;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** OpenAI-shaped chat completion, which most of the LLM gateways mimic. */
export const chatCompletion = (content: string, toolCall?: unknown): Response =>
  json({
    id: "chatcmpl-fixture",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: toolCall ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content,
          ...(toolCall
            ? {
                tool_calls: [
                  {
                    id: "call_fixture",
                    type: "function",
                    function: {
                      name: "respond",
                      arguments: JSON.stringify(toolCall),
                    },
                  },
                ],
              }
            : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });

/** Gemini's own response shape, which culture-guide reads directly. */
export const geminiResponse = (text: string): Response =>
  json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  });

/** The default route table. Keys are matched as substrings of the URL. */
export function defaultUpstreams(): Record<string, UpstreamHandler> {
  return {
    // ── LLM gateways ────────────────────────────────────────────────────────
    "ai.gateway.lovable.dev": () => chatCompletion("fixture reply"),
    "openrouter.ai": () => chatCompletion("fixture reply"),
    "generativelanguage.googleapis.com": () => geminiResponse("fixture reply"),
    "api.fanar.qa": () => chatCompletion("fixture reply"),
    "api.openai.com": () => chatCompletion("fixture reply"),
    "router.huggingface.co": () => chatCompletion("fixture reply"),
    "api-inference.huggingface.co": () => json([{ label: "gulf", score: 0.9 }]),

    // ── Speech ──────────────────────────────────────────────────────────────
    "api.deepgram.com": () =>
      json({
        results: {
          channels: [
            { alternatives: [{ transcript: "مرحبا", words: [], confidence: 0.9 }] },
          ],
        },
      }),
    "api.soniox.com": () => json({ text: "مرحبا", tokens: [] }),
    "api.munsit.ai": () => json({ text: "مرحبا", segments: [] }),
    "api.elevenlabs.io": () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }),
    "tts.speech.microsoft.com": () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }),
    "api.cognitive.microsoft.com": () => json({ AccuracyScore: 85, NBest: [] }),
    "speech.platform.bing.com": () => json({ AccuracyScore: 85 }),
    "api.cohere.com": () => json({ text: "مرحبا" }),

    // ── NLP ─────────────────────────────────────────────────────────────────
    "farasa.qcri.org": () => json({ text: "مرحبا", output: "مرحبا" }),

    // ── Payments ────────────────────────────────────────────────────────────
    "api.stripe.com": (request) => {
      const url = new URL(request.url);
      if (url.pathname.includes("checkout/sessions")) {
        return json({ id: "cs_fixture", url: "https://checkout.stripe.test/session" });
      }
      if (url.pathname.includes("billing_portal")) {
        return json({ id: "bps_fixture", url: "https://billing.stripe.test/portal" });
      }
      if (url.pathname.includes("subscriptions")) {
        return json({ data: [] });
      }
      return json({ data: [] });
    },

    // ── Media / scraping ────────────────────────────────────────────────────
    "youtube.googleapis.com": () => json({ items: [] }),
    "www.googleapis.com/youtube": () => json({ items: [] }),
    "api.cobalt.tools": () => json({ status: "stream", url: "https://cdn.test/media.mp3" }),
    "co.imput.net": () => json({ status: "stream", url: "https://cdn.test/media.mp3" }),
    "rapidapi.com": () => json({ link: "https://cdn.test/media.mp3" }),
    "tikwm.com": () => json({ data: { play: "https://cdn.test/media.mp4" } }),
    "api.firecrawl.dev": () => json({ success: true, data: { markdown: "" } }),
    "r.jina.ai": () => new Response("scraped text", { status: 200 }),
    "bolls.life": () => json([{ verse: 1, text: "In the beginning" }]),

    // ── Supabase itself, called server-side under the service role ──────────
    "/rest/v1/": () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "*/0" },
      }),
    "/auth/v1/": () => json({ id: "00000000-0000-4000-8000-000000000001" }),
  };
}
