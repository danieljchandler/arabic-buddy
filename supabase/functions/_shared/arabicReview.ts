// =============================================================================
// NATIVE ARABIC REVIEW — the impure half: who is asked, and under what budget.
// =============================================================================
//
// `arabicReviewCore.ts` says what is worth asking about and what an answer
// means. This module asks, through the one seam the Arabic-native roster is
// reached by (`judgeWithArabicNative`), and is written so that every way it can
// fail produces the same outcome: no note. The learner has already read the
// answer; a review that errors, times out, is refused on content grounds, or
// finds nothing must be indistinguishable from a review that never ran.
//
// Why this slot and not the chat model itself: M3 and Jais 2 are Arabic-native
// but neither can serve the chat stream — M3's preview tier has streaming off
// and adds latency, Jais 2 scales to zero, and `canFallBack` is false for both,
// so either one as `DEFAULT_CHAT` would put a learner-facing request on a
// single unbacked route. Here they are additive by construction: one short,
// non-streaming classification call, off the critical path, behind a hard
// timeout, on text that has already shipped.

import { getDialectLabel, type Dialect } from './dialectHelpers.ts';
import { judgeWithArabicNative } from './dialectValidator.ts';
import {
  buildReviewSystemPrompt,
  containsArabic,
  isParseableReview,
  parseNativeReview,
  renderReviewTargets,
  selectReviewTargets,
  type NativeReviewFrame,
} from './arabicReviewCore.ts';

/**
 * The whole walk's ceiling, not one rung's.
 *
 * The stream stays open until this resolves, so it is a promise to the client
 * as much as a budget: however slow the roster is, the connection closes within
 * this of the last token. Deliberately short — a note that lands after the
 * learner has typed their next question is not worth waiting for.
 */
const REVIEW_TIMEOUT_MS = 8_000;

/** Tokens for four short lines of JSON. Truncation here costs a note, not an answer. */
const REVIEW_MAX_TOKENS = 512;

/** `CHAT_NATIVE_REVIEW=off` switches it off without a deploy, as `JAIS_PIPELINE_WARMUP` does for the warm-up. */
function enabled(): boolean {
  return Deno.env.get('CHAT_NATIVE_REVIEW')?.trim().toLowerCase() !== 'off';
}

export interface ReviewRequest {
  /** The assistant's finished reply. */
  text: string;
  dialect: Dialect;
  /**
   * Arabic that is not the tutor's to be judged for — the page context, the
   * seed sentence, the learner's own words. See `selectReviewTargets`.
   */
  sources?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Judge the Arabic in a finished reply, or return null.
 *
 * Null is the answer for every uninteresting case — the feature is off, there
 * is no Arabic, every run was quoted from the page, no Arabic-native model is
 * configured, the roster failed, the reply was unreadable, or the judge found
 * nothing wrong. The caller does not distinguish between them; the log does.
 */
export async function reviewArabicNatively(req: ReviewRequest): Promise<NativeReviewFrame | null> {
  if (!enabled()) return null;
  if (!req.text || !containsArabic(req.text)) return null;

  const targets = selectReviewTargets(req.text, { sources: req.sources });
  if (targets.length === 0) return null;

  // One deadline over the whole walk. `judgeWithArabicNative` bounds each rung,
  // which is not the same promise: three rungs that each answer just inside
  // their own ceiling would hold the stream open for three times as long.
  const deadline = new AbortController();
  const abortOnSignal = () => deadline.abort();
  req.signal?.addEventListener('abort', abortOnSignal, { once: true });
  const timer = setTimeout(() => deadline.abort(), req.timeoutMs ?? REVIEW_TIMEOUT_MS);

  try {
    const judgement = await judgeWithArabicNative(
      buildReviewSystemPrompt(getDialectLabel(req.dialect)),
      renderReviewTargets(targets),
      {
        maxTokens: REVIEW_MAX_TOKENS,
        temperature: 0,
        // Each rung gets the whole budget as its own ceiling. The deadline
        // above is what actually stops the walk; this is so a rung that runs
        // long reports a timeout of its own rather than an abort it did not
        // cause, which is the difference between a readable log line and a
        // confusing one.
        timeoutMs: req.timeoutMs ?? REVIEW_TIMEOUT_MS,
        signal: deadline.signal,
        label: 'chat:native-review',
        // A reply this caller cannot read is a failed rung, not an answer —
        // the rung behind may format correctly. An empty array *is* an answer
        // ("nothing wrong"), which is why this tests parseability rather than
        // findings.
        accept: isParseableReview,
        // No cold wait and no warm-up: this runs while a learner is reading.
        // A self-hosted rung found asleep is skipped, and the walk moves on.
        coldWaitMs: 0,
      },
    );

    if (!judgement.usable || !judgement.content || !judgement.model) {
      if (judgement.attempts.length > 0) {
        console.warn(
          '[arabicReview] no usable judgement:',
          judgement.attempts.map((a) => `${a.model}: ${a.error}`).join('; '),
        );
      }
      return null;
    }

    const corrections = parseNativeReview(judgement.content, targets);
    if (corrections.length === 0) return null;

    return { type: 'native_review', model: judgement.model, corrections };
  } catch (err) {
    // Includes the deadline firing. Never rethrown: the caller is a stream's
    // flush, and a throw there would truncate a reply the learner has read.
    console.warn('[arabicReview] review failed:', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', abortOnSignal);
  }
}
