import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `learnerMemory` — the tutor's running notes about one learner, carried
 * between sessions.
 *
 * Two properties matter here. It must never cost a learner their answer: the
 * rewrite runs after the reply has streamed, and every failure path in it is
 * swallowed. And it must not grow without bound — the notes are rewritten, not
 * appended to, and only when enough has been said since the last rewrite to be
 * worth a model call.
 */

const USER = "00000000-0000-4000-8000-000000000001";

interface MemoryModule {
  readLearnerMemory(userId: string, dialect: string): Promise<{
    summary: string;
    openQuestions: string[];
    turnsSeen: number;
    turnsTotal: number;
  }>;
  learnerMemoryBlock(userId: string, dialect: string): Promise<string>;
  updateLearnerMemory(args: {
    userId: string;
    dialect: string;
    messages: Array<{ role: string; content: string }>;
    assistantTurns: number;
    current?: {
      summary: string;
      openQuestions: string[];
      turnsSeen: number;
      turnsTotal: number;
    };
  }): Promise<void>;
}

const storedMemory = (over: Record<string, unknown> = {}) => ({
  summary: "Prefers examples before rules.",
  open_questions: ["when do you drop the ال?"],
  turns_seen: 4,
  ...over,
});

const rewriting = (payload: unknown): UpstreamHandler => () =>
  chatCompletion("", payload);

function upstreamsFor(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/rest/v1/learner_ai_memory": (request) =>
      request.method === "GET" ? json(storedMemory()) : json({}, 201),
    "generativelanguage.googleapis.com/v1beta/openai": rewriting({
      summary: "Prefers examples before rules; now comfortable with بـ.",
      openQuestions: [],
    }),
    ...extra,
  };
}

async function withMemory(
  upstreams: Record<string, UpstreamHandler>,
  run: (mod: MemoryModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ upstreams });
  try {
    await run(await loadSharedModule<MemoryModule>("learnerMemory"), up);
  } finally {
    up.restore();
  }
}

const exchange = [
  { role: "user", content: "why is it بروح and not راح?" },
  { role: "assistant", content: "بـ marks the near future in Gulf Arabic." },
];

Deno.test("learnerMemory reads what was remembered", async () => {
  await withMemory(upstreamsFor(), async (mod) => {
    const memory = await mod.readLearnerMemory(USER, "Gulf");
    assertEquals(memory.summary, "Prefers examples before rules.");
    assertEquals(memory.openQuestions, ["when do you drop the ال?"]);
    assertEquals(memory.turnsSeen, 4);
  });
});

Deno.test("learnerMemory renders the notes with their hedge", async () => {
  await withMemory(upstreamsFor(), async (mod) => {
    const block = await mod.learnerMemoryBlock(USER, "Gulf");
    assertStringIncludes(block, "Prefers examples before rules");
    // The notes are a model's summary of earlier chats — the least reliable
    // thing in the prompt, and the one most able to insult a learner if
    // stated as fact.
    assertStringIncludes(block, "never as a fact about them");
  });
});

Deno.test("learnerMemory reads per dialect", async () => {
  await withMemory(upstreamsFor(), async (mod, up) => {
    await mod.readLearnerMemory(USER, "Egyptian");
    const read = up.calls.find((c) => c.url.includes("learner_ai_memory"));
    // A learner studying two dialects is two conversations; merging them would
    // have the tutor recall an Egyptian confusion during a Gulf lesson.
    assertStringIncludes(read!.url, "dialect=eq.Egyptian");
  });
});

Deno.test("learnerMemory returns nothing rather than failing when the read fails", async () => {
  await withMemory(
    upstreamsFor({ "/rest/v1/learner_ai_memory": () => json({ message: "denied" }, 500) }),
    async (mod) => {
      assertEquals(await mod.readLearnerMemory(USER, "Gulf"), {
        summary: "",
        openQuestions: [],
        turnsSeen: 0,
        turnsTotal: 0,
      });
      assertEquals(await mod.learnerMemoryBlock(USER, "Gulf"), "");
    },
  );
});

Deno.test("learnerMemory rewrites the notes once enough has been said", async () => {
  await withMemory(upstreamsFor(), async (mod, up) => {
    await mod.updateLearnerMemory({
      userId: USER,
      dialect: "Gulf",
      messages: exchange,
      assistantTurns: 8,
      current: { summary: "Prefers examples before rules.", openQuestions: [], turnsSeen: 4, turnsTotal: 4 },
    });

    const write = up.calls.find(
      (c) => c.url.includes("learner_ai_memory") && (c.body ?? "").includes("summary"),
    );
    assert(write, "expected the notes to be written");
    const body = JSON.parse(write!.body!);
    const row = Array.isArray(body) ? body[0] : body;
    assertEquals(row.summary, "Prefers examples before rules; now comfortable with بـ.");
    assertEquals(row.turns_seen, 8);
  });
});

Deno.test("learnerMemory leaves the notes alone until the next rewrite is due", async () => {
  await withMemory(upstreamsFor(), async (mod, up) => {
    await mod.updateLearnerMemory({
      userId: USER,
      dialect: "Gulf",
      messages: exchange,
      assistantTurns: 5,
      current: { summary: "x", openQuestions: [], turnsSeen: 4, turnsTotal: 4 },
    });

    // Summarizing after every turn would double the cost of a conversation to
    // re-derive something that barely moved.
    assertEquals(up.calls.filter((c) => c.url.includes("/chat/completions")).length, 0);

    // The turn still counts, though. Recording it only alongside a rewrite
    // pinned the stored total wherever the last rewrite left it, so the gap
    // never reached the threshold and the next rewrite never came due.
    const write = up.calls.find(
      (c) => c.url.includes("learner_ai_memory") && (c.body ?? "").includes("turns_total"),
    );
    assert(write, "expected the turn count to be recorded");
    const row = JSON.parse(write!.body!);
    assertEquals((Array.isArray(row) ? row[0] : row).turns_total, 5);
  });
});

Deno.test("learnerMemory reaches a rewrite for a learner who asks one question a session", async () => {
  // The case shouldRewrite is documented to serve: short conversations, days
  // apart. Each answered request advances the count by one, so the fourth one
  // is the one that pays for a rewrite.
  await withMemory(upstreamsFor(), async (mod, up) => {
    // Three sessions, one question each: nothing has been folded in yet
    // (turnsSeen stays 0) while the running total climbs.
    for (const total of [0, 1, 2]) {
      await mod.updateLearnerMemory({
        userId: USER,
        dialect: "Gulf",
        messages: exchange,
        assistantTurns: total + 1,
        current: { summary: "", openQuestions: [], turnsSeen: 0, turnsTotal: total },
      });
    }
    assertEquals(up.calls.filter((c) => c.url.includes("/chat/completions")).length, 0);

    // The fourth question is the one that pays for a rewrite.
    await mod.updateLearnerMemory({
      userId: USER,
      dialect: "Gulf",
      messages: exchange,
      assistantTurns: 4,
      current: { summary: "", openQuestions: [], turnsSeen: 0, turnsTotal: 3 },
    });
    assertEquals(up.calls.filter((c) => c.url.includes("/chat/completions")).length, 1);
  });
});

Deno.test("learnerMemory keeps the old notes when the rewrite comes back empty", async () => {
  await withMemory(
    upstreamsFor({ "generativelanguage.googleapis.com/v1beta/openai": rewriting({ summary: "", openQuestions: [] }) }),
    async (mod, up) => {
      await mod.updateLearnerMemory({
        userId: USER,
        dialect: "Gulf",
        messages: exchange,
        assistantTurns: 8,
        current: { summary: "Prefers examples before rules.", openQuestions: [], turnsSeen: 4, turnsTotal: 4 },
      });
      // An empty rewrite is a failed rewrite, not an instruction to forget.
      assert(!up.calls.some((c) => (c.body ?? "").includes("turns_seen")));
    },
  );
});

Deno.test("learnerMemory swallows a failed rewrite", async () => {
  for (const upstream of [
    { "generativelanguage.googleapis.com/v1beta/openai": () => json({ error: "no" }, 500) },
    { "/rest/v1/learner_ai_memory": () => json({ message: "denied" }, 403) },
  ]) {
    await withMemory(upstreamsFor(upstream as Record<string, UpstreamHandler>), async (mod) => {
      // Losing an update costs the next conversation a little context. It must
      // never surface to the learner mid-answer.
      await mod.updateLearnerMemory({
        userId: USER,
        dialect: "Gulf",
        messages: exchange,
        assistantTurns: 8,
        current: { summary: "s", openQuestions: [], turnsSeen: 4 },
      });
    });
  }
});

Deno.test("learnerMemory does nothing for a caller with no user", async () => {
  await withMemory(upstreamsFor(), async (mod, up) => {
    await mod.updateLearnerMemory({
      userId: "",
      dialect: "Gulf",
      messages: exchange,
      assistantTurns: 99,
    });
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("learnerMemory sends the recent exchange, not the whole conversation", async () => {
  await withMemory(upstreamsFor(), async (mod, up) => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    }));
    await mod.updateLearnerMemory({
      userId: USER,
      dialect: "Gulf",
      messages: long,
      assistantTurns: 20,
      current: { summary: "s", openQuestions: [], turnsSeen: 4 },
    });

    const sent = up.calls.find((c) => c.url.includes("/chat/completions"))?.body ?? "";
    // The notes describe how this learner learns, which a couple of exchanges
    // shows as well as forty do.
    assertStringIncludes(sent, "turn 39");
    assert(!sent.includes("turn 0\\n"), "the whole history should not be sent");
  });
});
