/**
 * The daily recap's database half: everything the app recorded about a
 * learner inside a window, read under the service role and handed to
 * `recapCore.ts` as plain rows.
 *
 * Ten bounded queries, in parallel, each failing soft — a table the live
 * project has not been migrated for yet (`video_word_lookups`, say) costs the
 * recap that signal, never the session. Reading a learner's own decks and
 * views crosses RLS, which is why this runs as the service role; nothing here
 * takes a row from the request, only the learner's id and the window.
 *
 * Two depths. `counts` is what the strip at the bottom of the screen needs —
 * is there anything to recap, and roughly what — and skips transcripts and
 * guides. `full` loads the watched videos' spoken lines and study guides, and
 * writes a guide for at most one video that has none, so a clip watched
 * yesterday that nobody has debriefed still has a summary to be retold from.
 */
import {
  guideIsCurrent,
  parseStoredGuide,
  spokenLines,
  type VideoStudyGuide,
} from "./videoDebriefCore.ts";
import {
  ensureStudyGuide,
  STUDY_GUIDE_VIDEO_COLUMNS,
  studyGuideAdmin,
  type StudyGuideVideo,
} from "./videoStudyGuide.ts";
import {
  emptyWindow,
  recapBounds,
  windowHasContent,
  type RecapBounds,
  type RecapErrorRow,
  type RecapLesson,
  type RecapLookupRow,
  type RecapSavedRow,
  type RecapVideo,
  type RecapWindow,
} from "./recapCore.ts";

// ── Minimal structural type for the PostgREST client ─────────────────────────
// Same pattern as dailyStory.ts: the generated frontend types are not available
// to edge functions, so the client is typed by the handful of methods used.
interface DbResponse {
  data: unknown;
  error?: { message: string; code?: string } | null;
}

interface Query extends PromiseLike<DbResponse> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  is(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Query;
}

export interface RecapDb {
  from(table: string): Query;
}

type Row = Record<string, unknown>;

/** How much of each kind of row is read. The recap shows a few of everything, never all of it. */
export const WINDOW_LIMITS = {
  views: 8,
  saved: 40,
  reviewSlips: 10,
  lookups: 40,
  errors: 60,
  lessons: 5,
  stories: 4,
  chats: 4,
} as const;

export type WindowDepth = "counts" | "full";

export interface CollectOptions {
  userId: string;
  dialect: string;
  bounds: RecapBounds;
  supabase?: RecapDb;
  depth?: WindowDepth;
  /** Videos with no current study guide to write one for, most recently watched first. */
  prepareGuides?: number;
}

async function rows(query: Query, what: string): Promise<Row[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.warn(`[recapWindow] ${what} unavailable:`, error.message);
      return [];
    }
    return Array.isArray(data) ? (data as Row[]) : [];
  } catch (err) {
    console.warn(`[recapWindow] ${what} failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function one(query: Query, what: string): Promise<Row | null> {
  try {
    const { data, error } = await query;
    if (error) {
      console.warn(`[recapWindow] ${what} unavailable:`, error.message);
      return null;
    }
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Row) : null;
  } catch (err) {
    console.warn(`[recapWindow] ${what} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const sameDialect = (a: unknown, b: string) => !a || str(a).toLowerCase() === b.toLowerCase();

/** The words saved in the window. Read twice over when the column that names a word's video is not there yet. */
async function savedWords(db: RecapDb, opts: CollectOptions): Promise<RecapSavedRow[]> {
  const columns = "id, word_arabic, word_english, sentence_text, sentence_english, source, created_at";
  const query = (select: string) =>
    db
      .from("user_vocabulary")
      .select(select)
      .eq("user_id", opts.userId)
      .eq("dialect", opts.dialect)
      .gte("created_at", opts.bounds.since)
      .lt("created_at", opts.bounds.until)
      .order("created_at", { ascending: false })
      .limit(WINDOW_LIMITS.saved);
  const withVideo = await query(`${columns}, source_video_id`);
  const result = withVideo.error ? await query(columns) : withVideo;
  if (result.error) {
    console.warn("[recapWindow] saved words unavailable:", result.error.message);
    return [];
  }
  return (Array.isArray(result.data) ? result.data : []) as RecapSavedRow[];
}

/** Which videos the learner watched, newest first, in the window's dialect, with whatever depth asks for. */
async function watchedVideos(db: RecapDb, opts: CollectOptions): Promise<RecapVideo[]> {
  const views = await rows(
    db
      .from("video_views")
      .select("video_id, watched_at, completed")
      .eq("user_id", opts.userId)
      .gte("watched_at", opts.bounds.since)
      .lt("watched_at", opts.bounds.until)
      .order("watched_at", { ascending: false })
      .limit(WINDOW_LIMITS.views),
    "video views",
  );
  const viewById = new Map<string, { watchedAt: string; completed: boolean }>();
  for (const view of views) {
    const id = str(view.video_id);
    if (id && !viewById.has(id)) viewById.set(id, { watchedAt: str(view.watched_at), completed: view.completed === true });
  }
  if (viewById.size === 0) return [];
  const ids = [...viewById.keys()];
  const full = opts.depth !== "counts";
  const columns = full ? STUDY_GUIDE_VIDEO_COLUMNS : "id, title, dialect, cefr_level, published";
  const videoRows = await rows(db.from("discover_videos").select(columns).in("id", ids), "videos");

  const guides = new Map<string, Row>();
  if (full) {
    const guideRows = await rows(
      db.from("video_study_guides").select("video_id, guide, transcript_hash, version").in("video_id", ids),
      "study guides",
    );
    for (const row of guideRows) guides.set(str(row.video_id), row);
  }

  const videos: RecapVideo[] = [];
  for (const row of videoRows) {
    const id = str(row.id);
    const view = viewById.get(id);
    if (!view || row.published !== true || !sameDialect(row.dialect, opts.dialect)) continue;
    const lines = full ? spokenLines(row.transcript_lines) : [];
    let guide: VideoStudyGuide | null = null;
    const stored = guides.get(id);
    if (stored && lines.length && guideIsCurrent({ version: stored.version as number, transcript_hash: stored.transcript_hash as string }, lines)) {
      guide = parseStoredGuide(stored.guide, lines);
    }
    videos.push({
      id,
      title: str(row.title) || "Untitled video",
      dialect: str(row.dialect) || opts.dialect,
      cefrLevel: typeof row.cefr_level === "string" ? row.cefr_level : null,
      watchedAt: view.watchedAt,
      completed: view.completed,
      culturalContext: typeof row.cultural_context === "string" ? row.cultural_context : null,
      lines,
      keyVocabulary: row.vocabulary,
      guide,
    });
  }
  videos.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));

  // A clip watched yesterday that nobody has debriefed has no guide, and so
  // no summary to be retold from. Write one for the most recent such video
  // only: each is a model call, and the plan has a wall clock.
  let budget = full ? (opts.prepareGuides ?? 1) : 0;
  for (const video of videos) {
    if (budget <= 0) break;
    if (video.guide || video.lines.length === 0) continue;
    budget--;
    const source = videoRows.find((r) => str(r.id) === video.id) as unknown as StudyGuideVideo | undefined;
    if (!source) continue;
    try {
      const ensured = await ensureStudyGuide(source, video.lines);
      if (ensured) video.guide = ensured.guide;
    } catch (err) {
      console.warn("[recapWindow] guide not prepared:", err instanceof Error ? err.message : err);
    }
  }
  return videos;
}

/**
 * Everything recorded about the learner inside `bounds`, in `dialect`.
 *
 * Never throws. A window with nothing in it is a window with nothing in it,
 * and a query that fails reads as empty — the caller decides what an empty
 * window means (the summary says "nothing yet"; the plan widens to a week).
 */
export async function collectRecapWindow(opts: CollectOptions): Promise<RecapWindow> {
  const db = opts.supabase ?? (studyGuideAdmin() as unknown as RecapDb);
  const { userId, dialect, bounds } = opts;
  const window = emptyWindow(bounds, dialect);
  const inWindow = (query: Query, column: string) => query.gte(column, bounds.since).lt(column, bounds.until);

  const [videos, saved, reviewSlips, lookups, errors, lessons, storyRows, dailyStories, chats, challenges, memory] =
    await Promise.all([
      watchedVideos(db, { ...opts, supabase: db }),
      savedWords(db, { ...opts, supabase: db }),
      rows(
        inWindow(
          db
            .from("user_vocabulary")
            .select("id, word_arabic, word_english, sentence_text, sentence_english, source, last_result, last_reviewed_at")
            .eq("user_id", userId)
            .eq("dialect", dialect)
            .in("last_result", ["again", "hard"]),
          "last_reviewed_at",
        )
          .order("last_reviewed_at", { ascending: false })
          .limit(WINDOW_LIMITS.reviewSlips),
        "review slips",
      ),
      rows(
        inWindow(
          db.from("video_word_lookups").select("video_id, word_arabic, word_english, line_id").eq("user_id", userId),
          "created_at",
        )
          .order("created_at", { ascending: false })
          .limit(WINDOW_LIMITS.lookups),
        "word look-ups",
      ),
      rows(
        inWindow(
          db
            .from("learner_errors")
            .select("target_arabic, produced_arabic, error_kind, source")
            .eq("user_id", userId)
            .eq("dialect", dialect)
            .is("resolved_at", null),
          "created_at",
        )
          .order("created_at", { ascending: false })
          .limit(WINDOW_LIMITS.errors),
        "learner errors",
      ),
      rows(
        inWindow(
          db
            .from("lesson_progress")
            .select("status, updated_at, lessons(title, title_arabic, dialect_module)")
            .eq("user_id", userId),
          "updated_at",
        )
          .order("updated_at", { ascending: false })
          .limit(WINDOW_LIMITS.lessons),
        "lessons",
      ),
      rows(
        inWindow(
          db.from("story_progress").select("completed, started_at, interactive_stories(title, dialect)").eq("user_id", userId),
          "started_at",
        )
          .order("started_at", { ascending: false })
          .limit(WINDOW_LIMITS.stories),
        "stories",
      ),
      rows(
        inWindow(db.from("daily_vocab_stories").select("title").eq("user_id", userId).eq("dialect", dialect), "created_at")
          .order("created_at", { ascending: false })
          .limit(2),
        "daily stories",
      ),
      rows(
        inWindow(db.from("saved_chat_conversations").select("title").eq("user_id", userId).eq("dialect", dialect), "updated_at")
          .order("updated_at", { ascending: false })
          .limit(WINDOW_LIMITS.chats),
        "saved chats",
      ),
      rows(
        inWindow(db.from("daily_challenge_completions").select("score, max_score").eq("user_id", userId), "completed_at")
          .order("completed_at", { ascending: false })
          .limit(1),
        "daily challenge",
      ),
      one(
        db.from("learner_ai_memory").select("open_questions").eq("user_id", userId).eq("dialect", dialect).maybeSingle(),
        "tutor memory",
      ),
    ]);

  window.videos = videos;
  window.saved = saved;
  const savedIds = new Set(saved.map((row) => row.id));
  window.reviewSlips = (reviewSlips as unknown as RecapSavedRow[]).filter((row) => !savedIds.has(row.id));
  const videoIds = new Set(videos.map((v) => v.id));
  window.lookups = (lookups as unknown as RecapLookupRow[]).filter((row) => videoIds.has(str(row.video_id)));
  window.errors = (errors as unknown as RecapErrorRow[]).filter((row) => typeof row.target_arabic === "string");
  window.lessons = lessons
    .map((row): RecapLesson | null => {
      const lesson = row.lessons as Row | null;
      if (!lesson || !sameDialect(lesson.dialect_module, dialect)) return null;
      const title = str(lesson.title);
      return title ? { title, titleArabic: typeof lesson.title_arabic === "string" ? lesson.title_arabic : null, status: str(row.status) || "started" } : null;
    })
    .filter((l): l is RecapLesson => l !== null);
  window.stories = [
    ...dailyStories.map((row) => str(row.title)),
    ...storyRows.map((row) => {
      const story = row.interactive_stories as Row | null;
      return story && sameDialect(story.dialect, dialect) ? str(story.title) : "";
    }),
  ].filter(Boolean);
  window.chats = chats.map((row) => str(row.title)).filter(Boolean);
  const challenge = challenges[0];
  if (challenge && typeof challenge.score === "number" && typeof challenge.max_score === "number") {
    window.challenge = { score: challenge.score, max: challenge.max_score };
  }
  if (memory && Array.isArray(memory.open_questions)) {
    window.openQuestions = memory.open_questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
  }
  return window;
}

export interface ResolveOptions {
  userId: string;
  dialect: string;
  /** What the client said about its clock. */
  input: { localDate?: unknown; tzOffsetMinutes?: unknown };
  supabase?: RecapDb;
  depth?: WindowDepth;
  prepareGuides?: number;
  now?: Date;
}

/** The windows tried, in order: yesterday, then the last week. */
export const WINDOW_LADDER = [1, 7] as const;

/**
 * Yesterday's window — or, when yesterday was empty, the last week's.
 *
 * A learner who skipped a day should not open the app to "nothing to recap":
 * the week they did have is the next best thing to go over, and the plan says
 * which it was.
 */
export async function resolveRecapWindow(opts: ResolveOptions): Promise<RecapWindow> {
  let last: RecapWindow | null = null;
  for (const days of WINDOW_LADDER) {
    const bounds = recapBounds({ ...opts.input, days, now: opts.now });
    last = await collectRecapWindow({
      userId: opts.userId,
      dialect: opts.dialect,
      bounds,
      supabase: opts.supabase,
      depth: opts.depth,
      prepareGuides: opts.prepareGuides,
    });
    if (windowHasContent(last)) return last;
  }
  return last!;
}
