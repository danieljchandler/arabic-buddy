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

/**
 * The gateway's *streaming* completion shape.
 *
 * `streamBrain` sends `stream: true` and pipes the upstream body straight
 * through to the browser, tapping it on the way past to accumulate the text for
 * MSA-leak scanning. A non-streaming `chatCompletion` here would give it a JSON
 * body with no `data:` lines: the passthrough would still "work" and the client
 * would still see bytes, but the accumulator would stay empty and every
 * leak-detection assertion would pass vacuously.
 *
 * Several pieces rather than one for the same reason as on the client side —
 * the accumulation across frames is the behaviour worth testing.
 */
export const sseCompletion = (...pieces: string[]): Response => {
  const frames = pieces
    .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    .join("");
  return new Response(`${frames}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

/**
 * Gemini's *streaming* shape, which culture-guide reads and re-emits.
 *
 * The function's whole job is the translation between this and OpenAI's frame
 * shape, so the fixture has to be in Gemini's own vocabulary — `candidates`,
 * `content.parts[].text` — or the transform under test is bypassed.
 */
export const geminiStream = (
  pieces: string[],
  groundingMetadata?: unknown,
): Response => {
  const frames = pieces.map((text, i) => {
    const candidate: Record<string, unknown> = { content: { parts: [{ text }] } };
    // Grounding metadata arrives attached to a candidate mid-stream, and the
    // function keeps the last one it saw to build the Sources block after the
    // model has finished.
    if (groundingMetadata && i === pieces.length - 1) {
      candidate.groundingMetadata = groundingMetadata;
    }
    return `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`;
  });
  return new Response(frames.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

/** Gemini's own response shape, which culture-guide reads directly. */
export const geminiResponse = (text: string): Response =>
  json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  });

/**
 * A 1x1 PNG, base64. Small enough to inline, real enough that a decode of it
 * succeeds — which is what every image caller does with the bytes it gets back.
 */
export const PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Gemini's image shape: bytes ride inline on a content part, not in an
 * OpenAI-style `data[].b64_json`. Reproduced exactly because the whole point of
 * `aiGateway.generateImage` is reading this and the `images/generations` shape
 * apart, and a fixture in the wrong vocabulary would let a reader of the wrong
 * one pass.
 */
export const geminiImage = (b64 = PIXEL_PNG_B64): Response =>
  json({
    candidates: [
      { content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] }, finishReason: "STOP" },
    ],
  });

/** OpenAI's `images/generations` shape, the fallback leg of the image ladder. */
export const openaiImage = (b64 = PIXEL_PNG_B64): Response => json({ data: [{ b64_json: b64 }] });

/**
 * `aiGateway.generateImage` tries Gemini natively, then OpenAI's image model,
 * then the same Gemini model through OpenRouter — so one handler on one of them
 * is not "the image model", it is one third of it. `imageLadder` points the
 * whole ladder at a single handler, which is what a test that wants to describe
 * the image model as a unit actually means. The OpenRouter leg is deliberately
 * absent: it shares the chat route, and the default chat fixture carries no
 * image, which is already a refusal.
 */
export const GEMINI_IMAGE_ROUTE = "-image:generateContent";
export const OPENAI_IMAGE_ROUTE = "api.openai.com/v1/images/generations";

export const imageLadder = (
  handler: UpstreamHandler = () => geminiImage(),
): Record<string, UpstreamHandler> => ({
  [GEMINI_IMAGE_ROUTE]: handler,
  [OPENAI_IMAGE_ROUTE]: handler,
});

/**
 * Gemini's native `:generateContent`, which serves two different jobs on one
 * host: grounded text (culture-guide) and image generation. The model id is in
 * the path, so the fixture answers in whichever vocabulary the caller asked in
 * — a text fixture returned to an image request reads as "the model declined",
 * which is a real state and would hide a broken request shape behind a
 * plausible-looking fallback.
 */
const geminiNative: UpstreamHandler = (request) =>
  /image/i.test(new URL(request.url).pathname) ? geminiImage() : geminiResponse("fixture reply");

/** The default route table. Keys are matched as substrings of the URL. */
export function defaultUpstreams(): Record<string, UpstreamHandler> {
  return {
    // ── Model providers ─────────────────────────────────────────────────────
    // One OpenAI-shaped `/chat/completions` per provider, because that is how
    // aiGateway routes: Gemini to Google's compatibility surface, GPT to
    // OpenAI, everything else (and anything whose own key is missing) to
    // OpenRouter. The keys stay host-specific so a test can assert *which*
    // provider a function reached, not just that it reached something.
    "openrouter.ai": () => chatCompletion("fixture reply"),
    // Every google/* model in modelRegistry is served here (aiGateway routes
    // by vendor prefix since 1550b69), not by openrouter.ai. A test that stubs
    // a tool-call answer on openrouter.ai alone gets this plain-text default
    // for a Gemini model, and the Brain retries, falls back and 500s.
    // stubUpstreams warns about that shape; stub this route too.
    "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("fixture reply"),
    "generativelanguage.googleapis.com/v1beta/models": geminiNative,
    "api.fanar.qa": () => chatCompletion("fixture reply"),
    "api.openai.com/v1/images/generations": () => openaiImage(),
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
    // Soniox is four requests, not one: upload the file, create a
    // transcription, poll it to `completed`, then fetch the transcript. A
    // single flat body answered every step with the same thing, so `id` and
    // `status` were both undefined and the function polled for its full 240s
    // timeout — twice, because it retries once with a minimal body. Routing by
    // path lets a test finish in milliseconds and exercises the real sequence.
    "api.soniox.com": (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/files")) return json({ id: "file_fixture" });
      if (path.endsWith("/transcript")) {
        return json({
          text: "مرحبا",
          tokens: [
            { text: "مر", start_ms: 0, end_ms: 200 },
            { text: "حبا", start_ms: 200, end_ms: 400 },
            { text: " ", start_ms: 400, end_ms: 400 },
          ],
        });
      }
      // Both the create and the first poll: `completed` straight away, so the
      // polling loop exits on its first check.
      return json({ id: "tr_fixture", status: "completed" });
    },
    // `api.munsit.com`, and `transcription` — both corrected against the
    // function. The host was `api.munsit.ai`, which nothing calls, so the route
    // was dead and any real request would have hit the unrouted-upstream guard;
    // and the body used `text`, where munsit-transcribe reads
    // `data.transcription ?? raw.transcription` and would have seen null.
    "api.munsit.com": () => json({ data: { transcription: "مرحبا" } }),
    "api.elevenlabs.io": () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }),
    "tts.speech.microsoft.com": () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }),
    // Speech-to-text is a different host from text-to-speech, and pronunciation
    // assessment goes here. The shape is Azure's own: scores live under
    // `NBest[0].PronunciationAssessment`, which is what the function unwraps.
    "stt.speech.microsoft.com": () =>
      json({
        RecognitionStatus: "Success",
        NBest: [
          {
            Lexical: "مرحبا",
            PronunciationAssessment: {
              PronScore: 82,
              AccuracyScore: 85,
              FluencyScore: 78,
              CompletenessScore: 100,
            },
            Words: [
              {
                Word: "مرحبا",
                PronunciationAssessment: { AccuracyScore: 85, ErrorType: "None" },
                Phonemes: [],
              },
            ],
          },
        ],
      }),
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
