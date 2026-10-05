// video-debrief — talk a learner through a video they have just watched.
//
// Two actions, one body shape `{ action, videoId, … }`:
//
//   plan  → what this session will cover: its steps, the word quiz (built from
//           the words the learner saved or looked up in this video, topped up
//           from its key vocabulary) and the lines to shadow. Generates the
//           video's study guide first if it has none.
//   chat  → one streamed tutor turn for `step`, given the conversation so far.
//
// The tutor's knowledge of the video comes from the cached study guide, not
// from re-reading the transcript every turn, and the learner's marks are read
// here from the database on every request — never taken from the body, which
// only ever says which video, which step, and what was said. Subscribers only.
import { getCorsHeaders } from "../_shared/cors.ts";
import { isAdminUser, requireActiveSubscription } from "../_shared/usageCap.ts";
import { BrainHttpError, streamBrain } from "../_shared/aiBrain.ts";
import { DEFAULT_CHAT } from "../_shared/modelRegistry.ts";
import { getDialectLabel } from "../_shared/dialectHelpers.ts";
import { buildLearnerProfile, renderProfileForPrompt } from "../_shared/learnerProfile.ts";
import {
  ensureStudyGuide,
  STUDY_GUIDE_VIDEO_COLUMNS,
  studyGuideAdmin,
  type StudyGuideVideo,
} from "../_shared/videoStudyGuide.ts";
import {
  buildWordQuiz,
  debriefSystemPrompt,
  isDebriefStep,
  normalizeCefr,
  pickShadowLines,
  planSteps,
  savedWordsForVideo,
  selectFocusWords,
  spokenLines,
  stepKickoff,
  type DebriefLine,
  type LookupRow,
  type SavedWordRow,
} from "../_shared/videoDebriefCore.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Turns of history a request may carry, and characters per turn. */
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2000;
/** Words the quiz asks about. */
const QUIZ_SIZE = 5;
/** Lines the learner shadows. */
const SHADOW_COUNT = 2;

const PAYWALL = "Talking a video through with the tutor is available on a paid plan.";

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * The words this learner saved from this video, and the ones they looked up.
 *
 * Saved words are read twice over: by `source_video_id` for everything saved
 * since that column exists, and by sentence for the older "discover" rows
 * that never said which video they came from. Each query fails soft, so a
 * project that has not applied the migration yet still gets the sentence
 * match and simply no look-ups.
 */
async function loadMarks(userId: string, videoId: string, lines: DebriefLine[]) {
  const supabase = studyGuideAdmin();
  const columns = "id, word_arabic, word_english, sentence_text, sentence_english, source";
  const discoverRows = async () => {
    const query = (select: string) =>
      supabase
        .from("user_vocabulary")
        .select(select)
        .eq("user_id", userId)
        .eq("source", "discover")
        .order("created_at", { ascending: false })
        .limit(400);
    // With the column, a word saved from another video is told apart from one
    // that never said; without it (migration not applied), every row is
    // matched by sentence.
    const withVideo = await query(`${columns}, source_video_id`);
    return withVideo.error ? await query(columns) : withVideo;
  };
  const [linked, legacy, lookups] = await Promise.all([
    supabase
      .from("user_vocabulary")
      .select(`${columns}, source_video_id`)
      .eq("user_id", userId)
      .eq("source_video_id", videoId)
      .order("created_at", { ascending: false })
      .limit(50),
    discoverRows(),
    supabase
      .from("video_word_lookups")
      .select("word_arabic, word_english, line_id")
      .eq("user_id", userId)
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const saved: SavedWordRow[] = [];
  const seen = new Set<string>();
  const keep = (rows: SavedWordRow[]) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      saved.push(row);
    }
  };
  if (!linked.error) keep((linked.data ?? []) as SavedWordRow[]);
  if (!legacy.error) keep(savedWordsForVideo((legacy.data ?? []) as unknown as SavedWordRow[], videoId, lines));
  return {
    saved,
    lookups: lookups.error ? [] : ((lookups.data ?? []) as LookupRow[]),
  };
}

/** The learner's level in this dialect, and their profile block for the prompt. */
async function learnerContext(userId: string, dialect: string) {
  try {
    const profile = await buildLearnerProfile({ userId, dialect });
    return {
      level: profile.level,
      block: renderProfileForPrompt(profile, { includeWeak: false, includeInterests: true }),
    };
  } catch (e) {
    console.warn("[video-debrief] profile unavailable:", e instanceof Error ? e.message : e);
    return { level: null, block: "" };
  }
}

function cleanMessages(raw: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string).slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_MESSAGES);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireActiveSubscription(req, corsHeaders, PAYWALL);
  if (gate.limited) return gate.response;
  const userId = gate.userId;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action === "chat" ? "chat" : body.action === "plan" ? "plan" : null;
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!action) return json({ error: "action must be plan or chat" }, 400, corsHeaders);
    if (!UUID.test(videoId)) return json({ error: "videoId is required" }, 400, corsHeaders);

    const { data, error } = await studyGuideAdmin()
      .from("discover_videos")
      .select(STUDY_GUIDE_VIDEO_COLUMNS)
      .eq("id", videoId)
      .maybeSingle();
    if (error) throw error;
    const video = data as StudyGuideVideo | null;
    // Learners see published videos only; staff preview the rest, as on the video page.
    if (!video || (video.published !== true && !(await isAdminUser(userId)))) {
      return json({ error: "not_found" }, 404, corsHeaders);
    }

    const lines = spokenLines(video.transcript_lines);
    if (lines.length === 0) {
      return json(
        { error: "no_transcript", message: "This video has no transcript to talk about yet." },
        422,
        corsHeaders,
      );
    }

    const dialect = video.dialect || "Gulf";
    const [ensured, marks, learner] = await Promise.all([
      ensureStudyGuide(video, lines),
      loadMarks(userId, video.id, lines),
      learnerContext(userId, dialect),
    ]);
    if (!ensured) {
      return json(
        { error: "guide_unavailable", message: "Couldn't prepare this video's session right now — try again in a minute." },
        503,
        corsHeaders,
      );
    }

    const { guide } = ensured;
    const focus = selectFocusWords({
      saved: marks.saved,
      lookups: marks.lookups,
      keyVocabulary: video.vocabulary,
      lines,
      max: QUIZ_SIZE,
    });
    // Seeded by learner and video, so the quiz the plan showed is the quiz the
    // chat is told about on every later turn.
    const quiz = buildWordQuiz(focus, video.vocabulary, `${userId}:${video.id}`);
    const shadow = pickShadowLines(lines, guide.shadow_picks, focus, SHADOW_COUNT);
    const steps = planSteps({ quizCount: quiz.length, shadowCount: shadow.length });
    const level = normalizeCefr(learner.level ?? video.cefr_level);

    if (action === "plan") {
      return json(
        {
          video: { id: video.id, title: video.title, dialect, cefrLevel: video.cefr_level ?? null },
          level,
          steps,
          quiz,
          shadow,
          marked: {
            saved: focus.filter((f) => f.source === "saved").length,
            lookedUp: focus.filter((f) => f.source === "looked_up").length,
          },
          questionCount: guide.comprehension.length,
          preparedNow: ensured.generated,
        },
        200,
        corsHeaders,
      );
    }

    const step = body.step;
    if (!isDebriefStep(step)) return json({ error: "step is required" }, 400, corsHeaders);
    const messages = cleanMessages(body.messages);
    // A step opens with the tutor speaking, so there is no learner message to
    // answer yet; this stands in for one.
    if (messages.length === 0 || messages[messages.length - 1].role === "assistant") {
      messages.push({ role: "user", content: stepKickoff(step) });
    }

    const dialectLabel = getDialectLabel(dialect);
    return await streamBrain({
      purpose: "video_debrief",
      dialect,
      messages,
      systemPromptExtra: debriefSystemPrompt({
        step,
        steps: steps.includes(step) ? steps : [...steps, step],
        dialectLabel,
        level,
        title: video.title,
        culturalContext: video.cultural_context,
        guide,
        lines,
        quiz,
        shadow,
        learnerBlock: learner.block,
      }),
      model: DEFAULT_CHAT,
      temperature: 0.6,
      maxTokens: step === "recap" ? 900 : 600,
      responseHeaders: corsHeaders,
      signal: req.signal,
      // Judge only the Arabic the tutor wrote. The video's lines are a native
      // speaker's own words, and the learner's are theirs.
      nativeReview: {
        sources: [
          ...lines.map((l) => l.arabic),
          ...quiz.map((q) => q.arabic),
          ...messages.filter((m) => m.role === "user").map((m) => m.content),
        ],
      },
    });
  } catch (err) {
    if (err instanceof BrainHttpError) {
      if (err.status === 429) return json({ error: "Rate limit reached. Please try again in a moment." }, 429, corsHeaders);
      if (err.status === 402) return json({ error: "AI credits exhausted. Please add credits in Settings." }, 402, corsHeaders);
    }
    console.error("video-debrief error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500, corsHeaders);
  }
});
