import type { Page } from "@playwright/test";

/**
 * Supabase test double.
 *
 * The app is a Supabase client talking to a hosted backend, so end-to-end
 * coverage would normally need real credentials and a seeded project. Instead
 * these helpers pin the backend down inside the browser:
 *
 *  - `signIn` seeds the session supabase-js persists in localStorage (see
 *    `storage: localStorage` in src/integrations/supabase/client.ts), so the
 *    app boots already authenticated.
 *  - `stubSupabase` intercepts every request to the fake host from .env.test
 *    and answers from fixtures, including the `content-range` header
 *    PostgREST uses to report `{ count: "exact" }` totals.
 *
 * That keeps the suite hermetic — no network, no credentials, no shared state
 * between runs — at the cost of asserting against fixtures rather than a real
 * database. It verifies the app's own logic (routing, session orchestration,
 * rendering), not that the queries match the production schema.
 */

/** Must match playwright.config.ts's webServer env. */
const SUPABASE_HOST = "e2e.supabase.co";
/** supabase-js derives this from the first hostname label of VITE_SUPABASE_URL. */
const STORAGE_KEY = "sb-e2e-auth-token";

export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * `content-range` carries PostgREST's `{ count: "exact" }` total. It is not a
 * CORS-safelisted response header, so without expose-headers the browser hides
 * it from supabase-js and every count silently reads as 0.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * A structurally valid (unsigned) JWT. supabase-js decodes the access token
 * rather than just reading `expires_at`, so an opaque placeholder string is
 * rejected — only the shape matters here, never the signature.
 */
function makeAccessToken(expiresAtSeconds: number) {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: TEST_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "e2e@example.com",
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAtSeconds,
  });
  return `${header}.${payload}.e2e-signature`;
}

type Row = Record<string, unknown>;
type TableHandler = (url: URL) => Row[];

export interface StubOptions {
  /** Curriculum cards (vocabulary_words + a due word_reviews row each). */
  curriculumDue?: number;
  /** Saved-vocabulary recognition cards due. */
  myWordsDue?: number;
  /** Saved-phrase cards due. */
  phrasesDue?: number;
  /** Set-phrase cards due (drives the separate Today task). */
  setPhrasesDue?: number;
  /** Extra/override table fixtures, keyed by table name. */
  tables?: Record<string, Row[] | TableHandler>;
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const DAY = 24 * 60 * 60 * 1000;

/** Exported so a test overriding `word_reviews` can point at a seeded word. */
export const wordId = (i: number) => `11111111-0000-4000-8000-${String(i).padStart(12, "0")}`;
const vocabId = (i: number) => `22222222-0000-4000-8000-${String(i).padStart(12, "0")}`;
const phraseId = (i: number) => `33333333-0000-4000-8000-${String(i).padStart(12, "0")}`;

function buildTables(options: StubOptions): Record<string, Row[] | TableHandler> {
  const {
    curriculumDue = 0,
    myWordsDue = 0,
    phrasesDue = 0,
    setPhrasesDue = 0,
  } = options;

  const curriculumWords: Row[] = Array.from({ length: curriculumDue }, (_, i) => ({
    id: wordId(i),
    word_arabic: `كلمة${i + 1}`,
    word_english: `word ${i + 1}`,
    image_url: null,
    audio_url: null,
    topic_id: null,
    lesson_id: null,
    image_position: null,
    dialect_module: "Gulf",
    lessons: null,
    topics: { name: "Test Topic", name_arabic: "موضوع", gradient: "", icon: "" },
  }));

  // Every curriculum word gets a review row that came due yesterday, so the
  // queue doesn't depend on the daily new-card budget.
  const curriculumReviews: Row[] = Array.from({ length: curriculumDue }, (_, i) => ({
    id: `44444444-0000-4000-8000-${String(i).padStart(12, "0")}`,
    user_id: TEST_USER_ID,
    word_id: wordId(i),
    ease_factor: 5,
    difficulty: 5,
    interval_days: 3,
    repetitions: 2,
    lapses: 0,
    last_reviewed_at: iso(-3 * DAY),
    next_review_at: iso(-DAY),
  }));

  const savedWords: Row[] = Array.from({ length: myWordsDue }, (_, i) => ({
    id: vocabId(i),
    user_id: TEST_USER_ID,
    word_arabic: `محفوظ${i + 1}`,
    word_english: `saved word ${i + 1}`,
    transliteration: null,
    root: null,
    source: "e2e",
    dialect: "Gulf",
    ease_factor: 4,
    difficulty: 5,
    interval_days: 2,
    repetitions: 1,
    lapses: 0,
    is_leech: false,
    next_review_at: iso(-DAY),
    last_reviewed_at: iso(-3 * DAY),
    production_ease_factor: 0,
    production_difficulty: 5,
    production_interval_days: 0,
    production_repetitions: 0,
    production_lapses: 0,
    production_next_review_at: null,
    production_last_reviewed_at: null,
    word_audio_url: null,
    sentence_audio_url: null,
    sentence_text: null,
    sentence_english: null,
    image_url: null,
    jingle_audio_url: null,
    jingle_lyrics: null,
    mnemonic: null,
    tags: null,
    deck_name: null,
    created_at: iso(-10 * DAY),
    updated_at: iso(-DAY),
  }));

  const savedPhrases: Row[] = Array.from({ length: phrasesDue }, (_, i) => ({
    id: phraseId(i),
    user_id: TEST_USER_ID,
    phrase_arabic: `عبارة${i + 1}`,
    phrase_english: `saved phrase ${i + 1}`,
    transliteration: null,
    notes: null,
    source: "e2e",
    dialect: "Gulf",
    ease_factor: 4,
    difficulty: 5,
    interval_days: 2,
    repetitions: 1,
    lapses: 0,
    is_leech: false,
    next_review_at: iso(-DAY),
    last_reviewed_at: iso(-3 * DAY),
    phrase_audio_url: null,
    jingle_audio_url: null,
    jingle_lyrics: null,
    mnemonic: null,
    created_at: iso(-10 * DAY),
    updated_at: iso(-DAY),
  }));

  const setPhrases: Row[] = Array.from({ length: setPhrasesDue }, (_, i) => ({
    id: `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`,
    user_id: TEST_USER_ID,
    phrase_id: `66666666-0000-4000-8000-${String(i).padStart(12, "0")}`,
    source: "e2e",
    ease_factor: 4,
    difficulty: 5,
    interval_days: 2,
    repetitions: 1,
    next_review_at: iso(-DAY),
    last_reviewed_at: iso(-3 * DAY),
    last_quality: 4,
  }));

  return {
    profiles: [
      {
        user_id: TEST_USER_ID,
        // Index.tsx bounces users to /onboarding without this.
        onboarding_completed: true,
        preferred_dialect: "Gulf",
        placement_level: "A2",
        placement_level_gulf: "A2",
        placement_level_egyptian: null,
        placement_level_yemeni: null,
      },
    ],
    vocabulary_words: curriculumWords,
    word_reviews: curriculumReviews,
    // The saved-vocabulary queries split recognition from production by which
    // column they filter on; only recognition cards are due in these fixtures.
    user_vocabulary: (url: URL) =>
      url.searchParams.has("production_next_review_at") ? [] : savedWords,
    user_phrases: savedPhrases,
    user_set_phrases: setPhrases,
    user_xp: [
      {
        user_id: TEST_USER_ID,
        total_xp: 250,
        current_level: 1,
        xp_today: 20,
        xp_today_date: new Date().toISOString().slice(0, 10),
      },
    ],
    ...(options.tables ?? {}),
  };
}

/** Seed an authenticated session so the app boots past ProtectedRoute. */
export async function signIn(page: Page) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const accessToken = makeAccessToken(expiresAt);

  await page.addInitScript(
    ({ key, userId, accessToken, expiresAt }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          // Far future so supabase-js never tries to refresh over the network.
          expires_in: 60 * 60 * 24 * 365,
          expires_at: expiresAt,
          refresh_token: "e2e-refresh-token",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "e2e@example.com",
            email_confirmed_at: new Date().toISOString(),
            phone: "",
            confirmed_at: new Date().toISOString(),
            last_sign_in_at: new Date().toISOString(),
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: {},
            identities: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      );
    },
    { key: STORAGE_KEY, userId: TEST_USER_ID, accessToken, expiresAt },
  );
}

/** Answer every Supabase request from fixtures. Call before navigating. */
export async function stubSupabase(page: Page, options: StubOptions = {}) {
  const tables = buildTables(options);

  // Matched by predicate: a glob over the full URL doesn't reliably catch
  // every scheme/path combination supabase-js emits.
  await page.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    const json = (body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ...CORS_HEADERS, ...headers },
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }

    if (pathname.startsWith("/auth/v1")) {
      if (pathname.endsWith("/user")) {
        return json({
          id: TEST_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: "e2e@example.com",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: new Date().toISOString(),
        });
      }
      return json({});
    }

    // Edge functions and RPCs aren't exercised by these smoke paths.
    if (pathname.startsWith("/functions/v1")) return json({});
    if (pathname.startsWith("/rest/v1/rpc/")) return json(null);

    if (pathname.startsWith("/rest/v1/")) {
      const table = pathname.replace("/rest/v1/", "").split("?")[0];
      const entry = tables[table];
      const rows = typeof entry === "function" ? entry(url) : (entry ?? []);

      // Writes just echo success; these tests assert on rendering, not persistence.
      if (request.method() !== "GET" && request.method() !== "HEAD") {
        return json([], { "content-range": "*/0" });
      }

      const wantsSingle = (request.headers()["accept"] ?? "").includes("pgrst.object");
      const countHeader = { "content-range": rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : "*/0" };

      // head:true count queries have no body — the count rides on the header.
      if (request.method() === "HEAD") {
        return route.fulfill({
          status: 200,
          headers: { ...CORS_HEADERS, ...countHeader },
          body: "",
        });
      }

      if (wantsSingle) return json(rows[0] ?? null, countHeader);
      return json(rows, countHeader);
    }

    return json({});
  });
}
