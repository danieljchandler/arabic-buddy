/**
 * transcriptPieceTranslation — English for lines that have none.
 *
 * `_shared/transcriptLineSplit.ts` cuts an over-long line at the speaker's
 * pauses, and a translation described the whole line it was written for, so
 * the pieces arrive blank; and the analysis itself can leave a line blank when
 * every model in its ensemble failed it. The Re-sync timing button and the
 * pipeline's finalize stage both need the same answer to that: one call that
 * drafts natural and literal English for every line handed to it, best effort.
 * A model that is down or slow costs the lines their English, never the
 * caller's own work; the caller decides what to do with a line left blank.
 */
import { askBrain } from "./aiBrain.ts";
import { getLineup } from "./modelRegistry.ts";
import { normalizeDialect } from "./transcriptDiffCore.ts";
import { subvarietyPromptHint } from "./dialectSubvarieties.ts";
import type { Dialect } from "./dialectTypes.ts";

/** The subset of a line this needs: an id to key the answer on, and its Arabic. */
export interface PieceToTranslate {
  id?: string;
  arabic?: string;
  [key: string]: unknown;
}

/** The English drafted for one piece of a split line. */
export interface DraftedEnglish {
  translation: string;
  literal?: string;
}

/**
 * Draft the English for the pieces a split produced.
 *
 * A translation described the whole line it was written for and cannot be
 * divided among the pieces, so they arrive blank. Handing a reviewer twenty
 * blanks after they pressed a timing button is not a fix, so the pieces are
 * translated here in one call — best effort: a model that is down or slow
 * costs the pieces their English, never the re-sync. Only the pieces are
 * sent; a line the reviewer wrote keeps the translation they gave it.
 */
export async function draftEnglishForPieces(
  pieces: PieceToTranslate[],
  video: { dialect?: unknown; dialect_subvariety?: unknown },
): Promise<Map<string, DraftedEnglish>> {
  const drafted = new Map<string, DraftedEnglish>();
  if (pieces.length === 0) return drafted;

  // `discover_videos.dialect` carries city-level labels the brain's rulebook
  // has no prompts for; normalizeDialect collapses them onto the three it does.
  const dialect: Dialect = normalizeDialect(video.dialect) ?? "Gulf";
  const variety = subvarietyPromptHint(video.dialect, video.dialect_subvariety);
  const numbered = pieces.map((p, i) => `${i + 1}. ${String(p.arabic ?? "")}`).join("\n");

  try {
    const brain = await askBrain<{ lines?: Array<{ index?: number; translation?: string; literal?: string }> }>({
      purpose: "transcript_resync_piece_translation",
      dialect,
      strategy: "solo",
      models: [...getLineup("TRANSLATION").drafters],
      // The output is English; the MSA repair pass has nothing to repair.
      skipRepair: true,
      maxTokens: Math.min(4_000, 200 + 90 * pieces.length),
      temperature: 0.2,
      // The whole call has to fit inside the browser's wait for this
      // function alongside the forced alignment that already ran.
      budgetMs: 45_000,
      callTimeoutMs: 40_000,
      userPrompt:
        `These are lines of a spoken ${dialect} Arabic transcript, in the order they were ` +
        `said. Each is a clause or a short sentence, and the ones next to it are its ` +
        `context.\n\n` +
        (variety ? `The reviewer has identified this clip as: ${variety}\n\n` : "") +
        `For every numbered line give a natural, plain English translation for a learner ` +
        `and a word-for-word literal gloss that keeps the Arabic word order. Translate ` +
        `each line on its own; do not merge or renumber them.\n\n${numbered}`,
      tool: {
        name: "emit_line_translations",
        description: "Natural and literal English for each numbered line.",
        parameters: {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "The line's number, starting at 1." },
                  translation: { type: "string", description: "Natural English." },
                  literal: { type: "string", description: "Word-for-word gloss." },
                },
                required: ["index", "translation"],
              },
            },
          },
          required: ["lines"],
        },
      },
    });
    for (const entry of brain.output?.lines ?? []) {
      const index = Number(entry?.index);
      const piece = Number.isInteger(index) ? pieces[index - 1] : undefined;
      const translation = String(entry?.translation ?? "").trim();
      if (!piece?.id || !translation) continue;
      const literal = String(entry?.literal ?? "").trim();
      drafted.set(piece.id, { translation, ...(literal ? { literal } : {}) });
    }
  } catch (e) {
    console.warn("[resync] drafting English for split lines failed (pieces left for review):",
      e instanceof Error ? e.message : String(e));
  }
  return drafted;
}
