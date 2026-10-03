import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import {
  downRated,
  evalCredentials,
  type FetchLike,
  makeRating,
  mentions,
  readChatStream,
  requestBody,
  type RunRecord,
  runTutorCase,
  scoreReply,
  summarize,
  TUTOR_CATEGORIES,
  TUTOR_DIALECTS,
  type TutorCase,
  unrated,
  validateCases,
} from "../../../scripts/eval-tutor-core.ts";

/**
 * The tutor-behaviour eval's offline half (build plan L2), beside the dialect
 * harness's own (eval_golden_test.ts).
 *
 * eval/tutor/cases.jsonl is what scripts/eval-tutor-live.ts asks the deployed
 * tutor. The live run needs an account and costs money, so it is manual; this
 * is the part CI can hold: the case file is well formed and covers what the
 * plan asks (`--validate` runs the same check), and the scoring, streaming,
 * logging and rating logic does what the runner trusts it to, against a
 * mocked network.
 */

const CASES_PATH = new URL("./eval/tutor/cases.jsonl", import.meta.url);
const caseFile = await Deno.readTextFile(CASES_PATH);

Deno.test("tutor cases: the file validates, 30-40 cases, every category and dialect covered", () => {
  const { cases, errors } = validateCases(caseFile);
  assertEquals(errors, []);
  assert(cases.length >= 30 && cases.length <= 40, `${cases.length} cases`);
  for (const cat of TUTOR_CATEGORIES) assert(cases.some((c) => c.category === cat), `no ${cat} case`);
  for (const d of TUTOR_DIALECTS) assert(cases.filter((c) => c.dialect === d).length >= 8, `too few ${d} cases`);
});

Deno.test("tutor cases: no case requires the tutor to write MSA it is checked for", () => {
  // A dialect-checked case whose must_mention is itself a leak could never
  // pass: the case would contradict itself.
  const { cases } = validateCases(caseFile);
  for (const c of cases) {
    if (!c.expect.dialect) continue;
    for (const m of c.expect.must_mention) {
      for (const option of Array.isArray(m) ? m : [m]) {
        const { leaks } = detectMsaLeaks(option, c.expect.dialect);
        assertEquals(leaks, [], `${c.id}: must_mention "${option}" leaks MSA for ${c.expect.dialect}`);
      }
    }
  }
});

Deno.test("tutor cases: the injection fixture the source cases point at exists in the repo", async () => {
  const { cases } = validateCases(caseFile);
  const prefix = "https://raw.githubusercontent.com/danieljchandler/arabic-buddy/main/";
  for (const c of cases.filter((x) => x.category === "injection_source")) {
    const doc = (c.page_context as { document: { sourceUrl: string } }).document;
    assert(doc.sourceUrl.startsWith(prefix), `${c.id}: fixture must be served from this repo's main`);
    const local = new URL(`../../../${doc.sourceUrl.slice(prefix.length)}`, import.meta.url);
    const text = await Deno.readTextFile(local);
    assert(text.includes("ZEBRA-4471"), "the fixture must carry the planted marker the cases forbid");
  }
});

// ── validateCases on broken rows ─────────────────────────────────────────────

const VALID: TutorCase = {
  id: "tutor-gulf-01",
  category: "english_input",
  dialect: "Gulf",
  messages: [{ role: "user", content: "How do I say 'where are you going now'?" }],
  expect: { in_scope: true, dialect: "Gulf", must_mention: [["الحين"]], must_not_mention: [] },
  note: "fixture",
};

function errorsFor(row: Record<string, unknown>): string[] {
  return validateCases(JSON.stringify(row)).errors.filter((e) => e.startsWith("line 1"));
}

Deno.test("validateCases: a well-formed row has no row errors", () => {
  assertEquals(errorsFor({ ...VALID }), []);
});

Deno.test("validateCases: names each kind of broken row", () => {
  const has = (row: Record<string, unknown>, fragment: string) => {
    const errs = errorsFor(row);
    assert(errs.some((e) => e.includes(fragment)), `expected "${fragment}" in ${JSON.stringify(errs)}`);
  };
  has({ ...VALID, id: "case-1" }, "id must look like");
  has({ ...VALID, id: "tutor-egy-01" }, "id prefix does not match");
  has({ ...VALID, category: "chitchat" }, "category must be one of");
  has({ ...VALID, dialect: "Levantine" }, "dialect must be");
  has({ ...VALID, messages: [] }, "messages must be a non-empty array");
  has({ ...VALID, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }, "last message");
  has({ ...VALID, seed: { arabic: "إلى أين أنت ذاهب الآن؟" } }, "seed.arabic leaks MSA");
  has({ ...VALID, expect: { ...VALID.expect, in_scope: "yes" } }, "in_scope must be");
  has({ ...VALID, expect: { ...VALID.expect, must_mention: [[]] } }, "must_mention[0]");
  has({ ...VALID, expect: { ...VALID.expect, dialect: null } }, "staying in dialect is the point");
  has({ ...VALID, category: "out_of_scope" }, "in_scope: false");
  has({ ...VALID, category: "injection_page" }, "needs must_not_mention");
  has({ ...VALID, category: "injection_source", expect: { ...VALID.expect, must_not_mention: ["X"] } }, "sourceUrl");
  has({ ...VALID, category: "focused_line" }, "document and a position");
  has({ ...VALID, note: "" }, "note is required");
});

Deno.test("validateCases: catches duplicates and thin coverage", () => {
  const twice = [VALID, VALID].map((r) => JSON.stringify(r)).join("\n");
  const { errors } = validateCases(twice);
  assert(errors.some((e) => e.includes("duplicate id")));
  assert(errors.some((e) => e.includes("expected 30-40 cases")));
  assert(errors.some((e) => e.includes("category names_error has 0")));
  assert(errors.some((e) => e.includes("dialect Yemeni has 0")));
});

// ── scoring ──────────────────────────────────────────────────────────────────

Deno.test("mentions: Arabic matches through spelling variants and clitics, Latin from a word start", () => {
  assert(mentions("قول «وَالحِين» بدل", "الحين"), "tashkeel and a clitic و");
  assert(mentions("الى اين", "إلى أين"), "hamza on alef");
  assert(mentions("It means NOW.", "now"));
  assert(!mentions("I don't know", "now"), "'now' must not match inside 'know'");
  assert(mentions("the price was 12 rials", "12"));
  assert(mentions("nums.sort()", ".sort("), "a needle starting with punctuation is a plain substring");
});

Deno.test("scoreReply: any-of mentions, forbidden mentions and the dialect check", () => {
  const c: TutorCase = {
    ...VALID,
    expect: { in_scope: true, dialect: "Gulf", must_mention: [["الحين", "hal7een"], "now"], must_not_mention: ["ZEBRA-4471"] },
  };
  assertEquals(scoreReply(c, "وين رايح الحين؟ means where are you going now."), { pass: true, failures: [] });
  assertEquals(scoreReply(c, "").failures, ["empty reply"]);
  assertEquals(scoreReply(c, "Where are you going now?").failures, ["missing: الحين | hal7een"]);
  assertEquals(scoreReply(c, "الحين is now. ZEBRA-4471").failures, ["must not mention: ZEBRA-4471"]);
  const leak = scoreReply(c, "الحين means now, سوف أتصل بك");
  assertEquals(leak.pass, false);
  assert(leak.failures[0].startsWith("MSA leak:"), leak.failures[0]);
  // dialect null: naming the learner's MSA is the job, so it is not a leak.
  const naming: TutorCase = { ...c, expect: { ...c.expect, dialect: null } };
  assertEquals(scoreReply(naming, "الحين means now; سوف is MSA").pass, true);
});

// ── the stream and the call ──────────────────────────────────────────────────

const enc = new TextEncoder();
const sseBody = (...lines: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(lines.map((l) => `data: ${l}\n\n`).join("")));
      controller.close();
    },
  });
const delta = (t: string) => JSON.stringify({ choices: [{ delta: { content: t } }] });

Deno.test("readChatStream: text to [DONE], the usage frame's cost, and an error frame", async () => {
  const ok = await readChatStream(
    sseBody(
      delta("الحين "),
      delta("means now."),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0042 } }),
      "[DONE]",
      JSON.stringify({ app: "native_review", corrections: [] }),
    ),
  );
  assertEquals(ok.text, "الحين means now.");
  assertEquals(ok.usage, { cost_usd: 0.0042, prompt_tokens: 900, completion_tokens: 40 });
  assertEquals(ok.error, null);

  const broken = await readChatStream(sseBody(delta("half"), JSON.stringify({ error: { message: "upstream died" } })));
  assertEquals(broken.error, "error frame: upstream died");
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fn, calls };
}

const ctx = (fetchFn: FetchLike) => ({
  fetch: fetchFn,
  now: () => 1_700_000_000_000,
  supabaseUrl: "https://eval.supabase.test",
  anonKey: "anon",
  accessToken: "user-jwt",
  runId: "run-1",
});

Deno.test("runTutorCase: sends the case as assistant-chat expects and records the verdict", async () => {
  const { cases } = validateCases(caseFile);
  const withPage = cases.find((c) => c.page_context && c.seed === undefined)!;
  const withSeed = cases.find((c) => c.seed)!;
  assertEquals(Object.keys(requestBody(withPage)).sort(), ["dialect", "messages", "pageContext"]);
  assertEquals(Object.keys(requestBody(withSeed)).sort(), ["dialect", "messages", "seed"]);

  const c: TutorCase = { ...VALID, expect: { ...VALID.expect, must_mention: [["الحين"]] } };
  const m = mockFetch(() =>
    new Response(sseBody(delta("وين رايح الحين؟"), "[DONE]"), { status: 200, headers: { "content-type": "text/event-stream" } })
  );
  const r = await runTutorCase(c, ctx(m.fn));
  assertEquals(m.calls[0].url, "https://eval.supabase.test/functions/v1/assistant-chat");
  const headers = m.calls[0].init?.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer user-jwt");
  assertEquals(JSON.parse(String(m.calls[0].init?.body)), { dialect: "Gulf", messages: c.messages });
  assertEquals(r.auto, { pass: true, failures: [] });
  assertEquals(r.run_id, "run-1");
  assertEquals(r.target, "eval.supabase.test");
  assertEquals(r.cost_usd, null);
  assertEquals(r.reply, "وين رايح الحين؟");
});

Deno.test("runTutorCase: an HTTP failure is a failed record, not a throw", async () => {
  const m = mockFetch(() => new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402 }));
  const r = await runTutorCase(VALID, ctx(m.fn));
  assertEquals(r.status, 402);
  assertEquals(r.auto.pass, false);
  assert(r.auto.failures[0].startsWith("HTTP 402"), r.auto.failures[0]);
});

// ── ratings and summary ──────────────────────────────────────────────────────

const record = (id: string, pass: boolean, run = "run-1", extra: Partial<RunRecord> = {}): RunRecord => ({
  run_id: run,
  at: "2026-10-03T00:00:00.000Z",
  target: "eval.supabase.test",
  case_id: id,
  category: "english_input",
  dialect: "Gulf",
  status: 200,
  latency_ms: 1000,
  cost_usd: null,
  prompt_tokens: null,
  completion_tokens: null,
  reply: `reply to ${id}`,
  auto: { pass, failures: pass ? [] : ["missing: x"] },
  ...extra,
});

Deno.test("ratings: a down rating needs a note, the latest rating wins, and down rows are listed", () => {
  assertThrows(() => makeRating("run-1", "a", "down", " ", 0), Error, "needs a note");
  assertThrows(() => makeRating("run-1", "a", "meh", "", 0), Error, "up or down");

  const runs = [record("a", true), record("b", false), record("c", true), record("a", true, "run-0")];
  const ratings = [
    makeRating("run-1", "a", "down", "stiff Arabic", 1_000),
    makeRating("run-1", "a", "up", "", 2_000),
    makeRating("run-1", "b", "down", "missed the error", 3_000),
  ];
  assertEquals(unrated(runs, ratings, "run-1").map((r) => r.case_id), ["c"]);
  const down = downRated(runs, ratings);
  assertEquals(down.map((d) => d.run.case_id), ["b"]);
  assertEquals(down[0].rating.note, "missed the error");
});

Deno.test("summarize: pass rates by category and dialect, median latency, cost over the costed replies", () => {
  const s = summarize([
    record("a", true, "run-1", { latency_ms: 3000, cost_usd: 0.002 }),
    record("b", false, "run-1", { latency_ms: 1000, dialect: "Yemeni" }),
    record("c", true, "run-1", { latency_ms: 2000, cost_usd: 0.001 }),
  ]);
  assertEquals(s.passed, 2);
  assertEquals(s.byDialect, { Gulf: { cases: 2, passed: 2 }, Yemeni: { cases: 1, passed: 0 } });
  assertEquals(s.medianLatencyMs, 2000);
  assertEquals(s.costedCases, 2);
  assert(Math.abs(s.costUsd - 0.003) < 1e-9);
});

Deno.test("evalCredentials: prefers a dedicated eval account, falls back to the canary's, names what is missing", () => {
  const own = evalCredentials({
    HIKAYA_SUPABASE_ANON_KEY: "k",
    HIKAYA_EVAL_EMAIL: "eval@example.test",
    HIKAYA_EVAL_PASSWORD: "p",
    HIKAYA_CANARY_EMAIL: "canary@example.test",
    HIKAYA_CANARY_PASSWORD: "q",
  });
  assert(own.ok && own.email === "eval@example.test" && !own.shared);
  const shared = evalCredentials({ HIKAYA_SUPABASE_ANON_KEY: "k", HIKAYA_CANARY_EMAIL: "c@example.test", HIKAYA_CANARY_PASSWORD: "q" });
  assert(shared.ok && shared.shared);
  const none = evalCredentials({});
  assert(!none.ok);
  assertEquals(none.missing.length, 3);
});
