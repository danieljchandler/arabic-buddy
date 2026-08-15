import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `contentRetrieval` — the reader for the semantic content index.
 *
 * The index and its RPC shipped in Sprint 3 and nothing ever called them.
 * This module is that caller, and its defining property is that it cannot
 * fail loudly: the migration that creates `content_embeddings` is guarded on
 * pgvector being available, so on a database without the extension the table
 * and the RPC simply do not exist. Every such path has to degrade to "no
 * related material" — an assistant answer is not worth losing over a
 * nice-to-have paragraph.
 */

const VIDEO_A = "11111111-2222-4333-8444-555555555551";
const VIDEO_B = "11111111-2222-4333-8444-555555555552";

interface RetrievalModule {
  retrieveRelatedContent(opts: {
    query: string;
    dialect: string;
    excludeSourceId?: string;
    max?: number;
  }): Promise<Array<{ kind: string; sourceId: string; content: string; label?: string }>>;
  relatedContentBlock(opts: { query: string; dialect: string; excludeSourceId?: string }): Promise<string>;
}

const embeddings = (): UpstreamHandler => async (request) => {
  const body = JSON.parse((await request.text()) || "{}");
  const inputs: string[] = Array.isArray(body.input) ? body.input : [];
  return json({ data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3] })) });
};

const matches = (rows: unknown[]): UpstreamHandler => () => json(rows);

function upstreamsFor(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "api.openai.com": embeddings(),
    "/rest/v1/rpc/match_content": matches([
      {
        kind: "video_line",
        source_id: VIDEO_A,
        chunk_index: 4,
        dialect: "Gulf",
        content: "شف هالتمر\nlook at these dates",
        similarity: 0.82,
      },
      {
        kind: "video_line",
        source_id: VIDEO_A,
        chunk_index: 9,
        dialect: "Gulf",
        content: "التمر حلو\nthe dates are sweet",
        similarity: 0.61,
      },
      {
        kind: "vocabulary_word",
        source_id: "33333333-4444-4555-8666-777777777777",
        chunk_index: 0,
        dialect: "Gulf",
        content: "تمر\ndates",
        similarity: 0.77,
      },
    ]),
    "/rest/v1/discover_videos": () => json([{ id: VIDEO_A, title: "Souq tour" }]),
    ...extra,
  };
}

async function withRetrieval(
  upstreams: Record<string, UpstreamHandler>,
  run: (mod: RetrievalModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ upstreams });
  try {
    await run(await loadSharedModule<RetrievalModule>("contentRetrieval"), up);
  } finally {
    up.restore();
  }
}

Deno.test("contentRetrieval returns the nearest library material, one per source", async () => {
  await withRetrieval(upstreamsFor(), async (mod) => {
    const chunks = await mod.retrieveRelatedContent({
      query: "what does tamr mean here?",
      dialect: "Gulf",
    });

    assertEquals(chunks.length, 2);
    // Two lines of the same video collapse to its best match.
    assertEquals(chunks.filter((c) => c.sourceId === VIDEO_A).length, 1);
    assertEquals(chunks[0].content, "شف هالتمر\nlook at these dates");
  });
});

Deno.test("contentRetrieval labels video matches with a title a learner would recognise", async () => {
  await withRetrieval(upstreamsFor(), async (mod) => {
    const block = await mod.relatedContentBlock({
      query: "what does tamr mean here?",
      dialect: "Gulf",
    });
    assertStringIncludes(block, "from a video: Souq tour");
    assertStringIncludes(block, "related, not authoritative");
  });
});

Deno.test("contentRetrieval never cites the video already on screen", async () => {
  await withRetrieval(upstreamsFor(), async (mod) => {
    const chunks = await mod.retrieveRelatedContent({
      query: "what does tamr mean here?",
      dialect: "Gulf",
      excludeSourceId: VIDEO_A,
    });
    assert(chunks.every((c) => c.sourceId !== VIDEO_A));
  });
});

Deno.test("contentRetrieval asks the index only for the caller's dialect", async () => {
  await withRetrieval(upstreamsFor(), async (mod, up) => {
    await mod.retrieveRelatedContent({ query: "what does tamr mean here?", dialect: "Egyptian" });
    const rpc = up.calls.find((c) => c.url.includes("match_content"));
    assert(rpc, "expected a match_content call");
    assertStringIncludes(rpc!.body ?? "", '"match_dialect":"Egyptian"');
  });
});

Deno.test("contentRetrieval degrades to nothing when the index is missing", async () => {
  // What a database without pgvector actually does: the guarded migration
  // created no table and no function, so PostgREST 404s the RPC.
  await withRetrieval(
    upstreamsFor({
      "/rest/v1/rpc/match_content": () =>
        json({ message: 'function public.match_content(...) does not exist' }, 404),
    }),
    async (mod) => {
      assertEquals(await mod.retrieveRelatedContent({ query: "a real question", dialect: "Gulf" }), []);
      assertEquals(await mod.relatedContentBlock({ query: "a real question", dialect: "Gulf" }), "");
    },
  );
});

Deno.test("contentRetrieval degrades to nothing when embedding fails", async () => {
  await withRetrieval(
    upstreamsFor({ "api.openai.com": () => json({ error: "down" }, 500) }),
    async (mod) => {
      assertEquals(await mod.retrieveRelatedContent({ query: "a real question", dialect: "Gulf" }), []);
    },
  );
});

Deno.test("contentRetrieval keeps the matches when only the title lookup fails", async () => {
  await withRetrieval(
    upstreamsFor({ "/rest/v1/discover_videos": () => json({ message: "boom" }, 500) }),
    async (mod) => {
      const chunks = await mod.retrieveRelatedContent({
        query: "what does tamr mean here?",
        dialect: "Gulf",
      });
      assertEquals(chunks.length, 2);
      assertEquals(chunks[0].label, undefined);
    },
  );
});

Deno.test("contentRetrieval does not spend a call on an acknowledgement", async () => {
  await withRetrieval(upstreamsFor(), async (mod, up) => {
    assertEquals(await mod.retrieveRelatedContent({ query: "thanks", dialect: "Gulf" }), []);
    assertEquals(up.calls.filter((c) => c.url.includes("openai")).length, 0);
  });
});
