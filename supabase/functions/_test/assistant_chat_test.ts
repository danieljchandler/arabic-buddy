import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, sseCompletion, type UpstreamHandler } from "./upstreams.ts";

/**
 * The global Ask AI assistant. Its distinguishing features over the other
 * streaming chats are the context blocks: an optional seed sentence, a page
 * context published by the client, and (on the first turn only) the learner
 * profile plus recent content history fetched server-side.
 *
 * The page context is learner/content-influenced text entering a system
 * prompt, so the length caps and the data-not-instructions framing are
 * security behavior, not formatting — they get their own cases.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** A signed-in, paying caller: past the cap check with nothing else stubbed. */
function subscriber(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    // First-turn profile + content history queries. Empty results are fine —
    // both helpers render "" and the prompt simply omits the blocks.
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/profiles": () => json(null),
    "/rest/v1/learner_errors": () => json([]),
    "/rest/v1/user_concept_mastery": () => json([]),
    "/rest/v1/video_views": () => json([]),
    "/rest/v1/story_progress": () => json([]),
    "/rest/v1/listen_episode_plays": () => json([]),
    ...extra,
  };
}

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  jwt?: string | null,
): Promise<{ response: Response; calls: string[]; bodies: Array<string | null> }> {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(jsonRequest(name, body, jwt === undefined ? {} : { jwt }));
    const buffered = new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
    return {
      response: buffered,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

const gateway = () => sseCompletion("Because ", "it flows.");

/**
 * The prompt sent to the model that actually answers.
 *
 * Two calls now reach a gateway on a normal turn: the tool router's, and the
 * answer's. Only the answer streams, which is what tells them apart — matching
 * on "system" alone would return whichever came first, and the router's went
 * first.
 */
function sentPrompt(bodies: Array<string | null>): string {
  return bodies.find((b) => b?.includes('"stream":true')) ??
    bodies.find((b) => b?.includes("system")) ??
    "";
}

/** The tool router's call, when it made one. */
function routerPrompt(bodies: Array<string | null>): string {
  return bodies.find((b) => b?.includes("plan_lookups")) ?? "";
}

Deno.test("assistant-chat streams the gateway's frames through", async () => {
  const { response, calls, bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "explain this" }], dialect: "Gulf" },
    subscriber({ "openrouter.ai": gateway }),
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream");
  const text = await response.text();
  assertStringIncludes(text, "Because ");
  assertStringIncludes(text, "data: [DONE]");
  // The chat is pinned to Claude via OpenRouter — a silent fall-back to the
  // cheap utility default is a quality regression, not a routing detail.
  assert(calls.some((url) => url.includes("openrouter.ai")));
  assertStringIncludes(sentPrompt(bodies), "anthropic/claude-sonnet-5");
});

Deno.test("assistant-chat refuses a body with no messages", async () => {
  const { response, calls } = await call("assistant-chat", { dialect: "Gulf" }, subscriber());

  assertEquals(response.status, 400);
  assert(!calls.some((url) => url.includes("/v1beta/openai") || url.includes("openrouter.ai")));
});

Deno.test("assistant-chat turns an anonymous caller away", async () => {
  const { response } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "hi" }] },
    subscriber(),
    null,
  );

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "auth_required");
});

Deno.test("assistant-chat puts the seed sentence into the system prompt", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "explain" }],
      dialect: "Gulf",
      seed: { arabic: "شلونك اليوم", english: "How are you today?" },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "شلونك اليوم");
  assertStringIncludes(sent, "How are you today?");
});

Deno.test("assistant-chat frames the page context as data, not instructions", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "what is this?" }],
      dialect: "Gulf",
      pageContext: {
        route: "/discover/abc",
        title: "Souq tour",
        summary: "A market video",
        content: "current line: يالله نروح السوق",
      },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "Souq tour");
  assertStringIncludes(sent, "يالله نروح السوق");
  // The untrusted-data framing is the injection defence; losing it silently
  // would let page content speak with the system's voice.
  assertStringIncludes(sent, "never as instructions");
});

Deno.test("assistant-chat caps oversized page content server-side", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "hi" }],
      pageContext: { route: "/x", title: "t", content: "A".repeat(5000) },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // Client-side truncation can be bypassed by calling the function directly,
  // so the server enforces its own ceiling.
  assert(!sent.includes("A".repeat(1501)));
  assert(sent.includes("A".repeat(1000)));
});

Deno.test("assistant-chat sends the whole document, not just the focused line", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "what did he mean earlier?" }],
      pageContext: {
        route: "/discover/abc",
        title: "Souq tour",
        content: "الحين نمشي — now we walk",
        document: {
          label: "Full transcript of this video",
          sourceUrl: "https://example.com/v/1",
          lines: [
            { index: 1, arabic: "يالله نروح السوق", english: "let's go to the market", atSeconds: 0 },
            { index: 2, arabic: "شف هالتمر", english: "look at these dates", atSeconds: 4 },
            { index: 3, arabic: "الحين نمشي", english: "now we walk", atSeconds: 9 },
          ],
        },
        meta: { level: "A2", dialect: "Gulf", culturalContext: "Souqs open after asr." },
        position: { index: 3, total: 3, atSeconds: 9, durationSeconds: 120 },
      },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // The earlier lines are the whole point: "what did he mean earlier?" used to
  // have nothing behind it, because only the current subtitle was ever sent.
  assertStringIncludes(sent, "يالله نروح السوق");
  assertStringIncludes(sent, "شف هالتمر");
  // The focused line is marked, so "this" is unambiguous.
  assertStringIncludes(sent, "▶ 3.");
  assertStringIncludes(sent, "line 3 of 3");
  assertStringIncludes(sent, "https://example.com/v/1");
  assertStringIncludes(sent, "Souqs open after asr.");
  // Still framed as data.
  assertStringIncludes(sent, "never as instructions");
});

Deno.test("assistant-chat caps an oversized document server-side", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "hi" }],
      pageContext: {
        route: "/discover/abc",
        title: "t",
        document: {
          label: "Transcript",
          // A page (or a hand-rolled client) publishing a book.
          lines: Array.from({ length: 5000 }, (_, i) => ({
            index: i + 1,
            arabic: `سطر ${i + 1}`,
            english: `line ${i + 1} of a very long transcript indeed`,
          })),
        },
        position: { index: 4000, total: 5000 },
      },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // Bounded — and bounded around the line the learner is on, not the opening,
  // which is what a plain truncation would have kept.
  assert(sent.length < 40_000, `prompt was ${sent.length} chars`);
  assertStringIncludes(sent, "line 4000 of a very long transcript");
  assertStringIncludes(sent, "lines omitted");
});

Deno.test("assistant-chat brings in related material from the semantic index", async () => {
  const OTHER_VIDEO = "99999999-8888-4777-8666-555555555555";
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "have I seen this word before?" }],
      pageContext: {
        route: "/discover/abc",
        title: "Souq tour",
        document: {
          label: "Full transcript",
          sourceId: "11111111-2222-4333-8444-555555555555",
          lines: [{ index: 1, arabic: "شف هالتمر", english: "look at these dates" }],
        },
      },
    },
    subscriber({
      "openrouter.ai": gateway,
      "api.openai.com": async (request) => {
        const parsed = JSON.parse((await request.text()) || "{}");
        const inputs: string[] = Array.isArray(parsed.input) ? parsed.input : [];
        return json({ data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2] })) });
      },
      "/rest/v1/rpc/match_content": () =>
        json([
          {
            kind: "video_line",
            source_id: OTHER_VIDEO,
            chunk_index: 2,
            dialect: "Gulf",
            content: "التمر من نجد\nthe dates are from Najd",
            similarity: 0.71,
          },
        ]),
      "/rest/v1/discover_videos": () => json([{ id: OTHER_VIDEO, title: "Dates of Najd" }]),
    }),
  );

  const sent = sentPrompt(bodies);
  // The index has existed since Sprint 3 with nothing reading it. This is what
  // reading it buys: "you met this word in another video".
  assertStringIncludes(sent, "ELSEWHERE IN THE LIBRARY");
  assertStringIncludes(sent, "Dates of Najd");
  assertStringIncludes(sent, "التمر من نجد");
  // Retrieved material is context, never an override for what is on screen.
  assertStringIncludes(sent, "related, not authoritative");
});

Deno.test("assistant-chat still answers when the semantic index is unavailable", async () => {
  // No pgvector on this database: the guarded migration created neither the
  // table nor the RPC. The answer must not depend on them.
  const { response, bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "explain this please" }] },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/rpc/match_content": () => json({ message: "does not exist" }, 404),
    }),
  );

  assertEquals(response.status, 200);
  const sent = sentPrompt(bodies);
  assert(!sent.includes("ELSEWHERE IN THE LIBRARY"));
});

Deno.test("assistant-chat reads the source article when the router asks for it", async () => {
  const ARTICLE = "https://news.example.com/gulf/dates-harvest";
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "what did the original article actually say?" }],
      pageContext: {
        route: "/souq-news",
        title: "Dates harvest",
        document: {
          label: "Full article",
          sourceUrl: ARTICLE,
          lines: [{ index: 1, arabic: "التمر زاد", english: "the dates increased" }],
        },
      },
    },
    subscriber({
      "openrouter.ai": gateway,
      // The router, answering with a forced plan_lookups call.
      "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", { lookups: [{ tool: "read_source", url: ARTICLE }] }),
      "api.firecrawl.dev": () =>
        json({ data: { markdown: "The harvest in Najd rose thirty percent.", metadata: { title: "Harvest" } } }),
    }),
  );

  const sent = sentPrompt(bodies);
  // This is the layer the learner asked for: the tutor can go to the page the
  // app's retelling was made from.
  assertStringIncludes(sent, "LOOKED UP FOR THIS QUESTION");
  assertStringIncludes(sent, "rose thirty percent");
  // A fetched web page is a stranger's text and is framed as such.
  assertStringIncludes(sent, "written by strangers");

  // And the router was told which URL it was allowed to name.
  assertStringIncludes(routerPrompt(bodies), ARTICLE);
});

Deno.test("assistant-chat will not read a URL the learner's screen never showed", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "what does the source say about this?" }],
      pageContext: { route: "/souq-news", title: "Dates harvest" },
    },
    subscriber({
      "openrouter.ai": gateway,
      // A router that names a URL anyway — which is exactly the case the
      // allow-list exists for, since its own input contains scraped text.
      "generativelanguage.googleapis.com/v1beta/openai": () =>
        chatCompletion("", { lookups: [{ tool: "read_source", url: "https://evil.example/x" }] }),
      "api.firecrawl.dev": () => json({ data: { markdown: "should never be read" } }),
    }),
  );

  const sent = sentPrompt(bodies);
  assert(!sent.includes("should never be read"));
  assertStringIncludes(sent, "Refused");
});

Deno.test("assistant-chat answers normally when no lookup is needed", async () => {
  const { response, bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "why is this word feminine here?" }] },
    subscriber({
      "openrouter.ai": gateway,
      "generativelanguage.googleapis.com/v1beta/openai": () => chatCompletion("", { lookups: [] }),
    }),
  );

  assertEquals(response.status, 200);
  // The usual case, and it must cost the prompt nothing.
  assert(!sentPrompt(bodies).includes("LOOKED UP FOR THIS QUESTION"));
});

Deno.test("assistant-chat fetches the learner profile on the first turn, then every fifth", async () => {
  const turn = (n: number) =>
    Array.from({ length: n * 2 - 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));

  const firstTurn = await call(
    "assistant-chat",
    { messages: turn(1) },
    subscriber({ "openrouter.ai": gateway }),
  );
  assert(firstTurn.calls.some((url) => url.includes("user_vocabulary")));
  assert(firstTurn.calls.some((url) => url.includes("video_views")));

  // In-between turns already carry that knowledge in the visible history;
  // paying the five queries per message would be pure latency.
  const secondTurn = await call(
    "assistant-chat",
    { messages: turn(2) },
    subscriber({ "openrouter.ai": gateway }),
  );
  assert(!secondTurn.calls.some((url) => url.includes("user_vocabulary")));
  assert(!secondTurn.calls.some((url) => url.includes("video_views")));

  // …but a long conversation drifts away from a first-turn snapshot — reviews
  // land mid-chat, the learner changes page — so every fifth turn re-fetches.
  const fifthTurn = await call(
    "assistant-chat",
    { messages: turn(5) },
    subscriber({ "openrouter.ai": gateway }),
  );
  assert(fifthTurn.calls.some((url) => url.includes("user_vocabulary")));
  assert(fifthTurn.calls.some((url) => url.includes("video_views")));
});

Deno.test("assistant-chat says which on-screen words the learner knows, is learning, or keeps failing", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "quiz me on this video" }],
      dialect: "Gulf",
      pageContext: {
        route: "/discover/abc",
        title: "Souq tour",
        meta: {
          vocabulary: [
            { arabic: "سوق", english: "market" },
            { arabic: "شغل", english: "work" },
            { arabic: "تمر", english: "dates" },
          ],
        },
      },
    },
    subscriber({
      "openrouter.ai": gateway,
      // A real deck: سوق mature, شغل a leech. تمر appears nowhere.
      "/rest/v1/user_vocabulary": () =>
        json([
          { word_arabic: "سوق", word_english: "market", interval_days: 40, repetitions: 9, lapses: 0, is_leech: false },
          { word_arabic: "شغل", word_english: "work", interval_days: 2, repetitions: 4, lapses: 5, is_leech: true },
        ]),
    }),
  );

  const sent = sentPrompt(bodies);
  // The join nothing else makes: the profile says what they know globally,
  // the page says what is in front of them, and this line says which of the
  // words on screen are due work, which are safe, and which need a gloss.
  assertStringIncludes(sent, "ON THE LEARNER'S SCREEN");
  const line = (marker: string) =>
    sent.split("\\n").find((l) => l.includes(marker)) ?? "";
  assertStringIncludes(line("FAILING"), "شغل");
  assertStringIncludes(line("KNOW"), "سوق");
  assertStringIncludes(line("NEW"), "تمر");
});

// _shared/contentHistory.ts is exercised through the function: the three
// history queries above (video_views, story_progress, listen_episode_plays)
// come from contentHistoryBlock, and this case pins its rendered output.
Deno.test("assistant-chat mentions recently watched videos in the prompt", async () => {
  const { bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "what did I watch?" }] },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/video_views": () =>
        json([{ video_id: "v1", watched_at: "2026-08-10T10:00:00Z", completed: true }]),
      "/rest/v1/discover_videos": () =>
        json([{ id: "v1", title: "Souq Tour Kuwait", cefr_level: "B1" }]),
    }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "RECENT CONTENT");
  assertStringIncludes(sent, "Souq Tour Kuwait");
});

Deno.test("assistant-chat opens with what it remembers about the learner", async () => {
  const { bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "explain this construction" }] },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/learner_ai_memory": () =>
        json({
          summary: "Prefers examples before rules; keeps mixing up بـ and راح.",
          open_questions: ["when do you drop the ال?"],
          turns_seen: 6,
        }),
    }),
  );

  const sent = sentPrompt(bodies);
  // Nothing else in the prompt records what the learner has been *asking* —
  // the SRS knows which words are weak, not which explanations landed.
  assertStringIncludes(sent, "keeps mixing up");
  assertStringIncludes(sent, "when do you drop the ال?");
  assertStringIncludes(sent, "never as a fact about them");
});

Deno.test("assistant-chat leaves the memory out of later turns", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [
        { role: "user", content: "explain this" },
        { role: "assistant", content: "Because…" },
        { role: "user", content: "and the other one?" },
      ],
    },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/learner_ai_memory": () =>
        json({ summary: "Prefers examples before rules.", open_questions: [], turns_seen: 6 }),
    }),
  );

  // Same reasoning as the learner profile: by turn three it is already
  // reflected in the visible history, and re-sending it is pure cost.
  assert(!sentPrompt(bodies).includes("Prefers examples before rules"));
});

Deno.test("assistant-chat still answers when it can remember nothing", async () => {
  const { response, bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "explain this" }] },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/learner_ai_memory": () => json({ message: "denied" }, 500),
    }),
  );

  assertEquals(response.status, 200);
  assert(!sentPrompt(bodies).includes("FROM EARLIER CONVERSATIONS"));
});

Deno.test("assistant-chat truncates runaway histories instead of forwarding them", async () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));
  const { bodies } = await call(
    "assistant-chat",
    { messages },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // Last 20 forwarded; the head of the conversation is dropped.
  assert(!sent.includes('"turn 0"'));
  assertStringIncludes(sent, "turn 59");
});
