import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `assistantTools` — what the Ask AI assistant can go and fetch, and the
 * `assistant-tools` function that lets a live voice call reach it.
 *
 * Two properties carry this file. The first is that `read_source` will only
 * open a URL the learner's own screen points at: the model choosing the URL
 * has scraped third-party text in its context, and an assistant that fetches
 * whatever it is told to is a proxy with an LLM picking the target. The
 * second is that nothing here fails loudly — a tool that cannot answer must
 * hand back a refusal the tutor can relay, not an exception in the middle of
 * a conversation.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const ARTICLE = "https://news.example.com/gulf/dates-harvest";
const VIDEO = "11111111-2222-4333-8444-555555555555";

interface ToolsModule {
  executeAssistantTool(
    name: string,
    args: Record<string, unknown>,
    ctx: {
      userId: string;
      dialect: string;
      allowedUrls: string[];
      currentSourceId?: string;
    },
  ): Promise<{ ok: boolean; text: string }>;
  executePlan(
    plan: Array<{ name: string; args: Record<string, unknown> }>,
    ctx: { userId: string; dialect: string; allowedUrls: string[] },
  ): Promise<Array<{ name: string; result: { ok: boolean; text: string } }>>;
  MAX_TOOL_CALLS: number;
}

const scrape = (markdown: string, title = "Dates harvest up"): UpstreamHandler => () =>
  json({ data: { markdown, metadata: { title } } });

function upstreamsFor(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "api.firecrawl.dev": scrape("The date harvest in Najd is up thirty percent this year."),
    "api.openai.com": async (request) => {
      const body = JSON.parse((await request.text()) || "{}");
      const inputs: string[] = Array.isArray(body.input) ? body.input : [];
      return json({ data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2] })) });
    },
    "/rest/v1/rpc/match_content": () =>
      json([
        {
          kind: "video_line",
          source_id: VIDEO,
          chunk_index: 1,
          dialect: "Gulf",
          content: "شف هالتمر\nlook at these dates",
          similarity: 0.8,
        },
      ]),
    "/rest/v1/discover_videos": () => json([{ id: VIDEO, title: "Souq tour" }]),
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    ...extra,
  };
}

async function withTools(
  upstreams: Record<string, UpstreamHandler>,
  run: (mod: ToolsModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ upstreams });
  try {
    await run(await loadSharedModule<ToolsModule>("assistantTools"), up);
  } finally {
    up.restore();
  }
}

const ctx = (over: Partial<{ allowedUrls: string[]; currentSourceId: string }> = {}) => ({
  userId: USER,
  dialect: "Gulf",
  allowedUrls: [ARTICLE],
  ...over,
});

Deno.test("read_source reads a page the learner's screen points at", async () => {
  await withTools(upstreamsFor(), async (mod) => {
    const result = await mod.executeAssistantTool("read_source", { url: ARTICLE }, ctx());
    assert(result.ok);
    assertStringIncludes(result.text, "up thirty percent");
    assertStringIncludes(result.text, "Dates harvest up");
  });
});

Deno.test("read_source refuses a URL that is not on the learner's screen", async () => {
  await withTools(upstreamsFor(), async (mod, up) => {
    const result = await mod.executeAssistantTool(
      "read_source",
      { url: "https://evil.example/exfiltrate" },
      ctx(),
    );
    assert(!result.ok);
    assertStringIncludes(result.text, "Refused");
    // And it never left the building.
    assertEquals(up.calls.filter((c) => c.url.includes("firecrawl")).length, 0);
  });
});

Deno.test("read_source refuses a same-host URL the page never published", async () => {
  await withTools(upstreamsFor(), async (mod, up) => {
    const result = await mod.executeAssistantTool(
      "read_source",
      { url: "https://news.example.com/internal/admin" },
      ctx(),
    );
    assert(!result.ok);
    assertEquals(up.calls.filter((c) => c.url.includes("firecrawl")).length, 0);
  });
});

Deno.test("read_source reports a fetch failure instead of inventing the page", async () => {
  await withTools(
    upstreamsFor({ "api.firecrawl.dev": () => json({ error: "gone" }, 502) }),
    async (mod) => {
      const result = await mod.executeAssistantTool("read_source", { url: ARTICLE }, ctx());
      assert(!result.ok);
      assertStringIncludes(result.text, "502");
    },
  );
});

Deno.test("read_source bounds how much of a page reaches the prompt", async () => {
  await withTools(
    upstreamsFor({ "api.firecrawl.dev": scrape("x".repeat(50_000)) }),
    async (mod) => {
      const result = await mod.executeAssistantTool("read_source", { url: ARTICLE }, ctx());
      assert(result.ok);
      assert(result.text.length < 8000, `got ${result.text.length} chars`);
      assertStringIncludes(result.text, "the rest of the page was not read");
    },
  );
});

Deno.test("search_library returns real material from the learner's own library", async () => {
  await withTools(upstreamsFor(), async (mod) => {
    const result = await mod.executeAssistantTool("search_library", { query: "تمر" }, ctx());
    assert(result.ok);
    assertStringIncludes(result.text, "Souq tour");
  });
});

Deno.test("search_library says so when nothing matched", async () => {
  await withTools(
    upstreamsFor({ "/rest/v1/rpc/match_content": () => json([]) }),
    async (mod) => {
      const result = await mod.executeAssistantTool("search_library", { query: "تمر" }, ctx());
      assert(result.ok);
      assertStringIncludes(result.text, "Nothing in the learner's library matched");
    },
  );
});

Deno.test("get_word_history reports a word the learner has never met", async () => {
  await withTools(upstreamsFor(), async (mod) => {
    const result = await mod.executeAssistantTool("get_word_history", { word: "تمر" }, ctx());
    assert(result.ok);
    assertStringIncludes(result.text, "new to them");
  });
});

Deno.test("get_word_history reads both decks and flags a leech", async () => {
  await withTools(
    upstreamsFor({
      "/rest/v1/user_vocabulary": () =>
        json([
          {
            word_english: "dates",
            repetitions: 9,
            interval_days: 2,
            lapses: 7,
            is_leech: true,
            next_review_at: "2026-08-20T00:00:00Z",
          },
        ]),
      "/rest/v1/word_reviews": () =>
        json([
          {
            repetitions: 4,
            interval_days: 30,
            lapses: 0,
            is_leech: false,
            next_review_at: "2026-09-01T00:00:00Z",
            vocabulary_words: { word_arabic: "تمر", word_english: "dates", dialect_module: "Gulf" },
          },
        ]),
    }),
    async (mod) => {
      const result = await mod.executeAssistantTool("get_word_history", { word: "تمر" }, ctx());
      assert(result.ok);
      // The personal deck says they keep forgetting it; that is the fact worth
      // changing an explanation over.
      assertStringIncludes(result.text, "leech");
      assertStringIncludes(result.text, "their own saved words");
      assertStringIncludes(result.text, "the curriculum deck");
      assertStringIncludes(result.text, "well established");
    },
  );
});

Deno.test("an invented tool name is refused, not ignored", async () => {
  await withTools(upstreamsFor(), async (mod) => {
    const result = await mod.executeAssistantTool("delete_everything", {}, ctx());
    assert(!result.ok);
    assertStringIncludes(result.text, "no tool called");
  });
});

Deno.test("executePlan runs at most MAX_TOOL_CALLS lookups", async () => {
  await withTools(upstreamsFor(), async (mod) => {
    const plan = Array.from({ length: 6 }, (_, i) => ({
      name: "search_library",
      args: { query: `q${i}` },
    }));
    const results = await mod.executePlan(plan, ctx());
    assertEquals(results.length, mod.MAX_TOOL_CALLS);
  });
});

// ── the voice endpoint ───────────────────────────────────────────────────────

function subscriber(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    ...upstreamsFor(extra),
  };
}

async function callFunction(body: unknown, upstreams: Record<string, UpstreamHandler>, jwt?: string | null) {
  const fn = await loadFunction("assistant-tools", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("assistant-tools", body, jwt === undefined ? {} : { jwt }),
    );
    return { response, body: await response.json().catch(() => null), calls: fn.calls.map((c) => c.url) };
  } finally {
    fn.restore();
  }
}

Deno.test("assistant-tools turns an anonymous caller away", async () => {
  const { response } = await callFunction(
    { name: "search_library", args: { query: "تمر" } },
    subscriber(),
    null,
  );
  assertEquals(response.status, 401);
});

Deno.test("assistant-tools resolves the allow-list from the posted context, not the argument", async () => {
  // The browser relays the model's tool call; it does not get to say what the
  // model may reach. The URL is only readable because the same request carried
  // the context that names it.
  const allowed = await callFunction(
    {
      name: "read_source",
      args: { url: ARTICLE },
      dialect: "Gulf",
      pageContext: {
        title: "Souq News",
        document: { label: "Article", sourceUrl: ARTICLE, lines: [{ arabic: "خبر" }] },
      },
    },
    subscriber(),
  );
  assertEquals(allowed.response.status, 200);
  assert(allowed.body.ok, allowed.body.text);
  assertStringIncludes(allowed.body.text, "up thirty percent");

  const refused = await callFunction(
    { name: "read_source", args: { url: ARTICLE }, dialect: "Gulf", pageContext: { title: "Souq News" } },
    subscriber(),
  );
  assertEquals(refused.response.status, 200);
  assertEquals(refused.body.ok, false);
  assertStringIncludes(refused.body.text, "Refused");
});

Deno.test("assistant-tools answers 200 even for a refusal", async () => {
  // A live call is waiting on this result. A non-200 leaves the tutor silent
  // mid-conversation; a refusal it can read aloud does not.
  const { response, body } = await callFunction(
    { name: "not_a_tool", args: {}, dialect: "Gulf" },
    subscriber(),
  );
  assertEquals(response.status, 200);
  assertEquals(body.ok, false);
});

Deno.test("assistant-tools rejects a call with no tool name", async () => {
  const { response } = await callFunction({ args: {} }, subscriber());
  assertEquals(response.status, 400);
});
