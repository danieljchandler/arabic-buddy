// Native-speaker authenticity validator.
//
// After the brain produces dialect Arabic, this runs a single strong-model
// "native speaker reviewer" pass that scores authenticity 1-5 against the
// approved rulebook context already baked into the system prompt.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  type Dialect,
} from './dialectHelpers.ts';
import { chatFetch, providerForModel, tryChatRoute, warmRoute } from './aiGateway.ts';
import {
  ARABIC_STANDING_LEG_ORDER,
  ARABIC_OCCASIONAL_ORDER,
  MODEL_IDS,
} from './modelRegistry.ts';

const VALIDATOR_MODEL = MODEL_IDS.GEMINI_PRO;

/**
 * The Arabic-native half of the cross-check: the best Arabic judge that is
 * actually configured.
 *
 * This was a constant pinned to Mistral Saba, and the pin was the problem.
 * Saba is a February 2025 24B — the oldest and weakest Arabic model in the
 * registry — and it held the one validator slot that runs on *every* call,
 * while HUMAIN M3, which outscores Opus 5 on Arabic benchmarks, sat two rungs
 * down a tie-break ladder that only fires when Saba and the generalist judge
 * happen to disagree. The strongest instrument was gated behind the weakest
 * one's opinion.
 *
 * Resolved per call rather than at module load because routability is
 * deployment state — a key added or a preview tier revoked changes the answer
 * without a deploy — and because `tryChatRoute` answers from the environment
 * without making a request, so asking every time costs nothing.
 *
 * Falls back down `ARABIC_STANDING_LEG_ORDER` rather than to nothing: a
 * cross-check that loses its Arabic side is just the generalist judge alone,
 * which is the exact failure this two-model shape exists to prevent.
 */
function arabicStandingLeg(): string {
  for (const model of ARABIC_STANDING_LEG_ORDER) {
    if (tryChatRoute(model)) return model;
  }
  // Nothing configured. Returned rather than thrown so `validateDialect` can
  // report the usual unconfigured-provider `unknown`, and the cross-check
  // degrades to the strong leg alone exactly as it does when a provider is
  // down — an optional gate stays optional.
  return ARABIC_STANDING_LEG_ORDER[ARABIC_STANDING_LEG_ORDER.length - 1];
}

// Who may settle a split is `ARABIC_OCCASIONAL_ORDER` in the registry, alongside
// the standing-leg order above, because the two lists only make sense read
// together — the tie-break is affordable precisely where the standing leg is
// not. Fanar is the clearest case and the reason the split exists at all: it is
// a better Arabic judge than Saba, but its endpoints run on small daily
// allowances (the STT paths in `fanar-transcribe` are metered at 18 and 8 calls
// a day), so an always-on Fanar leg would spend the allowance before lunch and
// then degrade to `ok: false` for the rest of the day — a quality gate that
// switches off exactly when the app is busiest. A disagreement is a minority of
// calls, which is what keeps it inside the allowance down here.

/**
 * How long a single tie-break rung may take, and how long the whole ladder may.
 *
 * The tie-break is the one call in this file with no budget of its own: it runs
 * *after* the two standing legs, sequentially, on a path a learner is waiting
 * on. Before these ceilings it inherited `opts.timeoutMs` — the same budget the
 * parallel legs got — and so could double the validator's cost, and inherited
 * nothing at all from `askBrain`'s review path, which passes no options and
 * therefore left the call unbounded.
 *
 * `COLD_BAIL` is the ceiling for a rung we host ourselves, and it is short on
 * purpose. A cold Jais does not answer in five seconds and is not meant to:
 * bailing is the correct outcome, because the next rung down can still settle
 * the split, and the property this slot was chosen for is that a cold
 * tie-breaker costs the learner nothing.
 */
/**
 * The ceiling a validator call falls back on when its caller named none. Not a
 * budget so much as a backstop against an unbounded request; callers that care
 * about latency pass their own and get something far tighter.
 */
const VALIDATOR_DEFAULT_TIMEOUT_MS = 30_000;

const TIEBREAK_COLD_BAIL_MS = 5_000;
/**
 * The whole ladder's wall clock.
 *
 * 12s while the ladder was two rungs: a 5s cold bail on Jais left 7s for
 * Fanar. A third rung does not fit in that — M3's 7s plus Jais's 5s is the
 * entire budget, and Fanar, the rung that settled every split before either of
 * the others existed, would never be asked in exactly the slow-preview case
 * the ceilings were added for. Raised so all three intended ceilings fit
 * alongside `TIEBREAK_TAIL_RESERVE_MS`.
 *
 * The cost is the worst case, not the common one: every rung has to be slow or
 * cold to spend this, and any rung answering ends it. A caller's own
 * `timeoutMs` still wins, since the deadline is the smaller of the two.
 */
const TIEBREAK_BUDGET_MS = 16_000;
/**
 * What a rung must leave for the rungs behind it.
 *
 * Per-rung ceilings bound each call; nothing bounded their *sum*, so early
 * rungs could eat the budget and the loop would break on `TIEBREAK_MIN_MS`
 * before reaching the last one. That is worse than not adding a rung at all:
 * the ladder is ordered best-first, but the rungs at the bottom are the
 * *proven* ones, and starving them trades a settled split for an unsettled
 * one.
 *
 * 4s is a slice a warm hosted API can actually answer a single-snippet
 * judgment in — the point is a usable remainder, not a token one, which is why
 * this is not simply `TIEBREAK_MIN_MS`.
 */
const TIEBREAK_TAIL_RESERVE_MS = 4_000;
/**
 * The ceiling for a rung that is hosted but whose latency nobody here has
 * measured — HUMAIN M3, whose limited-preview tier documents *added latency* as
 * one of its terms.
 *
 * It exists because "first on the ladder" and "may take a while" is the one
 * combination the budget cannot absorb. The rungs share
 * `TIEBREAK_BUDGET_MS`, so a first rung given the whole of it can spend the
 * whole of it and leave nothing for the two proven ones behind it — turning a
 * quality upgrade into a quality *regression* on exactly the splits the ladder
 * exists to settle. Bounding the unmeasured rung keeps its cost to one slice
 * and keeps Jais and Fanar reachable.
 *
 * Larger than the cold bail because the failure being guarded against is
 * different: a cold worker is not going to answer in five seconds and bailing
 * is the correct outcome, whereas a slow hosted endpoint plausibly is going to
 * answer, just not quickly. Raise it once M3's real latency on this
 * single-snippet call is known.
 */
const TIEBREAK_PREVIEW_BAIL_MS = 7_000;
/**
 * The ceiling on the *standing* Arabic leg when it is the preview endpoint.
 *
 * Promoting M3 out of the tie-break moved it from a slot that fires on a
 * minority of calls to one that fires on all of them, and its preview tier
 * lists added latency among its terms. Nothing else bounded that: the standing
 * legs take the caller's `timeoutMs`, and the common caller — `askBrain`'s
 * review path — passes none, so a hanging M3 would spend
 * `VALIDATOR_DEFAULT_TIMEOUT_MS` on every generation in the app.
 *
 * Losing the leg is cheap and losing the call is not: a timed-out Arabic leg
 * reports `ok: false` and the cross-check degrades to the strong judge alone,
 * which is the documented behaviour for any unavailable provider. So this is
 * set where a hosted model that is *working* will comfortably answer a
 * single-snippet judgment, and a hosted model that is struggling gets out of
 * the way — generous next to the tie-break's 7s bail, because that rung has
 * others waiting behind it and this one does not.
 *
 * Only the preview provider is clamped. Saba, the fallback occupant, is an
 * ordinary OpenRouter model with no latency caveat, and narrowing its budget
 * would be an unrelated behaviour change smuggled in under this one.
 */
const STANDING_LEG_PREVIEW_BAIL_MS = 12_000;
/** Below this there is no point asking anyone; the rule is the cheaper answer. */
const TIEBREAK_MIN_MS = 1_000;

/**
 * The Arabic-native specialists that can settle a split, best first, minus
 * whichever one is already serving as the standing leg.
 *
 * `ARABIC_OCCASIONAL_ORDER` still lists HUMAIN M3 first, but in the common
 * deployment it is filtered straight out: a configured M3 takes the standing
 * Arabic seat, so by the time a split exists it has already voted and the
 * ladder starts at Jais. M3 stays in the list for the case where it is
 * routable but something above chose otherwise, and because a rung that is
 * sometimes skipped is cheaper to keep than to rediscover. Its per-rung
 * ceiling (`TIEBREAK_PREVIEW_BAIL_MS`) still applies when it is reached: it is
 * hosted, so it cannot be asleep, but its preview tier lists added latency
 * among its terms, and first *and* unbounded is the combination that would let
 * it starve the rungs behind it.
 *
 * Jais 2 is the usual head of the ladder, when its endpoint is deployed. Its
 * claim on the slot is economic, not qualitative, and the distinction matters:
 * this is the **8B**, which scores 57.89 on QIMMA against the 70B's 65.81 and
 * is the weakest Arabic judge in the registry. What it has is no daily
 * allowance to spend — it runs on hardware this project rents — so it can be
 * asked on every split where Fanar cannot. It is a cheap opinion tried before
 * an expensive one, not a better one.
 *
 * Deliberately the 8B all the same. Upstream's 70B scores better, but its
 * weights are 144GB, so a cold start is a multi-minute download and the model
 * is only economic amortised over batch work — which is why it is not carried
 * in the registry at all. The 8B is 16GB on a single GPU and can actually
 * answer inside a caller's timeout. Size is chosen by job; see `MODEL_IDS` for
 * the full cost argument.
 *
 * This is a **ladder, not a choice**, and that is the correction to how the
 * slot was first wired. Jais either being deployed or not was read as Jais
 * *or* Fanar, which quietly made a deployed-but-cold Jais worse than no Jais:
 * the endpoint scales to zero, so a cold worker consumed the split and Fanar —
 * warm, hosted, and the model that settled every split before Jais existed —
 * was never asked. Falling through restores that, and costs Fanar's allowance
 * strictly *less* than it spent before Jais arrived, because only the splits
 * where Jais was cold reach it now.
 *
 * Returns empty when neither is configured; the caller then keeps the rule.
 */
function tiebreakValidatorModels(standingLeg: string): string[] {
  return ARABIC_OCCASIONAL_ORDER.filter((model) =>
    // Never re-ask the model that already voted. Once M3 is the standing leg it
    // has judged this exact text as one of the two legs that split, so putting
    // it at the head of the ladder would spend the first and largest slice of
    // the tie-break budget re-reading its own verdict — and then hand the split
    // to the opinion that helped cause it. Skipping it promotes the rungs
    // behind it, which is the point: the tie-breaker has to be a *third* voice.
    model !== standingLeg && tryChatRoute(model)
  );
}

/**
 * A rung's own ceiling, for either consumer that walks the Arabic roster.
 *
 * A worker we host can be asleep, and the whole point of asking it first is
 * that finding out is cheap; a hosted API is either up or it is not, so it gets
 * whatever budget is left. The preview ceiling is what keeps a slow M3 to one
 * slice rather than the run of the caller's budget — which matters most in
 * `judgeWithArabicNative`, where M3 *is* the first rung, the tie-break having
 * filtered it out as the standing leg.
 */
function arabicRungCeilingMs(model: string): number {
  const provider = providerForModel(model);
  if (provider === 'runpod') return TIEBREAK_COLD_BAIL_MS;
  if (provider === 'humain') return TIEBREAK_PREVIEW_BAIL_MS;
  return TIEBREAK_BUDGET_MS;
}

/**
 * Wake the self-hosted tie-breaker after a split found it cold, so the *next*
 * split lands on a live worker.
 *
 * Off unless `JAIS_TIEBREAK_WARMUP=on`, and that default is a cost decision
 * rather than caution. The endpoint holds at most one worker, so the ceiling on
 * what warming can cost is one worker running continuously — about $500 a
 * month, which is exactly the `workersMin: 1` bill this deployment exists to
 * avoid. Between "never warm" and that ceiling there is no setting this module
 * can pick on its own: it depends on how clustered splits actually are and on
 * how long a warm-cache boot takes, neither of which is measured yet. So the
 * mechanism ships, wired and tested, and turning it on stays a deliberate act.
 *
 * The cooldown is what makes it bounded at all: one wake per idle window, so a
 * burst of cold splits cannot start a boot each. Module-level state, so it
 * resets when the isolate does — which is the right granularity, since a fresh
 * isolate has no idea what the last one warmed.
 */
const WARMUP_COOLDOWN_MS = 5 * 60_000;
let lastWarmupAt = 0;

function warmTiebreaker(model: string): void {
  if (Deno.env.get('JAIS_TIEBREAK_WARMUP')?.trim() !== 'on') return;
  const now = Date.now();
  if (now - lastWarmupAt < WARMUP_COOLDOWN_MS) return;
  lastWarmupAt = now;
  console.log(`[dialectValidator] tie-breaker ${model} was cold; warming for the next split`);
  warmRoute(model);
}

export interface ValidatorLeak {
  token: string;
  suggestion?: string;
  rule_id?: string;
  reason?: string;
}

export interface ValidatorResult {
  score: number;           // 1-5; 5 = fully authentic native, 1 = clearly MSA / wrong dialect
  verdict: 'pass' | 'rewrite' | 'unknown';
  leaks: ValidatorLeak[];
  notes?: string;
  latencyMs: number;
  ok: boolean;             // false if the validator itself errored — caller should ignore result
  /** Which model produced this judgment. */
  model?: string;
  /** Present on cross-checked results: how the two validators related. */
  agreement?: 'agree' | 'disagree' | 'single';
}

export interface ValidateOptions {
  passThreshold?: number; // default 4
  maxChars?: number;      // truncate text for cost control; default 4000
  signal?: AbortSignal;
  /**
   * Per-call ceiling. Preferred over `signal` for the cross-checked path: one
   * shared AbortSignal across two concurrent calls means a slow leg eats the
   * other leg's clock, so each call mints its own timer from this instead.
   * Combined with `signal` when both are given, rather than overridden by it —
   * the tie-break clamps this down to its own ceiling, and a caller's signal
   * must not be able to lift that clamp back off.
   */
  timeoutMs?: number;
  /** Override the judging model. Defaults to the registry's Pro-tier judge. */
  model?: string;
}

/**
 * The signal one call is made under: the caller's cancellation and this call's
 * own ceiling, whichever fires first. Both matter — the ceiling bounds a slow
 * provider, and the caller's signal is how an abandoned request stops paying
 * for work nobody will read.
 */
function callSignal(opts: ValidateOptions): AbortSignal | undefined {
  // Never unbounded. `chatFetch` applies no timeout of its own — the 90s in
  // `aiGateway` belongs to `generateImage` — so a validator call that passes
  // neither a signal nor a ceiling used to hang for as long as the provider
  // would hold the socket. `askBrain`'s review path passes exactly that.
  const timer = AbortSignal.timeout(opts.timeoutMs ?? VALIDATOR_DEFAULT_TIMEOUT_MS);
  if (opts.signal && timer) return AbortSignal.any([opts.signal, timer]);
  return opts.signal ?? timer;
}

export async function validateDialect(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions = {},
): Promise<ValidatorResult> {
  const start = Date.now();
  const model = opts.model ?? VALIDATOR_MODEL;
  // The validator is an optional quality pass, so an unconfigured provider is a
  // silent "unknown" rather than an error — same as an empty candidate text.
  // `tryChatRoute` answers that without making a request.
  if (!tryChatRoute(model) || !text || !text.trim()) {
    return { score: 0, verdict: 'unknown', leaks: [], latencyMs: 0, ok: false, model };
  }

  const passThreshold = opts.passThreshold ?? 4;
  const snippet = text.slice(0, opts.maxChars ?? 4000);

  const system = `${getDialectIdentity(dialect)}

${getDialectVocabRules(dialect)}

You are acting as a STRICT NATIVE-SPEAKER REVIEWER for ${getDialectLabel(dialect)}.
Your only job: judge whether the candidate text sounds like an authentic native ${dialect} speaker.
- Score 5: indistinguishable from a native — vocabulary, syntax, particles all authentic.
- Score 4: mostly authentic; minor stylistic awkwardness.
- Score 3: noticeable MSA influence OR borrowing from another dialect; would feel "off" to a native.
- Score 2: clearly MSA / wrong dialect in multiple places.
- Score 1: pure MSA or completely wrong dialect.
Be harsh. When in doubt between 4 and 3, choose 3.`;

  const tool = {
    name: 'emit_authenticity_score',
    description: 'Return a strict native-speaker authenticity judgment.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 1, maximum: 5 },
        verdict: { type: 'string', enum: ['pass', 'rewrite'] },
        leaks: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              token: { type: 'string', description: 'The offending word or short phrase as it appears in the text.' },
              suggestion: { type: 'string', description: 'Authentic dialectal replacement.' },
              reason: { type: 'string', description: 'Short reason this is wrong for this dialect.' },
            },
            required: ['token'],
          },
        },
        notes: { type: 'string' },
      },
      required: ['score', 'verdict', 'leaks'],
    },
  };

  try {
    const res = await chatFetch(model, {
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Candidate text in ${dialect} Arabic to judge:\n\n${snippet}` },
      ],
      tools: [{ type: 'function', function: tool }],
      tool_choice: { type: 'function', function: { name: tool.name } },
    }, {
      signal: callSignal(opts),
      label: 'dialectValidator',
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.warn('[dialectValidator] provider error', model, res.status, msg.slice(0, 200));
      return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    }
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    let parsed: { score?: number; verdict?: string; leaks?: ValidatorLeak[]; notes?: string };
    try { parsed = JSON.parse(args); } catch {
      return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    }
    const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 5)));
    const verdict: 'pass' | 'rewrite' =
      parsed.verdict === 'rewrite' || score < passThreshold ? 'rewrite' : 'pass';
    const leaks = Array.isArray(parsed.leaks) ? parsed.leaks.filter((l) => l && typeof l.token === 'string') : [];
    return {
      score,
      verdict,
      leaks,
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      latencyMs: Date.now() - start,
      ok: true,
      model,
    };
  } catch (err) {
    console.warn('[dialectValidator] failed', model, err);
    return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
  }
}

/**
 * Walk the tie-break ladder until somebody actually judges the text.
 *
 * Three properties this has to keep, in order of how badly they broke before:
 *
 * 1. **Bounded.** The whole phase is capped at `TIEBREAK_BUDGET_MS`, clamped
 *    further by whatever the caller had left. Nothing here can inherit a
 *    caller's full budget a second time, and the path that passes no options at
 *    all gets a ceiling rather than an open-ended request.
 * 2. **No worse than no tie-breaker.** A rung that does not answer — cold,
 *    down, out of quota, or `unknown`, which is what this returns when it could
 *    not judge — is not a casting vote. Exhaust the ladder and the caller keeps
 *    the harsher-verdict rule, which is exactly the behaviour it had before any
 *    tie-breaker existed.
 * 3. **A cold first rung does not consume the split.** Falling through to the
 *    hosted specialist is the difference between "Jais is deployed, so Fanar
 *    never runs" and "Jais answers when it is up, Fanar when it is not".
 */
interface SettledSplit {
  /** The judgment that settled it, or null when nobody on the ladder could. */
  result: ValidatorResult | null;
  /** Which rung settled it — for the log and the reported `model`. */
  model: string | null;
  /**
   * Wall clock for the whole phase, including rungs that did not answer.
   * Reported rather than the winning rung's own `latencyMs`, because what the
   * caller's budget actually paid for is every rung that was tried — the cost
   * of a cold first rung is precisely the number this exists to make visible.
   */
  elapsedMs: number;
}

async function settleSplit(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions,
  standingLeg: string,
): Promise<SettledSplit | null> {
  const ladder = tiebreakValidatorModels(standingLeg);
  if (!ladder.length) return null;

  const start = Date.now();
  const deadline = start +
    Math.min(TIEBREAK_BUDGET_MS, opts.timeoutMs ?? TIEBREAK_BUDGET_MS);

  for (const [index, model] of ladder.entries()) {
    // A caller that gave up wants no more calls made on its behalf, and the
    // ladder is the one place here that would otherwise keep spending after
    // the answer stopped being wanted.
    if (opts.signal?.aborted) break;
    const remaining = deadline - Date.now();
    if (remaining < TIEBREAK_MIN_MS) break;
    // What this rung may spend, after setting aside a usable slice for each
    // rung behind it. Without the reserve the per-rung ceilings bound every
    // call and nothing bounds their sum, so a slow first rung and a cold
    // second one can exhaust the budget between them and the proven last rung
    // is never reached. The floor keeps a squeezed rung a real attempt rather
    // than a zero-length one.
    const reserved = (ladder.length - index - 1) * TIEBREAK_TAIL_RESERVE_MS;
    const share = Math.max(TIEBREAK_MIN_MS, remaining - reserved);
    const result = await validateDialect(text, dialect, {
      ...opts,
      model,
      timeoutMs: Math.min(share, arabicRungCeilingMs(model)),
    });
    if (result.ok && result.verdict !== 'unknown') {
      return { result, model, elapsedMs: Date.now() - start };
    }
    // It did not answer — but *why* decides whether that is worth acting on,
    // and `validateDialect` reports a cancellation and a cold worker the same
    // way, as `ok: false`. Only this call's own ceiling means "asleep". A
    // caller's abort means the opposite, and treating it as cold would start a
    // fresh request with a five-minute lifetime for a validation nobody is
    // waiting for any more — spending exactly the capacity the cancellation
    // was trying to stop.
    if (opts.signal?.aborted) break;
    if (providerForModel(model) === 'runpod') warmTiebreaker(model);
  }
  return { result: null, model: null, elapsedMs: Date.now() - start };
}

/**
 * Two-model dialect judgment: both models read the text, the harsher verdict wins.
 *
 * The two run CONCURRENTLY and both always run. An earlier version asked the
 * cheap Arabic-native validator (Mistral Saba) first and returned its answer
 * without paying for the strong generalist (the Pro-tier judge) whenever Saba said
 * `pass` at 5/5. That is the one shortcut this gate cannot afford: Saba is a
 * general Arabic model, so on Yemeni it reads fusha-inflected prose as fine and
 * scores it 5, and the strict reviewer that would have caught it never ran.
 * "Fusha grammar with dialect words sprinkled in" is exactly the failure this
 * validator exists to catch, and it was being waved through.
 *
 * Running them in parallel also costs less wall clock than the old sequential
 * escalation (max, not sum), which matters because the caller skips the rewrite
 * pass entirely once its latency budget is spent — the previous shape could
 * spend the budget *and* return the lenient verdict. For the same reason each
 * call now gets its own timeout: they shared one AbortSignal, so a slow Saba
 * left the strong validator with a few seconds and it aborted into `unknown`,
 * silently degrading the cross-check to Saba alone.
 *
 * Which model takes the Arabic seat is no longer a constant — see
 * `arabicStandingLeg`. Saba holds it only when nothing better is configured,
 * so the failure described above is now the fallback's weakness rather than
 * the design's: with a HUMAIN key present this leg is M3, and the shortcut
 * stays closed either way because both legs still always run.
 *
 * Set DIALECT_VALIDATOR_CROSSCHECK=off to fall back to Gemini Pro alone.
 */
export async function validateDialectCrossChecked(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions = {},
): Promise<ValidatorResult> {
  if (Deno.env.get('DIALECT_VALIDATOR_CROSSCHECK')?.trim() === 'off') {
    return validateDialect(text, dialect, opts);
  }

  // Resolved once and threaded through: the ladder has to skip whichever model
  // took this seat, and the log and `model` field have to name the model that
  // actually answered rather than a constant that may not have been asked.
  const arabicModel = arabicStandingLeg();
  // The strong leg keeps the caller's budget; the Arabic one is clamped when it
  // is the preview endpoint. See STANDING_LEG_PREVIEW_BAIL_MS — this seat now
  // fires on every call, so an unbounded slow occupant is charged to every
  // generation rather than to a minority of splits.
  const arabicTimeoutMs = providerForModel(arabicModel) === 'humain'
    ? Math.min(opts.timeoutMs ?? VALIDATOR_DEFAULT_TIMEOUT_MS, STANDING_LEG_PREVIEW_BAIL_MS)
    : opts.timeoutMs;

  const [arabic, strong] = await Promise.all([
    validateDialect(text, dialect, { ...opts, model: arabicModel, timeoutMs: arabicTimeoutMs }),
    validateDialect(text, dialect, { ...opts, model: VALIDATOR_MODEL }),
  ]);

  // If either side failed, trust whichever one worked.
  if (!strong.ok) return arabic.ok ? { ...arabic, agreement: 'single' } : strong;
  if (!arabic.ok) return { ...strong, agreement: 'single' };

  const agreement = arabic.verdict === strong.verdict ? 'agree' : 'disagree';

  // On a split, ask an Arabic-native specialist rather than settling it with a
  // rule. Skipped silently when none is configured, and never reached when the
  // two agree — see `tiebreakValidatorModels` for who is asked and in what order.
  const settled = agreement === 'disagree'
    ? await settleSplit(text, dialect, opts, arabicModel)
    : null;
  const tiebreak = settled?.result ?? null;
  const tiebreakModel = settled?.model ?? null;

  // Harsher verdict wins: a rewrite call from either model stands, and the
  // reported score is the lower of the two. The tie-breaker, when there is one,
  // replaces that default — it is an opinion where the rule was only a policy.
  const verdict: 'pass' | 'rewrite' = tiebreak && tiebreak.verdict !== 'unknown'
    ? tiebreak.verdict
    : arabic.verdict === 'rewrite' || strong.verdict === 'rewrite' ? 'rewrite' : 'pass';
  // Merge leak lists, deduplicated by token.
  const seen = new Set<string>();
  const leaks = [...strong.leaks, ...arabic.leaks].filter((l) => {
    if (seen.has(l.token)) return false;
    seen.add(l.token);
    return true;
  }).slice(0, 10);

  console.log(
    `[dialectValidator] cross-check ${agreement}: ` +
      `${arabicModel}=${arabic.score}/${arabic.verdict} ` +
      `${VALIDATOR_MODEL}=${strong.score}/${strong.verdict}` +
      `${tiebreak ? ` ${tiebreakModel}=${tiebreak.score}/${tiebreak.verdict}` : ''}` +
      ` → ${verdict}`,
  );

  return {
    score: Math.min(arabic.score, strong.score),
    verdict,
    leaks,
    notes: tiebreak?.notes ?? strong.notes ?? arabic.notes,
    // The two standing legs run in parallel, so their cost to the caller's
    // budget is the slower one rather than the sum; the tie-break ladder is
    // sequential after them, so it adds the whole phase — every rung tried,
    // not just the one that answered.
    latencyMs: Math.max(arabic.latencyMs, strong.latencyMs) + (settled?.elapsedMs ?? 0),
    ok: true,
    // `tiebreakModel`, not the Fanar constant: which model settles a split is
    // now a deployment question, so naming the constant would attribute Jais's
    // verdict to Fanar in every consumer and log that reads this field.
    model: `${arabicModel}+${VALIDATOR_MODEL}${tiebreak ? `+${tiebreakModel}` : ''}`,
    agreement,
  };
}

/**
 * Ask the best available Arabic-native model a free-form question about Arabic,
 * walking `ARABIC_OCCASIONAL_ORDER` until one answers.
 *
 * This exists because the transcript pipeline could not reach any of these
 * models. `analyze-gulf-arabic` ran its per-video dialect check by calling
 * Fanar directly with a bare `fetch` to `api.fanar.qa` and a hardcoded model
 * id, which meant adding Jais 2 and then HUMAIN M3 to the registry changed
 * nothing there: the pipeline had no way to see them, so the strongest Arabic
 * model in the project sat unused on every video that has ever been processed.
 * Going through the gateway is what makes the registry's roster reachable, and
 * it is the same rule every other model call in this codebase follows.
 *
 * Deliberately *not* `validateDialect`: that one asks for a 1-5 authenticity
 * score through a fixed tool schema, and this caller wants a whole transcript
 * reviewed into structured issues under its own prompt. Shared here anyway,
 * rather than in the pipeline, so the ladder and its ordering argument live in
 * one place.
 *
 * Returns which model answered, not just the text. The caller records it in
 * provenance — without that, a run's audit cannot distinguish M3's judgment
 * from Fanar's, which is exactly the ambiguity that hid this gap.
 */
/**
 * How long one rung of the roster walk may take when its caller names no
 * budget.
 *
 * Deliberately *not* the tie-break rung ceilings, and that distinction is the
 * correction to this helper's first version. Those ceilings
 * (`arabicRungCeilingMs`) are sized for a single-snippet authenticity
 * judgment on a path a learner is waiting on — 7s for M3, 5s for Jais, 16s for
 * Fanar. This walk's caller hands over a whole transcript and asks for up to
 * 1024 tokens of JSON about it, which is a different job by an order of
 * magnitude: the `callFanar` path it replaced allowed 30s just to receive
 * Fanar's headers and then a generation budget on top. Clamped to the
 * tie-break numbers, a healthy but unhurried Fanar was aborted at 16s and the
 * dialect check landed `null` — the feature this helper exists to restore,
 * broken by the ceiling meant to protect it.
 *
 * So the default is sized for the job rather than for the slot, and a caller
 * with a real deadline (the pipeline has one) passes its own.
 */
const JUDGE_RUNG_TIMEOUT_MS = 45_000;

/**
 * How long a self-hosted rung has to prove it is awake when another rung is
 * waiting behind it.
 *
 * The RunPod worker scales to zero, so the question "is it awake" should be
 * cheap to answer when somebody else can do the work — the same argument as
 * `TIEBREAK_COLD_BAIL_MS`, at a batch path's scale rather than a learner's.
 *
 * It bounds a *probe*, not the judgment. The first version of this walk put
 * the whole call under it, and that made a warm Jais indistinguishable from a
 * cold one: vLLM sends a non-streaming completion's headers only when the body
 * is finished, and an 8B model writing a thousand tokens of JSON about a whole
 * transcript takes well past eight seconds even on a hot GPU. So the rung was
 * aborted mid-answer on every video — warm or not — and Jais never judged a
 * single transcript. The probe is a one-token completion instead: an awake
 * worker answers it in well under a second, and only the answer to *that*
 * decides whether the real call is made under the full budget.
 *
 * It applies only when there *is* a successor. A cold bail on the last rung
 * buys nothing and costs the whole judgment: no other model is going to
 * answer, so the choice is between waiting and returning nothing.
 */
const JUDGE_COLD_PROBE_MS = 8_000;

/**
 * Is the worker behind `model` awake? Answered with the smallest legal
 * completion under `timeoutMs`, so the answer costs one token when the worker
 * is up and one aborted request when it is not.
 *
 * Returns the reason when it is not, so the caller can record whether the
 * rung was asleep (nothing answered) or broken (something answered, badly).
 */
async function probeAwake(
  model: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ awake: true } | { awake: false; error: string }> {
  const timer = AbortSignal.timeout(timeoutMs);
  try {
    const res = await chatFetch(model, {
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }, {
      signal: signal ? AbortSignal.any([signal, timer]) : timer,
      noFallback: true,
      label: 'arabicNativeJudge/probe',
    });
    // The body is not the point, but draining it is what lets the connection
    // be reused for the real call that follows.
    await res.body?.cancel();
    if (res.ok) return { awake: true };
    return { awake: false, error: `HTTP ${res.status} on wake probe` };
  } catch (err) {
    const aborted = timer.aborted && !signal?.aborted;
    return {
      awake: false,
      error: aborted ? `cold worker: no answer to a 1-token probe in ${timeoutMs}ms` : String(err).slice(0, 160),
    };
  }
}

/** The one switch for both pipeline wake-ups: the run-start ping and the probe's. */
function pipelineWarmupEnabled(): boolean {
  return Deno.env.get('JAIS_PIPELINE_WARMUP')?.trim().toLowerCase() !== 'off';
}

/**
 * Wake the self-hosted Arabic judges ahead of a transcript run, so they are up
 * by the time the run has anything to ask them.
 *
 * The transcription pipeline is the one caller with the time to spend: between
 * the ASR fan-out and the merge, two to three minutes pass before the dialect
 * check and the translation arbitration fire, which is about what a FlashBoot
 * start of the 8B worker takes. Without this the endpoint, which scales to
 * zero after five idle minutes, is cold for every video that arrives more than
 * five minutes after the last, and the probe above correctly bails past it —
 * which is the correct behaviour on a learner's path and the wrong outcome on
 * a batch one, where the whole point of renting the worker was to have it
 * judge transcripts.
 *
 * Unlike `warmTiebreaker` this is on by default, and the two defaults are the
 * same cost decision made about different workloads. A validator split can
 * happen on any learner request at any rate, so warming behind it converges
 * on a worker running continuously; a transcript run is a deliberate, rare
 * act whose other calls already cost dollars, and one worker-boot per import
 * (the 300s idle window carries a batch of imports on one boot) is a rounding
 * error against them. `JAIS_PIPELINE_WARMUP=off` switches it off.
 *
 * A no-op for every rung that is not self-hosted, and for an undeployed one.
 */
export function warmArabicJudges(): string[] {
  if (!pipelineWarmupEnabled()) return [];
  const warmed: string[] = [];
  for (const model of ARABIC_OCCASIONAL_ORDER) {
    if (providerForModel(model) !== 'runpod' || !tryChatRoute(model)) continue;
    warmRoute(model);
    warmed.push(model);
  }
  if (warmed.length) console.log(`[dialectValidator] warming self-hosted Arabic judge(s) for the run: ${warmed.join(', ')}`);
  return warmed;
}

export interface ArabicJudgement {
  /**
   * The reply text, or null when nobody on the ladder answered.
   *
   * When a caller supplied `accept` and no rung produced a usable reply, this
   * is the first reply that was at least *something* — with `usable: false` —
   * so a prose answer still reaches a log or an admin banner rather than
   * vanishing.
   */
  content: string | null;
  /** Which model produced `content`, for provenance. Null when none did. */
  model: string | null;
  /** Whether `content` passed the caller's `accept` check (always true without one). */
  usable: boolean;
  /** Every model tried and why it did not answer, oldest first. */
  attempts: Array<{ model: string; error: string }>;
}

export async function judgeWithArabicNative(
  systemPrompt: string,
  userContent: string,
  opts: {
    maxTokens?: number;
    temperature?: number;
    /** Ceiling for each rung, not for the walk. */
    timeoutMs?: number;
    signal?: AbortSignal;
    label?: string;
    /**
     * What counts as an answer. A rung whose reply fails this is recorded as a
     * failed attempt and the walk continues, because "answered in prose when
     * asked for JSON" is the most common way an Arabic model lets this caller
     * down, and it is exactly as useless to it as a 503 — while the rung
     * behind may well format correctly. Without it, one chatty reply from the
     * first rung ended the walk with nothing the caller could parse.
     */
    accept?: (content: string) => boolean;
    /**
     * Wake a self-hosted rung found cold, so the next judgment in this run
     * lands on a live worker. Fire-and-forget; see `warmRoute`. Honours
     * `JAIS_PIPELINE_WARMUP=off` like `warmArabicJudges` does.
     */
    warmWhenCold?: boolean;
  } = {},
): Promise<ArabicJudgement> {
  const attempts: Array<{ model: string; error: string }> = [];
  // The first reply that was at least text, kept for when nothing better comes.
  let fallback: { content: string; model: string } | null = null;
  // Resolved up front because the last rung is treated differently: there is
  // nobody behind it to fall through to, so nothing is saved by giving up on
  // it early.
  const routable = ARABIC_OCCASIONAL_ORDER.filter((model) => tryChatRoute(model));

  for (const [index, model] of routable.entries()) {
    // Unconfigured rungs are already filtered out, and deliberately not
    // reported: most deployments will not have all three, and a caller reading
    // `attempts` wants the models that were asked and let it down, not the
    // ones that were never there.
    if (opts.signal?.aborted) break;

    const budgetMs = opts.timeoutMs ?? JUDGE_RUNG_TIMEOUT_MS;
    const hasSuccessor = index < routable.length - 1;

    // A worker we host can be asleep, and finding out is only worth doing
    // cheaply when somebody else can take the job. The probe decides; the
    // real call below then gets the whole budget, cold start excluded.
    if (hasSuccessor && providerForModel(model) === 'runpod') {
      const probe = await probeAwake(model, Math.min(budgetMs, JUDGE_COLD_PROBE_MS), opts.signal);
      if (!probe.awake) {
        attempts.push({ model, error: probe.error });
        if (opts.signal?.aborted) break;
        if (opts.warmWhenCold && pipelineWarmupEnabled() && probe.error.startsWith('cold worker')) warmRoute(model);
        continue;
      }
    }

    const timer = AbortSignal.timeout(budgetMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timer]) : timer;

    try {
      const res = await chatFetch(model, {
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }, { signal, label: opts.label ?? 'arabicNativeJudge' });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        attempts.push({ model, error: `HTTP ${res.status} ${body.slice(0, 120)}` });
        continue;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        // A 200 with nothing in it is a failure like any other — fall through
        // rather than hand the caller an empty "judgment" it would then try to
        // parse into issues.
        attempts.push({ model, error: 'empty response body' });
        continue;
      }
      if (opts.accept && !opts.accept(content)) {
        attempts.push({ model, error: `unusable reply: ${content.slice(0, 120).replace(/\s+/g, ' ')}` });
        fallback ??= { content, model };
        continue;
      }
      return { content, model, usable: true, attempts };
    } catch (err) {
      attempts.push({ model, error: String(err).slice(0, 160) });
      // A caller that gave up wants no further rungs tried on its behalf; only
      // this rung's own ceiling means "try the next one".
      if (opts.signal?.aborted) break;
    }
  }

  if (fallback) return { ...fallback, usable: false, attempts };
  return { content: null, model: null, usable: false, attempts };
}
