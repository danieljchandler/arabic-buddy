import type { Row } from "../postgrest/types";
import { TEST_USER_ID } from "../server/session";

/**
 * Domain row builders.
 *
 * Every factory takes an override object and fills the rest with defaults that
 * are valid for the schema, so a spec states only what it cares about. Arabic
 * text always comes from here rather than being retyped in a spec — bidi
 * control characters and normalisation differences make hand-typed Arabic a
 * reliable source of assertions that fail for reasons unrelated to the code.
 */

const DAY = 24 * 60 * 60 * 1000;

/** ISO timestamp offset from now. Negative is the past. */
export const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();

/** Days ago, as an ISO timestamp. Reads better than raw arithmetic in specs. */
export const daysAgo = (days: number): string => iso(-days * DAY);
export const daysFromNow = (days: number): string => iso(days * DAY);

/**
 * Deterministic ids, namespaced per table so a failure message says which kind
 * of row it is looking at.
 */
const makeId = (prefix: string) => (index = 0): string =>
  `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

export const wordId = makeId("11111111");
export const vocabId = makeId("22222222");
export const phraseId = makeId("33333333");
export const reviewId = makeId("44444444");
export const stageId = makeId("55555555");
export const lessonId = makeId("66666666");
export const topicId = makeId("77777777");
export const setPhraseId = makeId("88888888");
export const userSetPhraseId = makeId("99999999");
export const videoId = makeId("aaaaaaaa");
export const storyId = makeId("bbbbbbbb");
export const episodeId = makeId("cccccccc");
export const conceptId = makeId("dddddddd");

export { TEST_USER_ID };

// ── Identity ─────────────────────────────────────────────────────────────────

// `profiles` has no email column — the address lives in auth.users, which is
// why BibleAccess resolves a user through the admin_find_user RPC rather than
// querying profiles directly.
export const aProfile = (over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  display_name: "Test Learner",
  // Index.tsx bounces the user to /onboarding without this.
  onboarding_completed: true,
  preferred_dialect: "Gulf",
  // Both non-nullable in the schema and both read straight into form state by
  // the leaderboard's profile dialog, which cannot tell "false" from "absent".
  show_on_leaderboard: true,
  show_institution: true,
  institution_id: null,
  custom_institution: null,
  placement_level: "A2",
  placement_level_gulf: "A2",
  placement_level_egyptian: null,
  placement_level_yemeni: null,
  created_at: daysAgo(30),
  updated_at: daysAgo(1),
  ...over,
});

export const aRole = (role = "user", over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  role,
  created_at: daysAgo(30),
  ...over,
});

export const aSubscriber = (over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  email: "e2e@example.com",
  subscribed: true,
  subscription_tier: "standard",
  subscription_end: daysFromNow(30),
  ...over,
});

export const aUserXp = (over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  total_xp: 250,
  // `level`, not `current_level`.
  level: 1,
  xp_today: 20,
  xp_today_date: new Date().toISOString().slice(0, 10),
  xp_this_week: 60,
  week_start_date: new Date().toISOString().slice(0, 10),
  ...over,
});

// ── Curriculum ───────────────────────────────────────────────────────────────

export const aStage = (over: Row = {}): Row => ({
  id: stageId(0),
  name: "Foundations",
  name_arabic: "الأساسيات",
  stage_number: 1,
  cefr_level: "A1",
  description: null,
  display_order: 1,
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

export const aLesson = (over: Row = {}): Row => ({
  id: lessonId(0),
  stage_id: stageId(0),
  title: "Greetings",
  title_arabic: "تحيات",
  icon: "📚",
  gradient: "bg-gradient-green",
  display_order: 1,
  dialect_module: "Gulf",
  cefr_target: "A1",
  duration_minutes: 15,
  lesson_number: 1,
  status: "published",
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

export const aTopic = (over: Row = {}): Row => ({
  id: topicId(0),
  name: "Test Topic",
  name_arabic: "موضوع",
  gradient: "bg-gradient-blue",
  icon: "📖",
  display_order: 1,
  dialect_module: "Gulf",
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

export const aVocabularyWord = (over: Row = {}): Row => ({
  id: wordId(0),
  word_arabic: "كلمة",
  word_english: "word",
  image_url: null,
  audio_url: null,
  topic_id: null,
  lesson_id: null,
  image_position: null,
  display_order: 1,
  dialect_module: "Gulf",
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

/** A curriculum SRS card. Due yesterday by default. */
export const aWordReview = (over: Row = {}): Row => ({
  id: reviewId(0),
  user_id: TEST_USER_ID,
  word_id: wordId(0),
  // FSRS keeps stability in `ease_factor` and difficulty in `difficulty`. The
  // latter is missing from the generated types but real in the database — see
  // src/test/support/postgrest/typesDrift.ts.
  ease_factor: 5,
  difficulty: 5,
  interval_days: 3,
  repetitions: 2,
  lapses: 0,
  is_leech: false,
  mnemonic: null,
  last_reviewed_at: daysAgo(3),
  next_review_at: daysAgo(1),
  ...over,
});

export const aLessonProgress = (over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  lesson_id: lessonId(0),
  status: "in_progress",
  last_word_index: 0,
  words_seen: 0,
  words_total: 0,
  best_score: null,
  completed_at: null,
  updated_at: daysAgo(1),
  ...over,
});

// ── Saved vocabulary ─────────────────────────────────────────────────────────

export const aUserVocabulary = (over: Row = {}): Row => ({
  id: vocabId(0),
  user_id: TEST_USER_ID,
  word_arabic: "محفوظ",
  word_english: "saved word",
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
  next_review_at: daysAgo(1),
  last_reviewed_at: daysAgo(3),
  // The saved-vocabulary queries split recognition from production by which of
  // these two columns they filter on.
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
  review_count: 0,
  correct_count: 0,
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  ...over,
});

export const aUserPhrase = (over: Row = {}): Row => ({
  id: phraseId(0),
  user_id: TEST_USER_ID,
  phrase_arabic: "عبارة",
  phrase_english: "saved phrase",
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
  next_review_at: daysAgo(1),
  last_reviewed_at: daysAgo(3),
  phrase_audio_url: null,
  jingle_audio_url: null,
  jingle_lyrics: null,
  mnemonic: null,
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  ...over,
});

export const aSetPhrase = (over: Row = {}): Row => ({
  id: setPhraseId(0),
  phrase_arabic: "عبارة ثابتة",
  phrase_english: "set phrase",
  // The columns are prefixed: phrase_transliteration and phrase_literal.
  phrase_transliteration: null,
  phrase_literal: null,
  dialect: "Gulf",
  status: "published",
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

export const aUserSetPhrase = (over: Row = {}): Row => ({
  id: userSetPhraseId(0),
  user_id: TEST_USER_ID,
  phrase_id: setPhraseId(0),
  source: "e2e",
  ease_factor: 4,
  difficulty: 5,
  interval_days: 2,
  repetitions: 1,
  next_review_at: daysAgo(1),
  last_reviewed_at: daysAgo(3),
  last_quality: 4,
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  ...over,
});

// ── Learner state ────────────────────────────────────────────────────────────

export const aLearnerError = (over: Row = {}): Row => ({
  id: `e-${Math.random().toString(36).slice(2)}`,
  user_id: TEST_USER_ID,
  dialect: "Gulf",
  source: "pronunciation",
  target_arabic: "شغل",
  produced_arabic: "شغال",
  error_kind: "mispronunciation",
  resolved_at: null,
  created_at: iso(),
  ...over,
});

export const aConceptMastery = (over: Row = {}): Row => ({
  user_id: TEST_USER_ID,
  concept_id: conceptId(0),
  exposures: 10,
  correct: 8,
  incorrect: 2,
  ease: 2.3,
  strength: "strong",
  next_due_at: iso(),
  last_seen_at: iso(),
  ...over,
});

// ── Content ──────────────────────────────────────────────────────────────────

/**
 * Column names here follow the generated types exactly — `published`, not
 * `is_published`, and `source_url`/`embed_url` rather than `video_url`. A
 * fixture that invents a column simply never matches the query's filter, and
 * the test reads as "no videos" rather than as a broken fixture.
 */
export const aDiscoverVideo = (over: Row = {}): Row => ({
  id: videoId(0),
  title: "A short clip",
  title_arabic: null,
  source_url: "https://www.youtube.com/watch?v=fixture",
  embed_url: "https://www.youtube.com/embed/fixture",
  platform: "youtube",
  thumbnail_url: null,
  dialect: "Gulf",
  difficulty: "beginner",
  cefr_level: "A2",
  duration_seconds: 60,
  published: true,
  is_meme: false,
  transcription_status: "complete",
  transcript_lines: [],
  vocabulary: [],
  grammar_points: [],
  created_by: TEST_USER_ID,
  created_at: daysAgo(5),
  updated_at: daysAgo(5),
  ...over,
});

export const aListenEpisode = (over: Row = {}): Row => ({
  id: episodeId(0),
  title: "Episode one",
  dialect: "Gulf",
  // creator_id, format, length_bucket and topic are all NOT NULL.
  creator_id: TEST_USER_ID,
  format: "podcast",
  length_bucket: "short",
  topic: "greetings",
  full_audio_url: "https://cdn.test/episode.mp3",
  audio_status: "ready",
  play_count: 0,
  created_at: daysAgo(5),
  updated_at: daysAgo(5),
  ...over,
});

export const anAuthenticStory = (over: Row = {}): Row => ({
  id: storyId(0),
  title: "A story",
  title_arabic: "قصة",
  dialect: "Gulf",
  // `difficulty` and `status`, not cefr_level and is_published.
  difficulty: "beginner",
  status: "published",
  created_at: daysAgo(5),
  updated_at: daysAgo(5),
  ...over,
});

// `invite_codes` has no is_active column — a code is disabled by expiring it or
// by exhausting max_uses, which is what verify_invite_code actually checks.
export const anInviteCode = (over: Row = {}): Row => ({
  id: makeId("eeeeeeee")(0),
  code: "BETA1234",
  max_uses: 10,
  uses: 0,
  expires_at: daysFromNow(30),
  note: null,
  created_by: TEST_USER_ID,
  created_at: daysAgo(30),
  ...over,
});

/** Build `count` rows from a factory, giving each a distinct id. */
export function many(
  factory: (over?: Row) => Row,
  count: number,
  build: (index: number) => Row = () => ({}),
): Row[] {
  return Array.from({ length: count }, (_, index) => factory(build(index)));
}
