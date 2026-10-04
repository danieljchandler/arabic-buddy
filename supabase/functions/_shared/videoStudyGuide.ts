/**
 * The per-video study guide — loading, writing and caching it.
 *
 * The guide is the static half of the post-video debrief (see
 * `videoDebriefCore.ts` for what is in one and why): a summary, the questions
 * with their answer key, lines worth shadowing, talking points. It is written
 * once per video by a model that reads the whole transcript and its
 * translations, then cached in `video_study_guides`, so a debrief never pays
 * for that reading again.
 *
 * Three callers: the ingest pipeline (a new video gets its guide as soon as
 * its transcript is final), the admin backfill (every video that predates
 * this), and the debrief itself, which generates one on the spot for any video
 * the other two missed — or whose transcript a reviewer has since changed.
 *
 * Every database step here degrades rather than throws. A guide that cannot be
 * stored (the migration not applied yet) is still returned and used; it is
 * just written again next time.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "./aiBrain.ts";
import { getDialectLabel } from "./dialectHelpers.ts";
import { MODEL_IDS } from "./modelRegistry.ts";
import {
  guideAuthoredArabic,
  guideIsCurrent,
  guideSystemPrompt,
  guideUserPrompt,
  parseStoredGuide,
  sanitizeGuide,
  STUDY_GUIDE_TOOL,
  STUDY_GUIDE_VERSION,
  transcriptHash,
  type DebriefLine,
  type VideoStudyGuide,
} from "./videoDebriefCore.ts";

/** The `discover_videos` columns a guide is written from. */
export const STUDY_GUIDE_VIDEO_COLUMNS =
  "id, title, dialect, cefr_level, cultural_context, is_meme, vocabulary, grammar_points, transcript_lines, published";

export interface StudyGuideVideo {
  id: string;
  title: string;
  dialect: string;
  cefr_level?: string | null;
  cultural_context?: string | null;
  is_meme?: boolean | null;
  vocabulary?: unknown;
  grammar_points?: unknown;
  transcript_lines?: unknown;
  published?: boolean | null;
}

/**
 * The model that writes guides. One call per video, ever, so it is the strong
 * generalist rather than the cheap one: the questions and their answer key are
 * what every later debrief turn leans on.
 */
export const STUDY_GUIDE_MODEL = MODEL_IDS.CLAUDE;

let cached: ReturnType<typeof createClient> | null = null;
/** Service-role client: the guide table has no client grants at all. */
export function studyGuideAdmin() {
  if (!cached) {
    cached = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** The stored guide for a video, if one exists and still matches its transcript. */
export async function loadStudyGuide(videoId: string, lines: DebriefLine[]): Promise<VideoStudyGuide | null> {
  try {
    const { data, error } = await studyGuideAdmin()
      .from("video_study_guides")
      .select("guide, transcript_hash, version")
      .eq("video_id", videoId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { guide: unknown; transcript_hash: string | null; version: number | null };
    if (!guideIsCurrent(row, lines)) return null;
    return parseStoredGuide(row.guide, lines);
  } catch (e) {
    console.warn("[videoStudyGuide] load failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Ask a model for a guide. Null when it could not produce a usable one. */
export async function generateStudyGuide(
  video: StudyGuideVideo,
  lines: DebriefLine[],
): Promise<VideoStudyGuide | null> {
  const dialectLabel = getDialectLabel(video.dialect || "Gulf");
  try {
    const brain = await askBrain<unknown>({
      purpose: "video_study_guide",
      dialect: video.dialect || "Gulf",
      strategy: "solo",
      models: [STUDY_GUIDE_MODEL],
      temperature: 0.4,
      maxTokens: 3000,
      systemPromptExtra: guideSystemPrompt(dialectLabel),
      userPrompt: guideUserPrompt(
        {
          title: video.title,
          dialectLabel,
          cefrLevel: video.cefr_level,
          culturalContext: video.cultural_context,
          isMeme: video.is_meme,
          vocabulary: video.vocabulary,
          grammarPoints: video.grammar_points,
        },
        lines,
      ),
      // Only the Arabic the model wrote is checked for MSA. The key phrases are
      // quotes from the video, and repairing those would be the app correcting
      // a native speaker.
      arabicTextPath: guideAuthoredArabic,
      tool: STUDY_GUIDE_TOOL,
    });
    return sanitizeGuide(brain.output, lines);
  } catch (e) {
    console.warn("[videoStudyGuide] generation failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Store a guide. False when it could not be written (logged, never thrown). */
export async function saveStudyGuide(
  videoId: string,
  lines: DebriefLine[],
  guide: VideoStudyGuide,
): Promise<boolean> {
  try {
    const { error } = await studyGuideAdmin()
      .from("video_study_guides")
      .upsert(
        {
          video_id: videoId,
          guide,
          transcript_hash: transcriptHash(lines),
          version: STUDY_GUIDE_VERSION,
          model: STUDY_GUIDE_MODEL,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "video_id" },
      );
    if (error) {
      console.warn("[videoStudyGuide] save failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[videoStudyGuide] save threw:", e instanceof Error ? e.message : e);
    return false;
  }
}

export interface EnsuredGuide {
  guide: VideoStudyGuide;
  /** True when this call wrote it (rather than finding it cached). */
  generated: boolean;
  /** False when a freshly written guide could not be stored. */
  stored: boolean;
}

/** The video's guide: the cached one when current, otherwise a new one (stored if possible). */
export async function ensureStudyGuide(
  video: StudyGuideVideo,
  lines: DebriefLine[],
  opts: { force?: boolean } = {},
): Promise<EnsuredGuide | null> {
  if (!opts.force) {
    const existing = await loadStudyGuide(video.id, lines);
    if (existing) return { guide: existing, generated: false, stored: true };
  }
  const guide = await generateStudyGuide(video, lines);
  if (!guide) return null;
  const stored = await saveStudyGuide(video.id, lines, guide);
  return { guide, generated: true, stored };
}
