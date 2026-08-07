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
  "check-subscription": () => ok({ subscribed: false, subscription_tier: null, subscription_end: null }),
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

  "deepgram-transcribe": () => ok({ transcript: "", segments: [] }),
  "munsit-transcribe": () => ok({ transcript: "", segments: [] }),
  "soniox-transcribe": () => ok({ transcript: "", segments: [] }),
  "fanar-transcribe": () => ok({ transcript: "", segments: [] }),
  "download-media": () => ok({ url: "https://cdn.test/media.mp3" }),
  "extract-visual-context": () => ok({ context: "" }),
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
