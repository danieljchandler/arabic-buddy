// =============================================================================
// Shared ASR configuration — Soniox model pin + dialect-aware context biasing.
// Used by both the standalone soniox-transcribe function and the inline copy
// in process-approved-video so the two stay in sync.
// =============================================================================

// stt-async-v4 was retired 2026-06-30; requests were already being silently
// rerouted to v5. Pin v5 explicitly so we get its documented request/response
// contract (context biasing, diarization, per-token language) on purpose.
export const SONIOX_MODEL = "stt-async-v5";

/** Word-level timing, in seconds. Shared shape across every ASR engine. */
export interface AsrWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/**
 * What one ASR leg of the parallel fan-out returns. Every leg resolves rather
 * than rejects — a failed engine reports `error` and the pipeline continues on
 * the others. Engine-specific extras are optional so all legs share one type.
 */
export interface AsrLegResult {
  text: string | null;
  words?: AsrWord[];
  latencyMs?: number;
  error?: string;
  /** Soniox: whether the leg actually produced a usable transcription. */
  sonioxUsed?: boolean;
  /** Soniox: free AR→EN baseline translation. */
  translationText?: string | null;
  /** Soniox: mean per-token confidence over the transcript. */
  avgConfidence?: number | null;
  /** Azure: the locale the request was routed to. */
  locale?: string;
}

export type DialectModule = "Gulf" | "Egyptian" | "Yemeni";

// Characteristic dialect function words / markers. Fed to Soniox `context.terms`
// to bias recognition toward dialectal spellings instead of MSA normalization.
export const DIALECT_ASR_TERMS: Record<DialectModule, string[]> = {
  Gulf: [
    "شلونك", "وين", "هالحين", "يالله", "ليش", "واجد", "يبي", "يبغى",
    "شنو", "وش", "چذي", "شفيك", "زين", "خوش", "عيل", "توني", "مب", "شسمه",
  ],
  Egyptian: [
    "إزيك", "إزاي", "فين", "دلوقتي", "عايز", "عايزة", "كويس", "ماشي",
    "يلا", "النهارده", "بتاع", "خالص", "أوي", "كده", "ليه", "معلش", "خلاص",
  ],
  Yemeni: [
    "كيفك", "وين", "ذحين", "بغيت", "زين", "قات", "مفرج", "بيش",
    "كيفش", "ذي", "ذا", "عاد", "قدك", "شوية", "طيب",
  ],
};

/**
 * Build the Soniox v5 `context` object for a transcription request.
 * Gulf/Egyptian/Yemeni social video is heavily code-switched with English,
 * so callers should pair this with language_hints ["ar", "en"].
 */
export function buildSonioxContext(
  dialect: DialectModule,
  title?: string | null,
): Record<string, unknown> {
  return {
    general: [
      { key: "domain", value: "Arabic language learning — social media video" },
      { key: "dialect", value: `${dialect} Arabic (colloquial, not MSA)` },
      ...(title ? [{ key: "video_title", value: String(title).slice(0, 200) }] : []),
    ],
    text:
      `Colloquial ${dialect} Arabic speech from a short social-media video. ` +
      `Speakers may code-switch between ${dialect} Arabic and English. ` +
      `Transcribe dialectal words as pronounced — do not normalize toward Modern Standard Arabic.`,
    terms: DIALECT_ASR_TERMS[dialect],
  };
}
