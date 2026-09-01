import type { MemoryDb } from "../postgrest/store";
import {
  diffTranscriptRevisions,
  diffVideoField,
  type TranscriptRevision,
} from "../../../../supabase/functions/_shared/transcriptRevisionCore";
import {
  isReviewableDialect,
  resolveSubvariety,
  sanitizeDialectFeatures,
} from "../../../../supabase/functions/_shared/dialectSubvarieties";

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
  /**
   * Set for the handful of functions the app consumes as an SSE stream.
   *
   * Each entry becomes one `data:` frame, JSON-encoded. Objects rather than
   * strings, because the three streaming callers all parse OpenAI's delta
   * shape — `parsed.choices[0].delta.content` — so a frame carrying a bare
   * string would be silently skipped by every one of them. `[DONE]` is
   * appended by the transport.
   */
  stream?: unknown[];
  /**
   * Set for functions that answer with a binary body rather than JSON.
   *
   * `body` is ignored when this is present. Only the TTS trio needs it today:
   * they return raw audio and their caller pipes `res.blob()` into an `<audio>`
   * element, so a JSON body would arrive as an unplayable source.
   */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export type FunctionHandler = (context: FunctionContext) => FunctionResponse | unknown;

const ok = (body: unknown): FunctionResponse => ({ status: 200, body });

/**
 * An SSE response streaming `pieces` as OpenAI-shaped deltas.
 *
 * The three streaming callers — culture guide, the conversation simulator and
 * the ask-about-this-sentence panel — all read
 * `parsed.choices[0].delta.content` and ignore anything else, so this is the
 * only frame shape that reaches them. Splitting a sentence across several
 * pieces is the point: the incremental append is the behaviour under test, and
 * a single-chunk stream would pass even if the accumulation were broken.
 */
export const streaming = (...pieces: string[]): FunctionResponse => ({
  status: 200,
  body: null,
  stream: pieces.map((content) => ({ choices: [{ delta: { content } }] })),
});

/**
 * A short, genuinely decodable silent clip.
 *
 * A zero-length buffer would satisfy `res.blob()` and then fail in the media
 * element, which is the failure the old JSON fixture produced. This is a real
 * WAV of 8kHz mono PCM — Chromium parses it, reports a duration and fires
 * `ended`, so playback state in the page advances the way it does in
 * production. The TTS fixtures stay at the 44-byte zero-sample header;
 * storage downloads ask for actual duration so a page seeking into the file
 * (TikTok's per-phrase playback) has somewhere to seek to.
 */
export function silentWav(durationMs = 0): Uint8Array<ArrayBuffer> {
  const sampleRate = 8000;
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const dataBytes = samples * 2; // 16-bit mono
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // chunk size
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true); // sample rate
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true); // sample data length (silence = zeros)
  return bytes;
}

/**
 * The jingle functions' answer: base64 audio in a JSON envelope.
 *
 * Deliberately not raw bytes. `functions.invoke` coerces a binary body through
 * UTF-8 in some environments, which turns an MP3 into white noise — the base64
 * round trip is what keeps the audio intact, and the caller decodes it.
 */
const aJingle = () => ({
  audioBase64: btoa(String.fromCharCode(...silentWav())),
  mimeType: "audio/wav",
  extension: "wav",
  lyrics: "la la la",
});

/**
 * A binary audio response, as the TTS functions actually send one.
 *
 * The content type is the one each function declares, because the caller hands
 * the blob straight to an `<audio>` element and the type is what decides
 * whether it plays.
 */
const audio = (contentType: string): FunctionResponse => ({
  status: 200,
  body: null,
  bytes: silentWav(),
  headers: { "content-type": contentType },
});

/**
 * The shape each function returns on success, minimal but valid.
 *
 * Derived from each function's own response literal. They are intentionally
 * boring — a test that cares about the content overrides them.
 */
/** Roles `transcript-review` admits. Mirrors `can_review_transcripts()`. */
const REVIEWER_ROLES = ["admin", "content_reviewer", "transcriber"];

type Row = Record<string, unknown>;

/**
 * A working `transcript-review`, against the in-memory database.
 *
 * Close enough to the Deno original that the interesting assertions are the
 * same ones: it re-reads the stored transcript rather than trusting the request
 * body, computes the diff with the very module the real function uses, and
 * stamps `changed_by` from the session rather than from the payload.
 */
function transcriptReview({ db, userId, body }: FunctionContext): FunctionResponse {
  const payload = (body ?? {}) as Row;
  const action = String(payload.action ?? "");
  const videoId = String(payload.videoId ?? "");

  const roles = db
    .rows("user_roles")
    .filter((row) => row.user_id === userId)
    .map((row) => String(row.role));
  if (!userId || !roles.some((role) => REVIEWER_ROLES.includes(role))) {
    return { status: 403, body: { error: "forbidden" } };
  }

  const video = db.rows("discover_videos").find((row) => row.id === videoId);
  const storedLines = Array.isArray(video?.transcript_lines)
    ? (video.transcript_lines as Row[])
    : [];

  const writeLines = (lines: unknown[]) => {
    const live = db.raw("discover_videos").find((row) => row.id === videoId);
    if (live) live.transcript_lines = lines;
  };

  const logRevisions = (
    revisions: Array<{
      lineId: string | null;
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }>,
    source: string,
  ) => {
    for (const [index, revision] of revisions.entries()) {
      db.add("transcript_line_revisions", {
        id: `rev-${db.rows("transcript_line_revisions").length + index}`,
        video_id: videoId,
        line_id: revision.lineId,
        field: revision.field,
        previous_value: revision.previousValue,
        new_value: revision.newValue,
        changed_by: userId,
        changed_at: new Date().toISOString(),
        source,
      });
    }
  };

  switch (action) {
    case "save_lines": {
      if (!video) return { status: 404, body: { error: "video_not_found" } };
      const lines = Array.isArray(payload.lines) ? (payload.lines as Row[]) : [];
      // Mirrors the real function's shape check, so a fixture that posts
      // something that is not a transcript fails here too.
      if (lines.some((line) => typeof line?.id !== "string" || !line.id)) {
        return { status: 400, body: { error: "invalid_transcript" } };
      }
      const revisions = diffTranscriptRevisions(storedLines, lines);
      writeLines(lines);
      logRevisions(
        revisions,
        payload.source === "ai_resegment" ? "ai_resegment"
          : payload.source === "resync" ? "resync"
          : "human",
      );
      return ok({ saved: true, revisions: revisions.length, logged: true });
    }

    case "set_reviewed": {
      if (!video) return { status: 404, body: { error: "video_not_found" } };
      const lineId = String(payload.lineId ?? "");
      const reviews = db.raw("transcript_line_reviews");
      const existing = reviews.findIndex(
        (row) => row.video_id === videoId && row.line_id === lineId,
      );

      if (payload.reviewed === false) {
        if (existing !== -1) reviews.splice(existing, 1);
        return ok({ reviewed: false });
      }

      const line = storedLines.find((row) => row.id === lineId);
      if (!line) return { status: 404, body: { error: "line_not_found" } };

      const row: Row = {
        id: existing === -1 ? `review-${reviews.length}` : reviews[existing].id,
        video_id: videoId,
        line_id: lineId,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        reviewed_arabic: line.arabic ?? null,
        reviewed_translation: line.translation ?? null,
      };
      if (existing === -1) reviews.push(row);
      else reviews[existing] = row;
      return ok({ reviewed: true });
    }

    case "retranslate_line": {
      if (!video) return { status: 404, body: { error: "video_not_found" } };
      const lineId = String(payload.lineId ?? "");
      const index = storedLines.findIndex((row) => row.id === lineId);
      if (index === -1) return { status: 404, body: { error: "line_not_found" } };

      const translation = "retranslated";
      const next = storedLines.map((row, i) =>
        i === index ? { ...row, translation } : row,
      );
      writeLines(next);
      logRevisions(diffTranscriptRevisions(storedLines, next), "ai_retranslate");
      return ok({ translation, literal: null });
    }

    case "add_comment": {
      const text = String(payload.body ?? "").trim();
      if (!text) return { status: 400, body: { error: "body_required" } };
      const comment: Row = {
        id: `comment-${db.rows("transcript_line_comments").length}`,
        video_id: videoId,
        line_id: payload.lineId ? String(payload.lineId) : null,
        kind: String(payload.kind ?? "comment"),
        body: text,
        suggested_translation: String(payload.suggestedTranslation ?? "") || null,
        author_id: userId,
        created_at: new Date().toISOString(),
        resolved_at: null,
        resolved_by: null,
      };
      db.add("transcript_line_comments", comment);
      return ok({ comment });
    }

    case "resolve_comment": {
      const commentId = String(payload.commentId ?? "");
      const comment = db.raw("transcript_line_comments").find((row) => row.id === commentId);
      if (comment) {
        const resolved = payload.resolved !== false;
        comment.resolved_at = resolved ? new Date().toISOString() : null;
        comment.resolved_by = resolved ? userId : null;
      }
      return ok({ resolved: payload.resolved !== false });
    }

    case "save_notes": {
      if (!video) return { status: 404, body: { error: "video_not_found" } };
      const live = db.raw("discover_videos").find((row) => row.id === videoId)!;
      const revisions: TranscriptRevision[] = [];

      // The dialect classification, resolved first: the sub-variety and the
      // features are only meaningful relative to whatever the dialect ends up
      // being, exactly as in the real function.
      let effectiveDialect = video.dialect;
      // Whether *this save* moved the country, which is not the same question
      // as whether the payload mentioned it. Only a save that actually moved it
      // may clear a sub-variety the client said nothing about.
      let dialectMoved = false;

      if ("dialect" in payload) {
        if (!isReviewableDialect(payload.dialect)) {
          return { status: 400, body: { error: "unknown_dialect" } };
        }
        const next = String(payload.dialect);
        const revision = diffVideoField("dialect", video.dialect, next);
        if (revision) {
          live.dialect = next;
          revisions.push(revision);
          dialectMoved = true;
        }
        effectiveDialect = next;
      }

      if ("dialectSubvariety" in payload) {
        const next = resolveSubvariety(effectiveDialect, payload.dialectSubvariety);
        const revision = diffVideoField(
          "dialect_subvariety",
          video.dialect_subvariety,
          next,
        );
        if (revision) {
          live.dialect_subvariety = next;
          revisions.push(revision);
        }
      } else if (dialectMoved && !resolveSubvariety(effectiveDialect, video.dialect_subvariety)) {
        const revision = diffVideoField("dialect_subvariety", video.dialect_subvariety, null);
        if (revision) {
          live.dialect_subvariety = null;
          revisions.push(revision);
        }
      }

      if ("dialectFeatures" in payload) {
        const next = sanitizeDialectFeatures(payload.dialectFeatures, effectiveDialect);
        const revision = diffVideoField("dialect_features", video.dialect_features, next);
        if (revision) {
          live.dialect_features = next;
          revisions.push(revision);
        }
      }

      if ("culturalContext" in payload) {
        const revision = diffVideoField(
          "cultural_context",
          video.cultural_context,
          payload.culturalContext,
        );
        if (revision) {
          live.cultural_context = String(payload.culturalContext ?? "") || null;
          revisions.push(revision);
        }
      }
      for (const [key, column] of [
        ["grammarPoints", "grammar_points"],
        ["vocabulary", "vocabulary"],
      ] as const) {
        if (!(key in payload)) continue;
        const next = Array.isArray(payload[key]) ? payload[key] : [];
        const revision = diffVideoField(column, video[column], next);
        if (revision) {
          live[column] = next;
          revisions.push(revision);
        }
      }

      logRevisions(revisions, "human");
      return ok({ saved: true, revisions: revisions.length, logged: true });
    }

    default:
      return { status: 400, body: { error: "unknown_action", action } };
  }
}

export const defaultFunctions: Record<string, FunctionHandler> = {
  // `tier`, not `subscription_tier`: the function names it `tier` and
  // `useSubscription` reads `data.tier`. A fixture using the other spelling
  // reports every subscriber as untiered while still looking subscribed.
  "check-subscription": () =>
    ok({ subscribed: false, tier: null, product_id: null, subscription_end: null }),
  "create-checkout": () => ok({ url: "https://checkout.stripe.test/session" }),
  "customer-portal": () => ok({ url: "https://billing.stripe.test/portal" }),
  // Fresh account, nothing on sale: the page renders its empty state and the
  // dark-until-configured purchase button stays hidden.
  "native-feedback": () =>
    ok({ balance: 0, requests: [], credits_per_pack: 5, purchase_enabled: false }),
  // Both of the writing page's calls, told apart by action: the prompt it
  // fetches on mount, and the review of whatever the spec typed.
  "writing-coach": (ctx) =>
    (ctx.body as { action?: string } | null)?.action === "prompt"
      ? ok({
          prompt: {
            scenario_english: "Your friend is planning the weekend.",
            message_arabic: "وش رايك نروح البر بكرة؟",
            message_transliteration: "wish rayik nrooh al-barr bukra?",
            message_english: "What do you think about going to the desert tomorrow?",
          },
        })
      : ok({
          review: {
            understandable: true,
            verdict: "Nice work — one small fix.",
            corrected_arabic: "ايه، يلا نروح",
            corrected_transliteration: "eh, yalla nrooh",
            corrected_english: "Yes, let's go",
            corrections: [],
            tips: [],
          },
        }),

  "generate-mnemonic": () => ok({ mnemonic: "a memorable hook" }),
  "generate-flashcard-image": () => ok({ imageUrl: "https://cdn.test/flashcard.png" }),
  // Base64 audio plus the type and extension the caller needs to store it —
  // not a URL. `MyWordsReview` decodes `audioBase64`, uploads it with
  // `mimeType` and names the file from `extension`, so the earlier
  // `{ audioUrl }` matched nothing it reads and every jingle upload failed on
  // an undefined blob.
  "generate-word-jingle": () => ok(aJingle()),
  "generate-phrase-jingle": () => ok(aJingle()),
  "persist-word-audio": () => ok({ audioUrl: "https://cdn.test/word.mp3" }),

  // Raw audio, not JSON. All three return `new Response(audioBuffer)` with an
  // audio content type, and every caller pipes `res.blob()` through
  // `URL.createObjectURL` into an `<audio>` element. The `{ audioContent: "" }`
  // these used to answer was invented — nothing in the app reads that field —
  // and it made every playback log a media error while still looking stubbed.
  "azure-tts": () => audio("audio/mpeg"),
  "munsit-tts": () => audio("audio/wav"),
  "elevenlabs-tts": () => audio("audio/mpeg"),
  // The dialect-routed endpoint every surface now calls. WAV because it
  // resolves to Munsit for every dialect.
  "tts-speak": () => audio("audio/wav"),

  // Per-sentence, with the detected dialect alongside the requested one —
  // `useTranslateText` reads all three and Translate.tsx renders the detected
  // dialect as a badge. A flat `{ translation }` matched nothing it reads.
  "translate-text": () =>
    ok({ detected_dialect: "Gulf", sentences: [], used_dialect: "auto" }),
  // `msa` and `literal`, not `transliteration`. The word popover shows the MSA
  // equivalent and the word-for-word gloss; there is no transliteration in this
  // response at all, so the old fixture named a field nothing reads and omitted
  // the two that are rendered.
  "translate-phrase": () => ok({ translation: "translated", msa: "", literal: "" }),
  // Echoes one Fusha rendering per line asked for, so a caller that mis-aligns
  // the response fails instead of quietly rendering the first line's Arabic
  // under every sentence.
  "convert-to-fusha": ({ body }) => {
    const lines = (body as { lines?: unknown })?.lines;
    const count = Array.isArray(lines) ? lines.length : 0;
    return ok({
      fusha: Array.from({ length: count }, (_, i) => `فصحى ${i + 1}`),
      model: "test-model",
    });
  },
  "how-do-i-say": () => ok({ arabic: "كيف", english: "how", transliteration: "kayf" }),

  "grammar-drill": () => ok({ questions: [] }),
  "record-grammar-outcome": () => ok({ recorded: true }),
  "listening-quiz": () => ok({ questions: [] }),
  "daily-challenge": () => ok({ challenge: null }),
  // `history: []` serves the Profile level card's never-placed state; the
  // quiz shapes serve everything the quiz flow itself doesn't override.
  "placement-quiz": () => ok({ questions: [], level: "A2", history: [] }),
  "reading-passage": () => ok({ passage: "", questions: [] }),
  "reading-qa": () => ok({ answer: "" }),
  "phrase-of-the-day": () => ok({ phrase: null }),

  // One word in, one word's detail out — not a list. `TappableArabicText` reads
  // `definition`, `literal`, `root`, `transliteration` and `uses` off the top
  // level; the earlier `{ words: [] }` matched none of them, so every word
  // popover rendered blank while the call looked successful.
  "word-enrichment": () =>
    ok({
      definition: null,
      literal: null,
      root: null,
      transliteration: null,
      uses: [],
    }),
  "suggest-flashcards": () => ok({ suggestions: [] }),
  "generate-sample-sentences": () => ok({ sentences: [] }),

  // `items`, plus the cold-start flag and the seed the shuffle was built from.
  // `useDiscoverFeed` reads all three; the earlier `{ videos: [] }` matched none
  // of them, so the feed rendered empty and always claimed a warm start.
  "discover-feed": () =>
    ok({ items: [], cold_start: false, seed: 1, active_dialect: "Gulf", cefr: null }),
  "extract-grammar-points": () => ok({ points: [] }),

  // The shape useShadowScore actually reads — the old `{ score }` fixture
  // matched nothing the hook consumes. Persists a shadow_attempts row when a
  // clipRef arrives, as the real function does, so rep-progression assertions
  // see the same database production would.
  "score-shadow-attempt": ({ db, userId, body }) => {
    const b = (body ?? {}) as {
      referenceText?: string;
      dialect?: string;
      clipRef?: string;
      rep?: number;
    };
    const reference = String(b.referenceText ?? "");
    const words = reference.split(/\s+/).filter(Boolean);
    if (userId && b.clipRef) {
      db.add("shadow_attempts", {
        id: `sh-${db.rows("shadow_attempts").length + 1}`,
        user_id: userId,
        dialect: String(b.dialect ?? "Gulf"),
        clip_ref: b.clipRef,
        rep: Number(b.rep) || 1,
        reference_text: reference,
        recognized_text: reference,
        transcript_similarity: 0.9,
        created_at: new Date().toISOString(),
      });
    }
    return ok({
      recognizedText: reference,
      transcriptSimilarity: 0.9,
      wordDiffs: words.map((w) => ({ ref: w, said: w, status: "match" })),
    });
  },
  "pronunciation-feedback": () => ok({ feedback: "" }),
  // The flat result the function normalises Azure's response into. `words` and
  // `recognizedText` are not optional extras — the page renders the per-word
  // breakdown from one and the "what Azure heard" line from the other, and the
  // earlier `{ accuracyScore }` here matched no field the hook reads, so every
  // score rendered as zero while the call looked successful.
  "azure-pronunciation": () =>
    ok({
      overall: 80,
      accuracy: 80,
      fluency: 80,
      completeness: 100,
      words: [],
      recognizedText: "",
      locale: "ar-SA",
    }),
  "score-set-phrase-voice": () => ok({ score: 80 }),
  // The free-form chunk coach: a passing judgement with a rewrite, so the
  // answered card's coach view renders. quality 4 → correct + graded onto
  // the phrase's production track by the page.
  "practice-chunk-coach": () =>
    ok({
      transcript: "تسلم، الله يعطيك العافية على الشغل",
      used_chunk: true,
      understandable: true,
      natural: false,
      verdict: "Nicely deployed — one small polish.",
      natural_rewrite: "تسلم، الله يعطيك العافية على شغلك",
      natural_rewrite_english: "Thanks — may God give you strength for your work",
      tips: ["Possessive شغلك sounds more natural here."],
      quality: 4,
    }),

  // The fossilization drill on /mistakes. Items are derived from the seeded
  // learner_errors rows — the drill's whole premise is that the choices carry
  // the learner's own recorded production, so a canned fixture that ignored
  // the seed would test a generic quiz instead. The produce action resolves
  // matching rows in this database, so the page's refetch shows the card
  // leaving the list the way it does in production.
  "mistake-drill": ({ db, userId, body }) => {
    const b = (body ?? {}) as {
      action?: string;
      dialect?: string;
      targetArabic?: string;
      produced?: string;
    };
    if (b.action === "produce") {
      const accepted = (b.produced ?? "").trim() === (b.targetArabic ?? "").trim();
      if (accepted) {
        for (const row of db.raw("learner_errors")) {
          if (
            row.user_id === userId &&
            row.target_arabic === b.targetArabic &&
            !row.resolved_at
          ) {
            row.resolved_at = new Date().toISOString();
          }
        }
      }
      return ok({ accepted, similarity: accepted ? 1 : 0.4 });
    }
    const seen = new Set<string>();
    const items = db
      .rows("learner_errors")
      .filter(
        (r) =>
          r.user_id === userId &&
          !r.resolved_at &&
          (!b.dialect || r.dialect === b.dialect),
      )
      .filter((r) => {
        const target = String(r.target_arabic ?? "");
        if (!target || seen.has(target)) return false;
        seen.add(target);
        return true;
      })
      .map((r) => ({
        target_arabic: r.target_arabic,
        target_english: "the right way to say it",
        scenario_english: `A moment where you'd say "${r.target_arabic}".`,
        explanation: "That's the dialect form.",
        choices: [
          { arabic: r.target_arabic, correct: true },
          r.produced_arabic
            ? { arabic: r.produced_arabic, correct: false, yours: true }
            : { arabic: "غلط", correct: false },
        ],
        kinds: [r.error_kind ?? "other"],
        count: 1,
      }));
    return ok({ items });
  },

  // The monologue page's two calls. Prompts answer the fetch-on-mount; the
  // scorer persists a real attempt row so the page's trend query — which
  // reads monologue_attempts straight from this database — moves the way it
  // does in production.
  "monologue-prompts": () =>
    ok({
      prompts: [
        {
          topic_english: "Your day",
          prompt_arabic: "وش سويت اليوم من الصبح؟ احكي لي عن يومك",
          prompt_transliteration: "wish sawwait al-yoom min aS-Subh? ihki li 'an yoomik",
          prompt_english: "What have you done today since morning? Tell me about your day.",
        },
        {
          topic_english: "Food you love",
          prompt_arabic: "وش أكثر أكلة تحبها؟ وليش؟",
          prompt_transliteration: "wish akthar akla thibbha? w laish?",
          prompt_english: "What food do you love most, and why?",
        },
      ],
      source: "fallback",
    }),
  "score-monologue": ({ db, userId, body }) => {
    const durationMs = Number((body as { durationMs?: unknown } | null)?.durationMs) || 4000;
    // The full FluencyMetrics shape score-monologue stores and returns —
    // the page reads speed, run and pause fields off it by name.
    const metrics = {
      totalDurationSec: durationMs / 1000,
      phonationTimeSec: 2.4,
      wordCount: 5,
      syllableCount: 13,
      speechRateSylPerSec: 2.2,
      articulationRateSylPerSec: 5.4,
      runCount: 3,
      meanLengthOfRunWords: 1.7,
      meanLengthOfRunSyllables: 4.3,
      pauseCount: 2,
      pauseTimeSec: 1.6,
      meanPauseSec: 0.8,
      pausesPerMinute: 20,
      longPauseCount: 1,
      initialSilenceSec: 0.5,
      trailingSilenceSec: 1.5,
      repetitionCount: 1,
      gaps: [
        { afterWord: 1, durationSec: 0.5 },
        { afterWord: 3, durationSec: 1.1 },
      ],
    };
    const attemptId = `mono-${db.rows("monologue_attempts").length + 1}`;
    db.add("monologue_attempts", {
      id: attemptId,
      user_id: userId ?? "",
      dialect: String((body as { dialect?: unknown } | null)?.dialect ?? "Gulf"),
      prompt_text: String((body as { promptText?: unknown } | null)?.promptText ?? "") || null,
      duration_ms: durationMs,
      transcript: "مرحبا شباب اليوم بروح السوق",
      word_count: 5,
      metrics,
      asr_provider: "soniox",
      timings_available: true,
      created_at: new Date().toISOString(),
    });
    // Fossil callouts mirror production: unresolved seeded errors whose
    // target appears in the fixed transcript.
    const transcript = "مرحبا شباب اليوم بروح السوق";
    const fossils = [
      ...new Set(
        db
          .rows("learner_errors")
          .filter((r) => r.user_id === userId && !r.resolved_at)
          .map((r) => String(r.target_arabic ?? ""))
          .filter((t) => t && transcript.includes(t)),
      ),
    ].slice(0, 3);
    return ok({
      attemptId,
      transcript,
      wordCount: 5,
      metrics,
      feedback: {
        verdict: "A clear little story — one phrase to polish.",
        rewrite_original: "بروح السوق",
        rewrite_arabic: "بروح للسوق",
        rewrite_english: "I'm off to the market",
        fossil_targets: fossils,
      },
      provider: "soniox",
      timingsAvailable: true,
    });
  },

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

  // The native-speaker review workspace's only write path.
  //
  // Stateful rather than a canned 200, and sharing the real diff module, because
  // every property worth testing here is about what ends up in the database: a
  // tick that snapshots the text it approved, a revision row whose
  // `previous_value` is what was stored rather than what the client said, and a
  // role gate that holds. A stub returning `{ saved: true }` would pass all of
  // those tests while doing none of it.
  "transcript-review": (ctx) => transcriptReview(ctx),

  // Called on page mount, so the route sweep needs them to resolve.
  "generate-daily-story": () => ok({ story: null, scenes: [] }),
  // `items`, not `questions`: useGenerateQuiz reads `data?.items ?? []`, so the
  // other spelling made every quiz look empty regardless of what was seeded.
  "generate-set-phrase-quiz": () => ok({ items: [] }),
  "souq-news": () => ok({ articles: [] }),
  "souq-news-quiz": () => ok({ questions: [] }),
  "suggest-stories": () => ok({ suggestions: [] }),
  // `body_arabic`, plus the author fields the model may or may not know. The
  // old `{ text: "" }` left useGenerateStoryText destructuring undefined, so
  // the reading-library import could never complete.
  "generate-suggested-story-text": () =>
    ok({ body_arabic: "كان يا ما كان", author: null, author_arabic: null }),
  "request-situation-phrases": () => ok({ phrases: [] }),
  "practice-sentence-coach": () => ok({ feedback: "" }),
  // `comparison`, singular, and an object. The page reads `data.comparison`
  // and stores it whole; `{ comparisons: [] }` set it to undefined, so a
  // successful call rendered as if nothing had been asked.
  "dialect-compare": () =>
    ok({
      comparison: {
        word_arabic: "",
        word_english: "",
        dialects: [],
      },
    }),
  "culture-guide": () => ok({ answer: "" }),
  "free-chat": () => ok({ reply: "" }),
  "ask-translation": () => ok({ answer: "" }),
  "assistant-chat": () => streaming(""),
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
  // `client_secret` is a *string* here, not `{ value }`. The function emits the
  // key under both `value` and `client_secret` as flat strings; the nested form
  // is only one of three fallbacks the client tolerates for older payloads, so
  // a fixture using it exercised the fallback and never the real shape.
  "realtime-session-token": () =>
    ok({
      value: "fixture-token",
      client_secret: "fixture-token",
      expires_at: Math.floor(Date.now() / 1000) + 60,
      model: "gpt-realtime-2",
      voice: "ballad",
      session_id: "sess_fixture",
    }),
  "bible-passage": () => ok({ verses: [] }),
  // `summary` is an array of `{ occasion, inserted }`, one entry per occasion.
  // The fixture used to answer `{ inserted: 0 }`, which the admin page joined
  // into the toast "Seeded: undefined" — a success message describing nothing.
  "seed-set-phrases": () => ok({ summary: [{ occasion: "Greetings", inserted: 10 }] }),
  "suggest-stories-admin": () => ok({ suggestions: [] }),

  // Admin pipelines.
  // The admin page reads `candidates` to upsert, and `candidates_found` plus
  // `region_summary` for its toast — all three come back together.
  "discover-trending-videos": () =>
    ok({ success: true, candidates_found: 0, candidates: [], region_summary: {} }),
  "process-approved-video": () => ok({ processed: true }),
  "rate-video-cefr": () => ok({ cefr: "A2" }),
  "extract-concepts": () => ok({ concepts: [] }),
  "curriculum-chat": () => ok({ reply: "", proposals: [] }),
  // Drafting is queued rather than synchronous: the response carries the
  // message the admin toast shows, and the rules appear in the Draft tab
  // minutes later. `{ rules: [] }` named a field nothing reads.
  "draft-dialect-rules": () =>
    ok({
      queued: true,
      dialect: "Gulf",
      category: null,
      message: "Council is drafting rules in the background.",
    }),
  // The admin toast counts `inserted` out of `corpus_size`.
  "mine-dialect-corpus": () =>
    ok({ dialect: "Gulf", corpus_size: 0, proposed: 0, inserted: 0, drafts: [] }),
  // A rollup, not a list. The panel reads `totals.all` directly, so the old
  // `{ violations: [] }` threw on the first render rather than showing zero.
  "dialect-violations-digest": () =>
    ok({
      windowDays: 7,
      totals: { all: 0, byDialect: {} },
      topTokens: [],
      topFunctions: [],
      samples: [],
    }),
  // `inserted` is how many draft rules were written, and the metrics page reads
  // nothing else. The old `{ insight: "" }` made every teach-AI call report
  // "AI returned no proposals" regardless of what happened.
  "learn-from-metric": () => ok({ inserted: 1, rules: [] }),
  // The admin page reads `story.id` to navigate to the new story's editor and
  // throws when it is missing, so a null story made the happy path unreachable.
  "import-authentic-story": () =>
    ok({ story: { id: "bbbbbbbb-0000-4000-8000-000000000000", title: "A story" } }),
  "generate-story": () => ok({ story: null }),
  "generate-story-preview-audio": () => ok({ audioUrl: "https://cdn.test/preview.mp3" }),
  "generate-story-full-audio": () => ok({ audioUrl: "https://cdn.test/full.mp3" }),
  "generate-story-video": () => ok({ videoUrl: "https://cdn.test/story.mp4" }),
  "generate-story-video-full": () => ok({ videoUrl: "https://cdn.test/story-full.mp4" }),
  "edit-story-scene-image": () => ok({ imageUrl: "https://cdn.test/scene.png" }),
  "ai-resegment-transcript": () => ok({ segments: [] }),
  // Empty proposal: the editor treats "no lines" as a failed re-sync and shows
  // a toast rather than opening the diff, which is the honest default here.
  "resync-transcript-timing": () => ok({ lines: [], matched: 0, total: 0 }),
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
