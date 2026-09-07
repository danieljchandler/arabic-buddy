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
import { MODEL_IDS } from './modelRegistry.ts';

const VALIDATOR_MODEL = MODEL_IDS.GEMINI_PRO;
// Arabic-native second opinion. Mistral Saba is a 24B Arabic-focused model on
// the OpenRouter key the app already uses — roughly an order of magnitude
// cheaper than the Pro-tier judge on this single-snippet task.
const ARABIC_VALIDATOR_MODEL = MODEL_IDS.SABA;
/**
 * Arabic-native tie-breaker, consulted only when the other two disagree.
 *
 * Fanar is the better Arabic judge of the three — QCRI's sovereign model,
 * dialect-tuned and validated by native testers — so the obvious move is to
 * make it the standing Arabic leg in place of Saba. It is not, for one reason:
 * quota. Fanar's endpoints run on small daily allowances (the STT paths in
 * `fanar-transcribe` are metered at 18 and 8 calls a day), and the validator
 * fires on every generation that asks for it. An always-on Fanar leg would
 * spend the allowance before lunch and then degrade to `ok: false` for the rest
 * of the day — a quality gate that is off precisely when the app is busiest.
 *
 * A disagreement is the one moment the third opinion is worth a call: the two
 * standing legs have already split, so the merge is about to fall back on
 * "harsher verdict wins", which is a safe default rather than a judgment. Any
 * disagreement is a minority of calls, which keeps this inside the allowance.
 */
const TIEBREAK_VALIDATOR_MODEL = MODEL_IDS.FANAR;

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
const TIEBREAK_BUDGET_MS = 12_000;
/** Below this there is no point asking anyone; the rule is the cheaper answer. */
const TIEBREAK_MIN_MS = 1_000;

/**
 * The Arabic-native specialists that can settle a split, best first.
 *
 * Jais 2 goes first when its endpoint is deployed. It is a strong instrument
 * for this specific question — Arabic-native, trained from scratch, judging
 * whether a line reads as native — and, unlike Fanar, it runs on hardware this
 * project rents, so the quota argument above does not apply to it: there is no
 * daily allowance to spend before lunch.
 *
 * Deliberately the **8B**. Upstream's 70B scores better, but its weights are
 * 144GB, so a cold start is a multi-minute download and the model is only
 * economic amortised over batch work — which is why it is not carried in the
 * registry at all. The 8B is 16GB on a single GPU and can actually answer
 * inside a caller's timeout. Size is chosen by job, not by quality; see
 * `MODEL_IDS` for the full cost argument.
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
function tiebreakValidatorModels(): string[] {
  const ladder: string[] = [];
  if (tryChatRoute(MODEL_IDS.JAIS2_8B)) ladder.push(MODEL_IDS.JAIS2_8B);
  if (tryChatRoute(TIEBREAK_VALIDATOR_MODEL)) ladder.push(TIEBREAK_VALIDATOR_MODEL);
  return ladder;
}

/**
 * A rung's own ceiling. A worker we host can be asleep, and the whole point of
 * asking it first is that finding out is cheap; a hosted API is either up or it
 * is not, so it gets whatever budget is left.
 */
function tiebreakCeilingMs(model: string): number {
  return providerForModel(model) === 'runpod' ? TIEBREAK_COLD_BAIL_MS : TIEBREAK_BUDGET_MS;
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
): Promise<SettledSplit | null> {
  const ladder = tiebreakValidatorModels();
  if (!ladder.length) return null;

  const start = Date.now();
  const deadline = start +
    Math.min(TIEBREAK_BUDGET_MS, opts.timeoutMs ?? TIEBREAK_BUDGET_MS);

  for (const model of ladder) {
    const remaining = deadline - Date.now();
    if (remaining < TIEBREAK_MIN_MS) break;
    const result = await validateDialect(text, dialect, {
      ...opts,
      model,
      timeoutMs: Math.min(remaining, tiebreakCeilingMs(model)),
    });
    if (result.ok && result.verdict !== 'unknown') {
      return { result, model, elapsedMs: Date.now() - start };
    }
    // It did not answer. If it is ours, it was probably asleep — say so, and
    // let the warm-up policy decide whether that is worth acting on.
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

  const [arabic, strong] = await Promise.all([
    validateDialect(text, dialect, { ...opts, model: ARABIC_VALIDATOR_MODEL }),
    validateDialect(text, dialect, { ...opts, model: VALIDATOR_MODEL }),
  ]);

  // If either side failed, trust whichever one worked.
  if (!strong.ok) return arabic.ok ? { ...arabic, agreement: 'single' } : strong;
  if (!arabic.ok) return { ...strong, agreement: 'single' };

  const agreement = arabic.verdict === strong.verdict ? 'agree' : 'disagree';

  // On a split, ask an Arabic-native specialist rather than settling it with a
  // rule. Skipped silently when none is configured, and never reached when the
  // two agree — see `tiebreakValidatorModels` for who is asked and in what order.
  const settled = agreement === 'disagree' ? await settleSplit(text, dialect, opts) : null;
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
      `${ARABIC_VALIDATOR_MODEL}=${arabic.score}/${arabic.verdict} ` +
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
    model: `${ARABIC_VALIDATOR_MODEL}+${VALIDATOR_MODEL}${tiebreak ? `+${tiebreakModel}` : ''}`,
    agreement,
  };
}
