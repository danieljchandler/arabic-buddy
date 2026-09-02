// Pure half of extract-learner-errors: the prompt one tutor turn is judged
// with, and the validation that turns the model's answer into rows worth
// keeping. No IO, no Deno — src/test/learnerErrorExtractionCore.test.ts runs
// it under Vitest.
//
// The rule that shapes everything here: record only what the tutor itself
// corrected. Six scoring functions already write learner_errors from a
// reference the learner was trying to match. Open conversation has no
// reference — the only evidence that something was wrong is the tutor saying
// so — and a second model guessing at errors in every turn would fill the
// mistake drill with its own opinions. So the model reports
// `corrected_by_assistant` per item and anything false is dropped, whatever
// else it says.

/**
 * The two sources this extractor writes. Members of learnerErrors.ts's
 * LearnerErrorSource, spelled out here rather than imported: that module reads
 * Deno.env at load and imports over https, and this one has to stay loadable
 * under Vitest (src/test/learnerErrorExtractionCore.test.ts). The edge function
 * hands these rows to recordLearnerErrors, which checks them structurally.
 */
export type ConversationSource = "conversation" | "voice";

export const CONVERSATION_SOURCES: ConversationSource[] = ["conversation", "voice"];

/**
 * error_kind values the mistake drill knows how to label (mistakes.ts
 * KIND_LABEL). Anything else the model invents is filed as "other" rather
 * than rejected — the target is the useful part.
 */
export const EXTRACTION_KINDS = [
  "wrong_word",
  "word_order",
  "msa_leak",
  "grammar",
  "omission",
  "insertion",
  "spelling",
  "other",
] as const;
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number];

/** One row for recordLearnerErrors — the same shape as its LearnerErrorInput. */
export interface ExtractedLearnerError {
  source: ConversationSource;
  dialect: string;
  targetArabic: string;
  producedArabic: string | null;
  errorKind: ExtractionKind;
  detail: Record<string, unknown>;
}

/** Hard ceiling per turn — a long message can't write a page of rows. */
export const MAX_ITEMS_PER_TURN = 5;
/** Inputs are clipped before they reach the prompt. */
export const MAX_INPUT_CHARS = 2000;

export interface ExtractionInput {
  dialectLabel: string;
  source: ConversationSource;
  /** What the learner wrote or (for voice) what ASR heard them say. */
  userText: string;
  /** The tutor's whole reply, correction line included if it had one. */
  assistantText: string;
  /** free-chat's [[CORRECTION]] line, when the client split one out. */
  correction?: string | null;
}

export interface RawExtractionItem {
  produced_arabic?: unknown;
  target_arabic?: unknown;
  error_kind?: unknown;
  corrected_by_assistant?: unknown;
  note?: unknown;
}

export interface RawExtraction {
  items?: unknown;
}

const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const DIACRITICS = /[ً-ْٰـ]/g;

/** Clip and tidy a free-text input before it goes into a prompt. */
export function clipInput(text: unknown): string {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;
}

/** Loose Arabic equality: diacritics and tatweel stripped, whitespace collapsed. */
function sameArabic(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(DIACRITICS, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The prompt for one turn. Kept as data so the edge function and the test
 * read the same words.
 */
export function buildExtractionPrompt(input: ExtractionInput): {
  systemPromptExtra: string;
  userPrompt: string;
  tool: { name: string; description: string; parameters: Record<string, unknown> };
} {
  const heard = input.source === "voice";
  const systemPromptExtra =
    `You read ONE turn of a ${input.dialectLabel} tutoring conversation and list the learner's ` +
    `Arabic errors — ONLY the ones the tutor actually corrected or clearly pointed out in this turn. ` +
    `Do not add errors of your own. If the tutor corrected nothing, return an empty list.` +
    (heard
      ? ` The learner's text is an automatic transcript of speech in a dialect the transcriber ` +
        `handles badly: treat spelling and word-boundary oddities as the transcriber's, never ` +
        `the learner's, and report only what the tutor itself reacted to.`
      : "") +
    ` Targets must be natural ${input.dialectLabel}, never Modern Standard Arabic. Reply via the tool ONLY.`;

  const userPrompt =
    `Learner${heard ? " (ASR transcript)" : ""}: "${clipInput(input.userText)}"\n\n` +
    `Tutor's reply: "${clipInput(input.assistantText)}"\n\n` +
    (input.correction ? `Tutor's explicit correction line: "${clipInput(input.correction)}"\n\n` : "") +
    `For each error the tutor corrected, give: produced_arabic (the learner's wrong form, Arabic ` +
    `script, or "" if they left something out), target_arabic (the correct ${input.dialectLabel} ` +
    `form, Arabic script), error_kind (one of ${EXTRACTION_KINDS.join(", ")}), ` +
    `corrected_by_assistant (true only if the tutor corrected or pointed out THIS error), ` +
    `note (≤ 15 English words). At most ${MAX_ITEMS_PER_TURN} items.`;

  return {
    systemPromptExtra,
    userPrompt,
    tool: {
      name: "record_learner_errors",
      description: "The learner errors the tutor corrected in this turn. Empty if none.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                produced_arabic: { type: "string" },
                target_arabic: { type: "string" },
                error_kind: { type: "string", enum: [...EXTRACTION_KINDS] },
                corrected_by_assistant: { type: "boolean" },
                note: { type: "string" },
              },
              required: ["target_arabic", "error_kind", "corrected_by_assistant"],
            },
          },
        },
        required: ["items"],
      },
    },
  };
}

export interface NormalizeOptions {
  source: ConversationSource;
  dialect: string;
  /** What the client said it heard the learner with; recorded for the voice lane. */
  asrProvider?: string | null;
  /** The correction line, kept in detail so the drill can show the tutor's words. */
  correction?: string | null;
}

/**
 * Turn the model's answer into rows the writer will accept.
 *
 * Drops, in order: anything that is not an object; anything the tutor did not
 * correct; targets with no Arabic in them; targets identical to what the
 * learner produced (nothing to fix); duplicates of an earlier target. Unknown
 * kinds become "other". Never throws — a malformed answer records nothing.
 */
export function normalizeExtraction(
  raw: unknown,
  options: NormalizeOptions,
): ExtractedLearnerError[] {
  const items = (raw as RawExtraction | null)?.items;
  if (!Array.isArray(items)) return [];

  const out: ExtractedLearnerError[] = [];
  const seen = new Set<string>();

  for (const candidate of items) {
    if (out.length >= MAX_ITEMS_PER_TURN) break;
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as RawExtractionItem;

    if (item.corrected_by_assistant !== true) continue;

    const target = typeof item.target_arabic === "string" ? item.target_arabic.trim() : "";
    if (!target || !ARABIC_LETTER.test(target)) continue;

    const produced = typeof item.produced_arabic === "string" ? item.produced_arabic.trim() : "";
    if (produced && sameArabic(produced, target)) continue;

    if (seen.has(target)) continue;
    seen.add(target);

    const kind = typeof item.error_kind === "string" &&
        (EXTRACTION_KINDS as readonly string[]).includes(item.error_kind)
      ? (item.error_kind as ExtractionKind)
      : "other";

    const detail: Record<string, unknown> = {};
    if (typeof item.note === "string" && item.note.trim()) detail.note = item.note.trim().slice(0, 200);
    if (options.correction) detail.correction = clipInput(options.correction).slice(0, 300);
    if (options.source === "voice") detail.asr_provider = options.asrProvider ?? "unknown";

    out.push({
      source: options.source,
      dialect: options.dialect,
      targetArabic: target,
      producedArabic: produced || null,
      errorKind: kind,
      detail,
    });
  }

  return out;
}
