import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, sseCompletion, type UpstreamHandler } from "./upstreams.ts";
import { STUDY_GUIDE_VERSION, spokenLines, transcriptHash } from "../_shared/videoDebriefCore.ts";
import { RECAP_VERSION } from "../_shared/recapCore.ts";

/**
 * daily-recap — going over a learner's yesterday with the tutor — and the
 * window it is built from (`_shared/recapWindow.ts`).
 *
 * The contracts worth pinning are the ones a learner would feel:
 *
 *   - "yesterday" is the learner's own day, read from the database for the
 *     window the client's clock describes, and widened to the week when the
 *     day was empty rather than answering "nothing";
 *   - the strip's summary is free and model-free, the session is for
 *     subscribers;
 *   - the session is built from what *this learner* did — the saved words
 *     through the lines they were said in, the look-ups, the grouped slips —
 *     stored once per day so every later turn and the strip read the same
 *     plan, and rebuilt identically when it cannot be stored;
 *   - a chat turn carries the learner's notes and the step, never the whole
 *     transcript, and a finished session is recorded.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "dddddddd-0000-4000-8000-000000000001";
const DAY = 86_400_000;

// The clock the client reports: today in UTC. The window is then yesterday
// [00:00Z, 24:00Z), whatever the machine's own timezone.
const TODAY = new Date().toISOString().slice(0, 10);
const CLOCK = { localDate: TODAY, tzOffsetMinutes: 0 };
const todayMidnight = Date.parse(`${TODAY}T00:00:00.000Z`);
/** Noon, `n` days before today. */
const daysAgo = (n: number) => new Date(todayMidnight - n * DAY + DAY / 2).toISOString();

const LINES = [
  { id: "l1", arabic: "شلونك اليوم؟", translation: "How are you today?", startMs: 0, endMs: 1800, tokens: [{ surface: "شلونك", gloss: "how are you" }] },
  { id: "l2", arabic: "والله تعبان شوي", translation: "Honestly a bit tired", startMs: 1800, endMs: 3600, tokens: [{ surface: "تعبان", gloss: "tired" }] },
  { id: "l3", arabic: "ليش؟ شصاير؟", translation: "Why? What happened?", startMs: 3600, endMs: 5200, tokens: [] },
  { id: "l4", arabic: "ما نمت زين البارحة", translation: "I didn't sleep well last night", startMs: 5200, endMs: 7600, tokens: [{ surface: "البارحة", gloss: "last night" }] },
  { id: "l5", arabic: "روح ارتاح يا ريال", translation: "Go and rest, man", startMs: 7600, endMs: 9400, tokens: [] },
];

const VOCAB = [
  { arabic: "تعبان", english: "tired" },
  { arabic: "البارحة", english: "last night" },
  { arabic: "ارتاح", english: "rest" },
];

const VIDEO_ROW = {
  id: VIDEO,
  title: "A tired friend",
  dialect: "Gulf",
  cefr_level: "A2",
  cultural_context: null,
  is_meme: false,
  vocabulary: VOCAB,
  grammar_points: [],
  transcript_lines: LINES,
  published: true,
};

/** What the guide model answers, when a watched video has no guide yet. */
const GENERATED = {
  summary_en: "Two friends greet; one is tired because he slept badly, and the other tells him to rest.",
  gist: { question_en: "Why is the man tired?", question_ar: "", answer_en: "He didn't sleep well.", lines: [4] },
  comprehension: [{ question_en: "What does his friend tell him to do?", question_ar: "", answer_en: "Go and rest.", lines: [5] }],
  shadow_picks: [{ line: 5, why: "A friendly everyday instruction." }],
  talking_points: [],
  key_phrases: [],
};

/** A stored guide that matches the fixture transcript. */
function currentGuideRow() {
  return {
    video_id: VIDEO,
    guide: {
      version: STUDY_GUIDE_VERSION,
      summary_en: "Stored summary of the tired friend.",
      gist: { question_en: "Stored gist?", question_ar: "", answer_en: "Stored answer.", line_ids: ["l4"] },
      comprehension: [],
      shadow_picks: [{ line_id: "l5", why: "Useful." }],
      talking_points: [],
      key_phrases: [],
    },
    transcript_hash: transcriptHash(spokenLines(LINES)),
    version: STUDY_GUIDE_VERSION,
  };
}

/** Everything the learner did, dated so a window can be laid over it. */
function activity(at: string) {
  return {
    views: [{ video_id: VIDEO, watched_at: at, completed: true }],
    saved: [
      {
        id: "vocab-1",
        word_arabic: "البارحة",
        word_english: "last night",
        sentence_text: "ما نمت زين البارحة",
        sentence_english: "I didn't sleep well last night",
        source: "discover",
        source_video_id: VIDEO,
        created_at: at,
      },
      { id: "vocab-2", word_arabic: "قهوة", word_english: "coffee", sentence_text: null, source: "lesson", source_video_id: null, created_at: at },
    ],
    lookups: [{ video_id: VIDEO, word_arabic: "تعبان", word_english: null, line_id: "l2", created_at: at }],
    errors: [
      { target_arabic: "بغيت", produced_arabic: "أريد", error_kind: "msa", source: "conversation", created_at: at },
      { target_arabic: "بغيت", produced_arabic: null, error_kind: "pronunciation", source: "shadow", created_at: at },
    ],
  };
}

type Row = Record<string, unknown>;

interface Store {
  recap: Row | null;
  recapUpserts: Row[];
  recapPatches: Row[];
  guideUpserts: Row[];
}

const emptyStore = (): Store => ({ recap: null, recapUpserts: [], recapPatches: [], guideUpserts: [] });

interface Options {
  activity?: ReturnType<typeof activity>;
  video?: Row | null;
  storedGuide?: Row | null;
  storedRecap?: Row | null;
  recapTable?: "ok" | "missing";
  subscribed?: boolean;
  roles?: string[];
  chats?: Row[];
  extra?: Record<string, UpstreamHandler>;
}

/** Rows inside the window a query asks for on `column`; every row when it asks for none. */
function windowed(rows: Row[], column: string): UpstreamHandler {
  return (request) => {
    const url = decodeURIComponent(request.url);
    const since = url.match(new RegExp(`${column}=gte\\.([^&]+)`))?.[1];
    const until = url.match(new RegExp(`${column}=lt\\.([^&]+)`))?.[1];
    if (!since || !until) return json(rows);
    return json(rows.filter((row) => String(row[column]) >= since && String(row[column]) < until));
  };
}

/** The model gateway: a tool call for a guide, a stream for a chat turn. */
function gateway(chatPieces: string[] = ["Yesterday you ", "watched a clip."]): UpstreamHandler {
  return async (request) => {
    const body = await request.clone().text();
    if (body.includes('"stream":true')) return sseCompletion(...chatPieces);
    return chatCompletion("", GENERATED);
  };
}

function routes(opts: Options = {}, store: Store = emptyStore()): Record<string, UpstreamHandler> {
  const done = opts.activity ?? { views: [], saved: [], lookups: [], errors: [] };
  const video = opts.video === undefined ? VIDEO_ROW : opts.video;
  if (opts.storedRecap !== undefined) store.recap = opts.storedRecap;
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json(opts.subscribed === false ? null : { subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": (request) => {
      const roles = opts.roles ?? [];
      const url = decodeURIComponent(request.url);
      if (url.includes("&role=eq.")) {
        const wanted = url.match(/&role=eq\.([a-z_]+)/)?.[1] ?? "";
        return json(roles.includes(wanted) ? { role: wanted } : null);
      }
      return json([]);
    },
    "/rest/v1/profiles": () => json({ placement_level_gulf: "A2", placement_level: "A2" }),
    "/rest/v1/video_views": windowed(done.views, "watched_at"),
    "/rest/v1/discover_videos": (request) => {
      const url = decodeURIComponent(request.url);
      const ids = url.match(/id=in\.\(([^)]*)\)/)?.[1]?.split(",") ?? [];
      return json(video && ids.includes(String(video.id)) ? [video] : []);
    },
    "/rest/v1/video_study_guides": async (request) => {
      if (request.method === "POST") {
        store.guideUpserts.push(JSON.parse(await request.text()) as Row);
        return json(null, 201);
      }
      return json(opts.storedGuide ? [opts.storedGuide] : []);
    },
    "/rest/v1/user_vocabulary": (request) => {
      const url = decodeURIComponent(request.url);
      if (url.includes("created_at=gte.")) return windowed(done.saved, "created_at")(request);
      if (url.includes("last_result=in.")) return json([]);
      return json([]); // the learner profile's deck queries
    },
    "/rest/v1/video_word_lookups": windowed(done.lookups, "created_at"),
    "/rest/v1/learner_errors": windowed(done.errors, "created_at"),
    "/rest/v1/lesson_progress": () => json([]),
    "/rest/v1/story_progress": () => json([]),
    "/rest/v1/daily_vocab_stories": () => json([]),
    "/rest/v1/saved_chat_conversations": () => json(opts.chats ?? []),
    "/rest/v1/daily_challenge_completions": () => json([]),
    "/rest/v1/learner_ai_memory": () => json(null),
    "/rest/v1/learner_recaps": async (request) => {
      if (opts.recapTable === "missing") {
        return json({ code: "42P01", message: 'relation "public.learner_recaps" does not exist' }, 404);
      }
      if (request.method === "POST") {
        const row = JSON.parse(await request.text()) as Row;
        store.recapUpserts.push(row);
        store.recap = row;
        return json(null, 201);
      }
      if (request.method === "PATCH") {
        const patch = JSON.parse(await request.text()) as Row;
        store.recapPatches.push(patch);
        if (!store.recap) return json([]);
        store.recap = { ...store.recap, ...patch };
        return json([{ id: "recap-1" }]);
      }
      return json(store.recap);
    },
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "openrouter.ai": gateway(),
    ...opts.extra,
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, jwt?: string | null) {
  const fn = await loadFunction("daily-recap", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("daily-recap", body, jwt === undefined ? {} : { jwt }));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A stream; the text carries it.
    }
    return {
      status: response.status,
      body: parsed,
      text,
      calls: fn.calls.map((c) => ({ url: c.url, method: c.method, body: c.body ?? "" })),
    };
  } finally {
    fn.restore();
  }
}

type Calls = Array<{ url: string; method: string; body: string }>;
const modelCalls = (calls: Calls) => calls.filter((c) => c.url.includes("openrouter.ai"));
const readsOf = (calls: Calls, table: string) => calls.filter((c) => c.url.includes(`/rest/v1/${table}`) && c.method === "GET");

function systemPromptOf(calls: Calls): string {
  const sent = calls.find((c) => c.url.includes("openrouter.ai") && c.body.includes('"stream":true'));
  assert(sent, "no streamed model call was made");
  const parsed = JSON.parse(sent.body) as { messages: Array<{ role: string; content: unknown }> };
  return parsed.messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

function messagesOf(calls: Calls) {
  const sent = calls.find((c) => c.url.includes("openrouter.ai") && c.body.includes('"stream":true'));
  return (JSON.parse(sent!.body) as { messages: Array<{ role: string; content: string }> }).messages;
}

interface QuizItem {
  arabic: string;
  english: string;
  source: string;
  vocabularyId?: string;
  lineId?: string;
  videoId?: string;
  options: string[];
  answerIndex: number;
}

// ── summary: the strip ──────────────────────────────────────────────────────

Deno.test("daily-recap turns an anonymous caller away from the summary", async () => {
  const { status, body } = await call({ action: "summary", dialect: "Gulf", ...CLOCK }, routes(), null);
  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
});

Deno.test("daily-recap sums up yesterday for any signed-in learner, without a model or a transcript", async () => {
  const { status, body, calls } = await call(
    { action: "summary", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), subscribed: false }),
  );
  assertEquals(status, 200);
  assertEquals(body.hasContent, true);
  assertEquals(body.windowDays, 1);
  assertEquals(body.date, TODAY);
  assertEquals(body.counts, { videos: 1, words: 2, lookups: 1, slips: 1, lessons: 0, stories: 0, chats: 0 });
  assertEquals(body.headline, "Yesterday: 1 video, 2 new words, 1 slip");
  assertEquals(body.firstVideo, "A tired friend");
  assertEquals(body.status, "none");
  assertEquals(modelCalls(calls).length, 0);
  // Counts need titles, not transcripts.
  const videoRead = readsOf(calls, "discover_videos")[0];
  assert(videoRead && !decodeURIComponent(videoRead.url).includes("transcript_lines"), "the summary read a transcript");
});

Deno.test("daily-recap widens to the week when yesterday was empty", async () => {
  const { body } = await call({ action: "summary", dialect: "Gulf", ...CLOCK }, routes({ activity: activity(daysAgo(4)) }));
  assertEquals(body.hasContent, true);
  assertEquals(body.windowDays, 7);
  assertStringIncludes(String(body.headline), "This week:");
});

Deno.test("daily-recap says there is nothing yet when the week is empty too", async () => {
  const { body, calls } = await call({ action: "summary", dialect: "Gulf", ...CLOCK }, routes());
  assertEquals(body.hasContent, false);
  assertEquals(body.firstVideo, null);
  // Both rungs of the ladder were tried before giving up.
  assertEquals(readsOf(calls, "video_views").length, 2);
});

Deno.test("daily-recap leaves a clip from another dialect out of a Gulf learner's day", async () => {
  const { body } = await call(
    { action: "summary", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), video: { ...VIDEO_ROW, dialect: "Egyptian" } }),
  );
  assertEquals((body.counts as { videos: number }).videos, 0);
  // The look-up belonged to that clip, so it goes with it; the saved words stay.
  assertEquals((body.counts as { lookups: number }).lookups, 0);
  assertEquals((body.counts as { words: number }).words, 2);
});

// ── plan: who may have a session ────────────────────────────────────────────

Deno.test("daily-recap's session is for subscribers, and says so in its own words", async () => {
  const { status, body, calls } = await call(
    { action: "plan", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), subscribed: false }),
  );
  assertEquals(status, 403);
  assertEquals(body.error, "subscription_required");
  assertStringIncludes(String(body.message), "Going over your day");
  // Refused before anything is read.
  assertEquals(readsOf(calls, "video_views").length, 0);
});

Deno.test("daily-recap answers 422 when there is nothing to go over", async () => {
  const { status, body } = await call({ action: "plan", dialect: "Gulf", ...CLOCK }, routes());
  assertEquals(status, 422);
  assertEquals(body.error, "nothing_to_recap");
});

// ── plan: the session ───────────────────────────────────────────────────────

Deno.test("daily-recap builds the session from what the learner did, and stores it for the day", async () => {
  const store = emptyStore();
  const { status, body, calls } = await call(
    { action: "plan", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), storedGuide: currentGuideRow(), chats: [{ title: "About يا ريال" }] }, store),
  );
  assertEquals(status, 200);
  assertEquals(body.stored, true);
  assertEquals(body.status, "ready");
  assertEquals(body.windowDays, 1);
  assertEquals(body.date, TODAY);
  assertEquals(modelCalls(calls).length, 0);

  // The quiz: the word saved from the video (through its line), the look-up
  // (glossed from the transcript token), then the word saved in a lesson.
  const quiz = body.quiz as QuizItem[];
  assertEquals(quiz.map((q) => q.arabic), ["البارحة", "تعبان", "قهوة"]);
  assertEquals(quiz[0].source, "saved");
  assertEquals(quiz[0].vocabularyId, "vocab-1");
  assertEquals(quiz[0].lineId, "l4");
  assertEquals(quiz[0].videoId, VIDEO);
  assertEquals(quiz[1].source, "looked_up");
  assertEquals(quiz[1].english, "tired");
  assertEquals(quiz[2].vocabularyId, "vocab-2");
  for (const item of quiz) assertEquals(item.options[item.answerIndex], item.english);
  assertEquals(body.marked, { saved: 2, lookedUp: 1 });

  // The line to say: the one carrying the saved word, from that video.
  const shadow = body.shadow as Array<{ lineId: string; videoId: string; videoTitle: string }>;
  assertEquals(shadow.map((s) => s.lineId), ["l4"]);
  assertEquals(shadow[0].videoTitle, "A tired friend");

  // Two errors on one target are one slip, with the learner's own form kept.
  assertEquals(body.slips, [{ target: "بغيت", produced: "أريد", kinds: ["msa", "pronunciation"], sources: ["conversation", "shadow"], count: 2 }]);
  assertEquals(body.steps, ["yesterday", "retell", "words", "slips", "shadow", "recap"]);

  // The video as the plan carries it: the stored guide's summary and only the cited lines.
  const videos = body.videos as Array<{ summary: string; excerpts: Array<{ n: number }>; lineCount: number }>;
  assertEquals(videos[0].summary, "Stored summary of the tired friend.");
  assertEquals(videos[0].lineCount, 5);
  assertEquals(videos[0].excerpts.map((l) => l.n), [1, 2, 3, 4, 5]);
  assertEquals(body.chats, ["About يا ريال"]);

  // Stored under the learner's day, so every later turn reads the same plan.
  assertEquals(store.recapUpserts.length, 1);
  const stored = store.recapUpserts[0];
  assertEquals(stored.user_id, USER);
  assertEquals(stored.dialect, "Gulf");
  assertEquals(stored.recap_date, TODAY);
  assertEquals(stored.window_days, 1);
  assertEquals(stored.status, "ready");
  assertEquals((stored.plan as { version: number }).version, RECAP_VERSION);
});

Deno.test("daily-recap writes a guide for a watched clip nobody has talked through yet", async () => {
  const store = emptyStore();
  const { body, calls } = await call({ action: "plan", dialect: "Gulf", ...CLOCK }, routes({ activity: activity(daysAgo(1)) }, store));
  assertEquals(modelCalls(calls).length, 1);
  assertEquals(store.guideUpserts.length, 1);
  assertEquals(store.guideUpserts[0].video_id, VIDEO);
  const videos = body.videos as Array<{ summary: string }>;
  assertEquals(videos[0].summary, GENERATED.summary_en);
});

Deno.test("daily-recap reuses the day's stored session without re-reading the window", async () => {
  const plan = {
    version: RECAP_VERSION,
    date: TODAY,
    windowDays: 1,
    since: daysAgo(1),
    until: daysAgo(0),
    dialect: "Gulf",
    level: "A2",
    steps: ["yesterday", "recap"],
    videos: [],
    quiz: [],
    shadow: [],
    slips: [],
    lessons: [],
    stories: [],
    chats: ["Stored chat"],
    challenge: null,
    openQuestions: [],
    counts: { videos: 0, words: 0, lookups: 0, slips: 0, lessons: 0, stories: 0, chats: 1 },
    marked: { saved: 0, lookedUp: 0 },
  };
  const { status, body, calls } = await call(
    { action: "plan", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), storedRecap: { plan, status: "completed" } }),
  );
  assertEquals(status, 200);
  assertEquals(body.chats, ["Stored chat"]);
  assertEquals(body.status, "completed");
  assertEquals(body.stored, true);
  assertEquals(readsOf(calls, "video_views").length, 0);
});

Deno.test("daily-recap still runs when the recap table is missing, rebuilding the same plan", async () => {
  const first = await call(
    { action: "plan", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), storedGuide: currentGuideRow(), recapTable: "missing" }),
  );
  assertEquals(first.status, 200);
  assertEquals(first.body.stored, false);
  const second = await call(
    { action: "plan", dialect: "Gulf", ...CLOCK },
    routes({ activity: activity(daysAgo(1)), storedGuide: currentGuideRow(), recapTable: "missing" }),
  );
  // Seeded by learner and day: the quiz the plan showed is the quiz the chat is told about.
  assertEquals(second.body.quiz, first.body.quiz);
});

// ── chat ────────────────────────────────────────────────────────────────────

Deno.test("daily-recap streams a turn grounded in the learner's notes and the step", async () => {
  const { status, text, calls } = await call(
    { action: "chat", dialect: "Gulf", ...CLOCK, step: "slips", messages: [] },
    routes({ activity: activity(daysAgo(1)), storedGuide: currentGuideRow() }),
  );
  assertEquals(status, 200);
  assertStringIncludes(text, "watched a clip.");
  // The system message is a JSON-encoded parts array (prompt caching), so the
  // quotes in it are escaped; match the words, not the punctuation around them.
  const prompt = systemPromptOf(calls);
  assertStringIncludes(prompt, "WHAT THE LEARNER DID YESTERDAY");
  assertStringIncludes(prompt, "A tired friend");
  assertStringIncludes(prompt, "Stored summary of the tired friend.");
  assertStringIncludes(prompt, "البارحة — last night (saved in");
  assertStringIncludes(prompt, "Target: بغيت — they produced: أريد");
  assertStringIncludes(prompt, "step 4 of 6");
  assertStringIncludes(prompt, "Fix a slip");
  assertStringIncludes(prompt, "[[STEP_DONE]]");
  // The learner is A2 here, so the tutor scaffolds in English.
  assertStringIncludes(prompt, "Write mainly in English");
  // Only the cited lines travel.
  assert(!prompt.includes("TRANSCRIPT (numbered)"), "the whole transcript was sent");
  // A step opens with a stand-in for the learner's message.
  const sent = messagesOf(calls).filter((m) => m.role !== "system");
  assertEquals(sent.map((m) => m.role), ["user"]);
  assertStringIncludes(sent[0].content, "Fix a slip");
});

Deno.test("daily-recap refuses a chat turn without a known step", async () => {
  const { status, calls } = await call(
    { action: "chat", dialect: "Gulf", ...CLOCK, step: "gist", messages: [] },
    routes({ activity: activity(daysAgo(1)), storedGuide: currentGuideRow() }),
  );
  assertEquals(status, 400);
  assertEquals(modelCalls(calls).length, 0);
});

// ── complete ────────────────────────────────────────────────────────────────

Deno.test("daily-recap records a finished session, keeping only what a client may say about it", async () => {
  const store = emptyStore();
  const { status, body } = await call(
    {
      action: "complete",
      dialect: "Gulf",
      ...CLOCK,
      outcome: {
        quiz: [{ arabic: "البارحة", english: "last night", correct: false, chosen: "tomorrow", userId: "someone-else" }],
        shadow: [],
        stepsDone: ["yesterday", "words", "lunch"],
      },
    },
    routes({ storedRecap: { plan: {}, status: "ready" } }, store),
  );
  assertEquals(status, 200);
  assertEquals(body.stored, true);
  assertEquals(store.recapPatches.length, 1);
  const patch = store.recapPatches[0];
  assertEquals(patch.status, "completed");
  assert(typeof patch.completed_at === "string");
  assertEquals(patch.outcome, {
    quiz: [{ arabic: "البارحة", english: "last night", correct: false, chosen: "tomorrow" }],
    shadow: [],
    stepsDone: ["yesterday", "words"],
  });
});

Deno.test("daily-recap says when a completion had nothing to land on", async () => {
  const { body } = await call(
    { action: "complete", dialect: "Gulf", ...CLOCK, outcome: { quiz: [], shadow: [], stepsDone: [] } },
    routes({ recapTable: "missing" }),
  );
  assertEquals(body.stored, false);
});

Deno.test("daily-recap refuses an action it does not know", async () => {
  const { status } = await call({ action: "export", dialect: "Gulf", ...CLOCK }, routes());
  assertEquals(status, 400);
});

Deno.test("daily-recap reads the caller's identity from the token, never the body", async () => {
  const { status } = await call(
    { action: "summary", dialect: "Gulf", ...CLOCK, userId: "11111111-0000-4000-8000-000000000001" },
    routes({ activity: activity(daysAgo(1)) }),
    fixtureJwt(USER),
  );
  assertEquals(status, 200);
});
