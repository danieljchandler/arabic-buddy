import type { MemoryDb } from "../postgrest/store";

/**
 * Edge-function responses.
 *
 * The predecessor to this module returned `{}` for every `/functions/v1/*`
 * call. That is worse than returning nothing: a test asserting "the mnemonic
 * appears" passed whether or not the function was called, because the component
 * fell through to its empty branch and the assertion was written to match. Here
 * an unregistered function returns **501 and is recorded**, so a spec that
 * depends on one has to say so.
 */

export interface FunctionCall {
  name: string;
  body: unknown;
  headers: Record<string, string>;
  at: number;
}

export interface FunctionContext {
  db: MemoryDb;
  userId: string | null;
  body: unknown;
}

export interface FunctionResponse {
  status: number;
  body: unknown;
  /** Set for the handful of functions the app consumes as an SSE stream. */
  stream?: string[];
  headers?: Record<string, string>;
}

export type FunctionHandler = (context: FunctionContext) => FunctionResponse | unknown;

const ok = (body: unknown): FunctionResponse => ({ status: 200, body });

/**
 * The shape each function returns on success, minimal but valid.
 *
 * Derived from each function's own response literal. They are intentionally
 * boring — a test that cares about the content overrides them.
 */
export const defaultFunctions: Record<string, FunctionHandler> = {
  // `tier`, not `subscription_tier`: the function names it `tier` and
  // `useSubscription` reads `data.tier`. A fixture using the other spelling
  // reports every subscriber as untiered while still looking subscribed.
  "check-subscription": () =>
    ok({ subscribed: false, tier: null, product_id: null, subscription_end: null }),
  "create-checkout": () => ok({ url: "https://checkout.stripe.test/session" }),
  "customer-portal": () => ok({ url: "https://billing.stripe.test/portal" }),

  "generate-mnemonic": () => ok({ mnemonic: "a memorable hook" }),
  "generate-flashcard-image": () => ok({ imageUrl: "https://cdn.test/flashcard.png" }),
  "generate-word-jingle": () => ok({ audioUrl: "https://cdn.test/jingle.mp3", lyrics: "la la la" }),
  "generate-phrase-jingle": () => ok({ audioUrl: "https://cdn.test/jingle.mp3", lyrics: "la la la" }),
  "persist-word-audio": () => ok({ audioUrl: "https://cdn.test/word.mp3" }),

  "azure-tts": () => ok({ audioContent: "" }),
  "munsit-tts": () => ok({ audioContent: "" }),
  "elevenlabs-tts": () => ok({ audioContent: "" }),

  "translate-text": () => ok({ translation: "translated" }),
  "translate-phrase": () => ok({ translation: "translated", transliteration: "" }),
  "how-do-i-say": () => ok({ arabic: "كيف", english: "how", transliteration: "kayf" }),

  "grammar-drill": () => ok({ questions: [] }),
  "record-grammar-outcome": () => ok({ recorded: true }),
  "listening-quiz": () => ok({ questions: [] }),
  "daily-challenge": () => ok({ challenge: null }),
  "placement-quiz": () => ok({ questions: [], level: "A2" }),
  "reading-passage": () => ok({ passage: "", questions: [] }),
  "reading-qa": () => ok({ answer: "" }),
  "phrase-of-the-day": () => ok({ phrase: null }),

  "word-enrichment": () => ok({ words: [] }),
  "suggest-flashcards": () => ok({ suggestions: [] }),
  "generate-sample-sentences": () => ok({ sentences: [] }),

  "discover-feed": () => ok({ videos: [] }),
  "extract-grammar-points": () => ok({ points: [] }),

  "score-shadow-attempt": () => ok({ score: 80, feedback: "" }),
  "pronunciation-feedback": () => ok({ feedback: "" }),
  "azure-pronunciation": () => ok({ accuracyScore: 80, words: [] }),
  "score-set-phrase-voice": () => ok({ score: 80 }),

  // The four ASR engines Transcribe fires in parallel. Every one of them
  // answers `text` — an earlier `{ transcript, segments }` here was invented,
  // and since the page reads `data.text` it made a silent engine look like a
  // successful one. The `*Used` flags are the real gating: Fanar and Soniox
  // return 200 with `text: null` when they are unconfigured or out of budget,
  // so "responded" and "transcribed" are genuinely different states.
  "deepgram-transcribe": () => ok({ text: "", words: [] }),
  "munsit-transcribe": () => ok({ text: null, error: "no transcript" }),
  "soniox-transcribe": () => ok({ text: null, sonioxUsed: false, reason: "api_key_not_configured" }),
  "fanar-transcribe": () =>
    ok({ text: null, fanarUsed: false, fanarAvailable: false, reason: "api_key_not_configured", budgetRemaining: 0 }),
  // `audioBase64` has to be non-empty: the page treats a falsy one as "no audio
  // file found" and aborts, so a zero-length default would make every caller
  // look like a failed download.
  "download-media": () =>
    ok({ audioBase64: "bWVkaWE=", contentType: "audio/mpeg", filename: "media.mp3", size: 5 }),
  "extract-visual-context": () =>
    ok({ success: true, result: { onScreenTextSegments: [], sceneContext: "", culturalContext: "" } }),

  // Called on page mount, so the route sweep needs them to resolve.
  "generate-daily-story": () => ok({ story: null, scenes: [] }),
  "generate-set-phrase-quiz": () => ok({ questions: [] }),
  "souq-news": () => ok({ articles: [] }),
  "souq-news-quiz": () => ok({ questions: [] }),
  "suggest-stories": () => ok({ suggestions: [] }),
  "generate-suggested-story-text": () => ok({ text: "" }),
  "request-situation-phrases": () => ok({ phrases: [] }),
  "practice-sentence-coach": () => ok({ feedback: "" }),
  "dialect-compare": () => ok({ comparisons: [] }),
  "culture-guide": () => ok({ answer: "" }),
  "free-chat": () => ok({ reply: "" }),
  "ask-translation": () => ok({ answer: "" }),
  "analyze-meme": () => ok({ analysis: "" }),
  // Transcribe's analyser. It reports failure in-band as `success: false`
  // rather than a non-2xx, so the default has to carry the flag.
  "analyze-gulf-arabic": () =>
    ok({ success: true, result: { lines: [], vocabulary: [], grammarPoints: [] } }),
  "scrape-x-post": () => ok({ text: "" }),
  "camel-analyze": () => ok({ dialect: "Gulf", confidence: 1 }),
  "farasa": () => ok({ segments: [] }),
  "hf-chat": () => ok({ reply: "" }),
  "translate-story-dialect": () => ok({ lines: [] }),
  "generate-listen-script": () => ok({ lines: [] }),
  "generate-listen-audio": () => ok({ audioUrl: "https://cdn.test/listen.mp3" }),
  "generate-listen-line-audio": () => ok({ audioUrl: "https://cdn.test/line.mp3" }),
  "realtime-session-token": () => ok({ client_secret: { value: "fixture-token" } }),
  "bible-passage": () => ok({ verses: [] }),
  "seed-set-phrases": () => ok({ inserted: 0 }),
  "suggest-stories-admin": () => ok({ suggestions: [] }),

  // Admin pipelines.
  "discover-trending-videos": () => ok({ candidates: [] }),
  "process-approved-video": () => ok({ processed: true }),
  "rate-video-cefr": () => ok({ cefr: "A2" }),
  "extract-concepts": () => ok({ concepts: [] }),
  "curriculum-chat": () => ok({ reply: "", proposals: [] }),
  "draft-dialect-rules": () => ok({ rules: [] }),
  "mine-dialect-corpus": () => ok({ sentences: [] }),
  "dialect-violations-digest": () => ok({ violations: [] }),
  "learn-from-metric": () => ok({ insight: "" }),
  "import-authentic-story": () => ok({ story: null }),
  "generate-story": () => ok({ story: null }),
  "generate-story-preview-audio": () => ok({ audioUrl: "https://cdn.test/preview.mp3" }),
  "generate-story-full-audio": () => ok({ audioUrl: "https://cdn.test/full.mp3" }),
  "generate-story-video": () => ok({ videoUrl: "https://cdn.test/story.mp4" }),
  "generate-story-video-full": () => ok({ videoUrl: "https://cdn.test/story-full.mp4" }),
  "edit-story-scene-image": () => ok({ imageUrl: "https://cdn.test/scene.png" }),
  "ai-resegment-transcript": () => ok({ segments: [] }),
  "classify-tutor-segments": () => ok({ segments: [] }),
  "backfill-literal-translations": () => ok({ updated: 0 }),
  "vet-corpus-sentences": () => ok({ results: [] }),
  "notify-due-reviews": () => ok({ sent: 0 }),
  "conversation-practice": () => ok({ reply: "" }),
};

/** The 429 an over-quota free user gets, exactly as `_shared/usageCap.ts` sends it. */
export function capLimited(): FunctionResponse {
  return {
    status: 429,
    body: {
      error: "daily_limit_reached",
      message: "You've hit today's free limit.",
      limit: 20,
      upgrade_url: "/pricing",
    },
  };
}

/** The 401 an anonymous caller gets from a capped function. */
export function authRequired(): FunctionResponse {
  return { status: 401, body: { error: "auth_required", message: "Sign in to use this feature." } };
}

export function unregistered(name: string): FunctionResponse {
  return {
    status: 501,
    body: {
      error: "not_stubbed",
      message:
        `The in-memory backend has no response registered for the edge function "${name}".\n` +
        `Register one for this test, or add a default in ` +
        `src/test/support/server/functions.ts. Returning an empty object instead ` +
        `would let this test pass without the function ever being exercised.`,
    },
  };
}

export function normalise(result: FunctionResponse | unknown): FunctionResponse {
  if (
    result !== null &&
    typeof result === "object" &&
    "status" in result &&
    "body" in result
  ) {
    return result as FunctionResponse;
  }
  return { status: 200, body: result };
}
