import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `assistantToolRouter` — one cheap call that decides which lookups a question
 * needs, before the answer is streamed.
 *
 * `streamBrain` has no tool loop, and giving it one would mean re-plumbing the
 * streaming path every chat feature in the app shares. This is the cheaper
 * shape. Its defining property is restraint: most questions about what is on
 * screen are answerable from what is on screen, and a lookup that was not
 * needed costs a round trip and drags an irrelevant page into the answer. Its
 * second property is that it never blocks an answer — a router that cannot
 * decide has decided to do nothing.
 */

interface RouterModule {
  planToolCalls(input: {
    question: string;
    dialect: string;
    pageSummary: string;
    availableUrls: string[];
  }): Promise<Array<{ name: string; args: Record<string, unknown> }>>;
}

/** The gateway answering with a forced `plan_lookups` tool call. */
const planning = (lookups: unknown[]): UpstreamHandler => () =>
  chatCompletion("", { lookups });

async function withRouter(
  upstreams: Record<string, UpstreamHandler>,
  run: (mod: RouterModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ upstreams });
  try {
    await run(await loadSharedModule<RouterModule>("assistantToolRouter"), up);
  } finally {
    up.restore();
  }
}

const ARTICLE = "https://news.example.com/gulf/dates-harvest";

const input = (over: Partial<Parameters<RouterModule["planToolCalls"]>[0]> = {}) => ({
  question: "what did the original article actually say about the harvest?",
  dialect: "Gulf",
  pageSummary: "Souq News — a rewritten Gulf dialect story about the date harvest",
  availableUrls: [ARTICLE],
  ...over,
});

Deno.test("the router returns the lookups the model asked for", async () => {
  await withRouter(
    { "ai.gateway.lovable.dev": planning([{ tool: "read_source", url: ARTICLE }]) },
    async (mod) => {
      const plan = await mod.planToolCalls(input());
      assertEquals(plan, [{ name: "read_source", args: { url: ARTICLE } }]);
    },
  );
});

Deno.test("an empty plan is a normal answer, not a failure", async () => {
  await withRouter({ "ai.gateway.lovable.dev": planning([]) }, async (mod) => {
    assertEquals(await mod.planToolCalls(input()), []);
  });
});

Deno.test("the router never plans more lookups than the executor will run", async () => {
  await withRouter(
    {
      "ai.gateway.lovable.dev": planning([
        { tool: "search_library", query: "a" },
        { tool: "search_library", query: "b" },
        { tool: "search_library", query: "c" },
        { tool: "search_library", query: "d" },
      ]),
    },
    async (mod) => {
      const plan = await mod.planToolCalls(input());
      assert(plan.length <= 2, `planned ${plan.length}`);
    },
  );
});

Deno.test("the router is told which URLs exist, and that there are none", async () => {
  await withRouter({ "ai.gateway.lovable.dev": planning([]) }, async (mod, up) => {
    await mod.planToolCalls(input({ availableUrls: [] }));
    const sent = up.calls.find((c) => c.url.includes("lovable"))?.body ?? "";
    // Left to guess, a model will happily invent a plausible-looking URL.
    assertStringIncludes(sent, "read_source is unavailable for this question");
  });
});

Deno.test("the router is not handed the document it is only routing", async () => {
  await withRouter({ "ai.gateway.lovable.dev": planning([]) }, async (mod, up) => {
    await mod.planToolCalls(
      input({ pageSummary: "Souq tour — a Gulf video about a market" }),
    );
    const sent = up.calls.find((c) => c.url.includes("lovable"))?.body ?? "";
    // A router prompt carrying the whole transcript would cost as much as the
    // answer it exists to route.
    assert(sent.length < 4000, `router prompt was ${sent.length} chars`);
  });
});

Deno.test("a one-word follow-up is not worth a routing call", async () => {
  await withRouter({ "ai.gateway.lovable.dev": planning([]) }, async (mod, up) => {
    assertEquals(await mod.planToolCalls(input({ question: "again?" })), []);
    assertEquals(up.calls.filter((c) => c.url.includes("lovable")).length, 0);
  });
});

Deno.test("the answer still goes out when the router is unavailable", async () => {
  // Out of credits, rate limited, or simply down. None of those are a reason
  // for the learner to get no answer.
  for (const status of [402, 429, 500]) {
    await withRouter(
      { "ai.gateway.lovable.dev": () => json({ error: "nope" }, status) },
      async (mod) => {
        assertEquals(await mod.planToolCalls(input()), []);
      },
    );
  }
});

Deno.test("a malformed plan degrades to no lookups", async () => {
  await withRouter(
    { "ai.gateway.lovable.dev": planning([{ nonsense: true }, null]) },
    async (mod) => {
      assertEquals(await mod.planToolCalls(input()), []);
    },
  );
});
