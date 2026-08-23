import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The clip pipeline's mining and verification stages.
 *
 * `mine-clip-candidates` is deterministic and cheap: it expands a concept's
 * per-dialect realizations (surface + spelling variants) into caption-index
 * searches and writes pending clip_candidates. The property that matters most
 * is the variant mechanism: Arabic clitics mean الكلب must be findable when
 * the concept's surface is كلب, and the word-boundary re-check must stop كلب
 * from matching inside e.g. كلبش.
 *
 * `verify-clip-candidate` is the automation's spine: independent verifiers
 * (term, markers, playability, LLM judge) tier a candidate into
 * verified / needs_review / rejected. The tiering rules under test:
 * everything green auto-verifies, a safety fail hard-rejects, and a judge
 * outage can only ever land in needs_review — nothing auto-publishes
 * unjudged.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const CONCEPT = "11111111-1111-4111-8111-111111111111";
const LINE = "22222222-2222-4222-8222-222222222222";
const VIDEO = "33333333-3333-4333-8333-333333333333";
const CANDIDATE = "44444444-4444-4444-8444-444444444444";

const GULF_CHANNEL = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Moshaya Family",
  dialect: "Gulf",
  status: "approved",
};

const captionHit = {
  id: LINE,
  video_id: VIDEO,
  start_ms: 10000,
  end_ms: 14000,
  text: "شوف الكلب وايد كبير",
  text_normalized: "شوف الكلب وايد كبير",
  dialect_score: 0.9,
  msa_score: 0,
  source: "auto",
  channel_videos: {
    id: VIDEO,
    yt_video_id: "abc123xyz00",
    availability: "available",
    embeddable: true,
    content_channels: GULF_CHANNEL,
  },
};

// ---------- mine-clip-candidates ----------

function minerUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/vocab_concepts": () => json([{ id: CONCEPT, key: "dog", english_gloss: "dog" }]),
    "/rest/v1/concept_realizations": () =>
      json([{ concept_id: CONCEPT, surface: "كلب", variants: ["الكلب"] }]),
    "/rest/v1/caption_lines": (request) =>
      request.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-range": "*/1" } })
        : json([captionHit]),
    "/rest/v1/clip_candidates": (request) =>
      request.method === "GET" ? json([]) : json(null, 201),
    ...extra,
  };
}

async function callMiner(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("mine-clip-candidates", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("mine-clip-candidates", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      inserts: fn
        .callsTo("/rest/v1/clip_candidates")
        .filter((c) => c.method === "POST")
        .map((c) => JSON.parse(c.body ?? "[]")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("mine-clip-candidates finds a clip through a spelling variant", async () => {
  const { status, body, inserts } = await callMiner(
    { conceptKey: "dog", dialect: "Gulf" },
    minerUpstreams(),
  );

  assertEquals(status, 200);
  assertEquals(body.mined, 1);

  // Surface كلب alone cannot match الكلب at a word boundary — the variant is
  // what found this line, and the stored evidence must say so.
  const [rows] = inserts;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].concept_id, CONCEPT);
  assertEquals(rows[0].caption_line_id, LINE);
  assertEquals(rows[0].status, "pending");
  assertEquals(rows[0].verification.mined.term, "الكلب");
  assertEquals(rows[0].start_ms, 10000);
  assertEquals(rows[0].end_ms, 14000);
});

Deno.test("mine-clip-candidates skips lines that only contain the word inside another", async () => {
  // كلبش (a different word) must not count as a hit for كلب — the FTS fake
  // returns the line anyway, so the word-boundary re-check is what's tested.
  const bogus = {
    ...captionHit,
    text: "شفت كلبش هناك",
    text_normalized: "شفت كلبش هناك",
  };
  const { status, body, inserts } = await callMiner(
    { conceptKey: "dog", dialect: "Gulf" },
    minerUpstreams({
      "/rest/v1/caption_lines": () => json([bogus]),
      "/rest/v1/concept_realizations": () =>
        json([{ concept_id: CONCEPT, surface: "كلب", variants: [] }]),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.mined, 0);
  assertEquals(inserts.length, 0);
});

Deno.test("mine-clip-candidates never resurfaces a line that already has a candidate", async () => {
  const { body, inserts } = await callMiner(
    { conceptKey: "dog", dialect: "Gulf" },
    minerUpstreams({
      "/rest/v1/clip_candidates": (request) =>
        request.method === "GET" ? json([{ caption_line_id: LINE }]) : json(null, 201),
    }),
  );

  assertEquals(body.mined, 0);
  assertEquals(inserts.length, 0);
});

Deno.test("mine-clip-candidates explains an empty caption index instead of a bare zero", async () => {
  // The most common first-run failure: harvested videos, never fetched
  // captions. The 0 must carry its diagnosis.
  const { body } = await callMiner(
    { conceptKey: "dog", dialect: "Gulf" },
    minerUpstreams({
      "/rest/v1/caption_lines": (request) =>
        request.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-range": "*/0" } })
          : json([]),
    }),
  );
  assertEquals(body.mined, 0);
  assertEquals(body.captionLinesIndexed, 0);
  assert(String(body.note).includes("fetch-captions"));
});

Deno.test("mine-clip-candidates suggests variants when the index has lines but none match", async () => {
  const { body } = await callMiner(
    { dialect: "Gulf", terms: ["زرافه"] },
    minerUpstreams({
      "/rest/v1/caption_lines": (request) =>
        request.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-range": "*/1" } })
          : json([]),
    }),
  );
  assertEquals(body.mined, 0);
  assert(String(body.note).includes("الكلب"));
});

Deno.test("mine-clip-candidates leaves ad-hoc mining unattributed to any concept", async () => {
  // Without a conceptKey, an ad-hoc term must not attach to whichever
  // concept happens to sort first.
  const { inserts } = await callMiner(
    { dialect: "Gulf", terms: ["وايد"] },
    minerUpstreams(),
  );
  assertEquals(inserts[0][0].concept_id, null);
  assertEquals(inserts[0][0].verification.mined.term, "وايد");
});

Deno.test("mine-clip-candidates requires a dialect", async () => {
  const { status } = await callMiner({ conceptKey: "dog" }, minerUpstreams());
  assertEquals(status, 400);
});

Deno.test("mine-clip-candidates is content-manager only", async () => {
  const { status } = await callMiner(
    { conceptKey: "dog", dialect: "Gulf" },
    minerUpstreams({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(status, 403);
});

// ---------- harvest-channel-videos ----------

const CHANNEL_ROW = {
  id: GULF_CHANNEL.id,
  name: "Moshaya Family",
  handle: null,
  yt_channel_id: "UCmoshaya00000000000000",
  last_harvested_at: null,
};

function harvesterUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/content_channels": (request) =>
      request.method === "GET" ? json([CHANNEL_ROW]) : new Response(null, { status: 204 }),
    "/rest/v1/channel_videos": () => new Response(null, { status: 201 }),
    "www.googleapis.com/youtube/v3/playlistItems": () =>
      json({
        items: [
          {
            snippet: { title: "يوم في البيت" },
            contentDetails: { videoId: "vid00000001", videoPublishedAt: "2026-08-01T00:00:00Z" },
          },
          {
            snippet: { title: "فيلم طويل" },
            contentDetails: { videoId: "vid00000002", videoPublishedAt: "2026-08-02T00:00:00Z" },
          },
        ],
      }),
    "www.googleapis.com/youtube/v3/videos": () =>
      json({
        items: [
          // In the 45s-15min window: kept.
          { id: "vid00000001", contentDetails: { duration: "PT3M20S", caption: "false" }, status: { embeddable: true } },
          // Feature-length: filtered out.
          { id: "vid00000002", contentDetails: { duration: "PT2H1M", caption: "false" }, status: { embeddable: true } },
        ],
      }),
    ...extra,
  };
}

async function callHarvester(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("harvest-channel-videos", {
    env: { YOUTUBE_API_KEY: "yt-key" },
    upstreams,
  });
  try {
    const response = await fn.handler(jsonRequest("harvest-channel-videos", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      calls: fn.calls.map((c) => `${c.method} ${c.url}`),
      upserts: fn
        .callsTo("/rest/v1/channel_videos")
        .filter((c) => c.method === "POST")
        .map((c) => JSON.parse(c.body ?? "[]")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("harvest-channel-videos enumerates uploads and keeps only clip-length videos", async () => {
  const { status, body, calls, upserts } = await callHarvester({}, harvesterUpstreams());

  assertEquals(status, 200, JSON.stringify(body));
  const harvested = body.harvested as Array<{ channel: string; videos: number }>;
  assertEquals(harvested[0].videos, 1, JSON.stringify({ body, calls }));

  const [rows] = upserts;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].yt_video_id, "vid00000001");
  assertEquals(rows[0].duration_seconds, 200);
  assertEquals(rows[0].embeddable, true);
});

Deno.test("harvest-channel-videos reports a channel it cannot resolve instead of spending search quota", async () => {
  const { body, upserts } = await callHarvester(
    {},
    harvesterUpstreams({
      "/rest/v1/content_channels": (request) =>
        request.method === "GET"
          ? json([{ ...CHANNEL_ROW, yt_channel_id: null, handle: null }])
          : new Response(null, { status: 204 }),
    }),
  );
  const harvested = body.harvested as Array<{ unresolved?: boolean }>;
  assertEquals(harvested[0].unresolved, true);
  assert(String(body.note).includes("handle"));
  assertEquals(upserts.length, 0);
});

Deno.test("harvest-channel-videos is content-manager only", async () => {
  const { status } = await callHarvester(
    {},
    harvesterUpstreams({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(status, 403);
});

// ---------- index-channel-captions ----------

function indexerUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/channel_videos": (request) => {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (request.method === "GET") {
        return json([
          {
            id: VIDEO,
            yt_video_id: "abc123xyz00",
            channel_id: GULF_CHANNEL.id,
            content_channels: { id: GULF_CHANNEL.id, name: GULF_CHANNEL.name, dialect: "Gulf" },
          },
        ]);
      }
      return new Response(null, { status: 204 });
    },
    "/rest/v1/caption_lines": (request) => {
      if (request.method === "GET") return json([]);
      if (request.method === "POST") return new Response(null, { status: 201 });
      return new Response(null, { status: 204 });
    },
    "/rest/v1/content_channels": () => new Response(null, { status: 204 }),
    "api.supadata.ai": () =>
      json({
        lang: "ar",
        content: [
          { text: "هذا كلب وايد كبير", offset: 10000, duration: 4000 },
          { text: "[موسيقى]", offset: 15000, duration: 1000 },
        ],
      }),
    ...extra,
  };
}

async function callIndexer(body: unknown, upstreams: Record<string, UpstreamHandler>, env?: Record<string, string>) {
  const fn = await loadFunction("index-channel-captions", {
    env: { SUPADATA_API_KEY: "supa-key", ...env },
    upstreams,
  });
  try {
    const response = await fn.handler(jsonRequest("index-channel-captions", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      inserts: fn
        .callsTo("/rest/v1/caption_lines")
        .filter((c) => c.method === "POST")
        .map((c) => JSON.parse(c.body ?? "[]")),
      videoPatches: fn
        .callsTo("/rest/v1/channel_videos")
        .filter((c) => c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("index-channel-captions indexes a transcript, scored and music-lines dropped", async () => {
  const { status, body, inserts, videoPatches } = await callIndexer({}, indexerUpstreams());

  assertEquals(status, 200, JSON.stringify(body));
  assertEquals(body.indexed, 1);

  const [rows] = inserts;
  // The [موسيقى] marker line is dropped; the speech line lands scored.
  assertEquals(rows.length, 1);
  assertEquals(rows[0].start_ms, 10000);
  assertEquals(rows[0].end_ms, 14000);
  assertEquals(rows[0].text, "هذا كلب وايد كبير");
  assert(rows[0].dialect_score > 0); // وايد is Gulf evidence
  assertEquals(rows[0].msa_score, 0);
  assertEquals(videoPatches[0].caption_status, "auto");
});

Deno.test("index-channel-captions marks caption-less videos for the ASR pool", async () => {
  const { body, inserts, videoPatches } = await callIndexer(
    {},
    indexerUpstreams({ "api.supadata.ai": () => new Response("not found", { status: 404 }) }),
  );
  assertEquals(body.indexed, 0);
  assertEquals(body.noCaptions, 1);
  assertEquals(inserts.length, 0);
  assertEquals(videoPatches[0].caption_status, "none");
});

Deno.test("index-channel-captions fails loudly on a bad key instead of marking the corpus caption-less", async () => {
  const { status, body } = await callIndexer(
    {},
    indexerUpstreams({ "api.supadata.ai": () => new Response("invalid key", { status: 401 }) }),
  );
  assertEquals(status, 500);
  assert(String(body.error).includes("401"));
});

Deno.test("index-channel-captions explains a missing API key", async () => {
  const { status, body } = await callIndexer({}, indexerUpstreams(), { SUPADATA_API_KEY: "" });
  assertEquals(status, 500);
  assert(String(body.error).includes("supadata.ai"));
});

// ---------- draft-concept-realizations ----------

function drafterUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/vocab_concepts": () =>
      json([{ id: CONCEPT, key: "dog", english_gloss: "dog", category: "animals" }]),
    "/rest/v1/concept_realizations": (request) =>
      request.method === "GET" ? json([]) : json(null, 201),
    "ai.gateway.lovable.dev": () =>
      chatCompletion("", {
        realizations: [
          {
            concept_key: "dog",
            surface: "كلب",
            // كلب itself normalizes equal to the surface and must be dropped;
            // the definite form is the variant that matters for caption search.
            variants: ["الكلب", "كلب"],
            phonetic: "kalb",
          },
          { concept_key: "unknown_concept", surface: "قط", variants: [] },
        ],
      }),
    ...extra,
  };
}

async function callDrafter(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("draft-concept-realizations", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("draft-concept-realizations", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      inserts: fn
        .callsTo("/rest/v1/concept_realizations")
        .filter((c) => c.method === "POST")
        .map((c) => JSON.parse(c.body ?? "[]")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("draft-concept-realizations drafts variants and drops model noise", async () => {
  const { status, body, inserts } = await callDrafter({ dialect: "Gulf" }, drafterUpstreams());

  assertEquals(status, 200, JSON.stringify(body));
  assertEquals(body.drafted, 1);

  const [rows] = inserts;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].concept_id, CONCEPT);
  assertEquals(rows[0].dialect, "Gulf");
  assertEquals(rows[0].surface, "كلب");
  // The surface-equal variant is deduped; the definite form survives. The
  // hallucinated concept_key never reaches the table.
  assertEquals(rows[0].variants, ["الكلب"]);
  assertEquals(rows[0].status, "draft");
});

Deno.test("draft-concept-realizations skips concepts that already have realizations", async () => {
  const { body, inserts } = await callDrafter(
    { dialect: "Gulf" },
    drafterUpstreams({
      "/rest/v1/concept_realizations": (request) =>
        request.method === "GET" ? json([{ concept_id: CONCEPT }]) : json(null, 201),
    }),
  );
  assertEquals(body.drafted, 0);
  assertEquals(inserts.length, 0);
});

Deno.test("draft-concept-realizations is content-manager only", async () => {
  const { status } = await callDrafter(
    { dialect: "Gulf" },
    drafterUpstreams({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(status, 403);
});

// ---------- verify-clip-candidate ----------

const pendingCandidate = {
  id: CANDIDATE,
  concept_id: null,
  video_id: VIDEO,
  caption_line_id: LINE,
  start_ms: 10000,
  end_ms: 14000,
  status: "pending",
  verification: { mined: { term: "كلب" } },
  channel_videos: {
    id: VIDEO,
    yt_video_id: "abc123xyz00",
    availability: "available",
    embeddable: true,
    content_channels: { id: GULF_CHANNEL.id, name: GULF_CHANNEL.name, dialect: "Gulf" },
  },
};

const contextLines = [
  { id: "context-1", start_ms: 4000, text: "يلا نطلع للحوش" },
  { id: LINE, start_ms: 10000, text: "هذا كلب وايد كبير" },
  { id: "context-2", start_ms: 16000, text: "تعال شوف شلونه يلعب" },
];

const verdict = (overrides: Partial<Record<string, unknown>> = {}): UpstreamHandler => () =>
  chatCompletion(
    "",
    {
      is_target_dialect: true,
      contains_target: true,
      family_friendly: true,
      beginner_friendly: true,
      reason: "Short, concrete, Gulf.",
      ...overrides,
    },
  );

function verifierUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/caption_lines": () => json(contextLines),
    "/rest/v1/clip_candidates": (request) => {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (request.method === "GET") return json([pendingCandidate]);
      return new Response(null, { status: 204 });
    },
    "ai.gateway.lovable.dev": verdict(),
    ...extra,
  };
}

async function callVerifier(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("verify-clip-candidate", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("verify-clip-candidate", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      patches: fn
        .callsTo("/rest/v1/clip_candidates")
        .filter((c) => c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("verify-clip-candidate auto-verifies when every check agrees", async () => {
  const { status, body, patches } = await callVerifier({ candidateId: CANDIDATE }, verifierUpstreams());

  assertEquals(status, 200, JSON.stringify(body));
  assertEquals(body.processed, 1);
  assertEquals(patches.length, 1);
  assertEquals(patches[0].status, "verified");

  // The audit trail must carry each verifier's evidence, not just the tier.
  const verification = patches[0].verification as Record<string, Record<string, unknown>>;
  assertEquals(verification.term.pass, true);
  assertEquals(verification.term.matched, "كلب");
  assertEquals(verification.markers.pass, true);
  assertEquals(verification.playability.pass, true);
  assertEquals((verification.judge as { family_friendly?: boolean }).family_friendly, true);
  assert(typeof verification.decidedAt === "string");
});

Deno.test("verify-clip-candidate hard-rejects on a safety fail", async () => {
  const { patches } = await callVerifier(
    { candidateId: CANDIDATE },
    verifierUpstreams({
      "ai.gateway.lovable.dev": verdict({ family_friendly: false, reason: "Profanity." }),
    }),
  );
  assertEquals(patches[0].status, "rejected");
});

Deno.test("verify-clip-candidate holds for review when the judge dissents on dialect", async () => {
  const { patches } = await callVerifier(
    { candidateId: CANDIDATE },
    verifierUpstreams({
      "ai.gateway.lovable.dev": verdict({ is_target_dialect: false, reason: "Sounds Egyptian." }),
    }),
  );
  assertEquals(patches[0].status, "needs_review");
});

Deno.test("verify-clip-candidate never auto-verifies through a judge outage", async () => {
  const { patches } = await callVerifier(
    { candidateId: CANDIDATE },
    verifierUpstreams({
      "ai.gateway.lovable.dev": () => new Response("upstream down", { status: 500 }),
    }),
  );
  // Every deterministic check passes, but unjudged content parks in the
  // audit queue rather than publishing.
  assertEquals(patches[0].status, "needs_review");
  const verification = patches[0].verification as Record<string, Record<string, unknown>>;
  assert(typeof (verification.judge as { error?: string }).error === "string");
});

Deno.test("verify-clip-candidate rejects when the target word is not in the line", async () => {
  const { patches } = await callVerifier(
    { candidateId: CANDIDATE },
    verifierUpstreams({
      "/rest/v1/caption_lines": () =>
        json([{ id: LINE, start_ms: 10000, text: "هذا قط صغير" }]),
    }),
  );
  assertEquals(patches[0].status, "rejected");
});

// ---------- publish-verified-clips ----------

const verifiedCandidate = {
  id: CANDIDATE,
  concept_id: CONCEPT,
  caption_line_id: LINE,
  start_ms: 10000,
  end_ms: 14000,
  verification: {
    mined: { term: "كلب", line_text: "هذا كلب وايد كبير" },
    term: { matched: "كلب" },
  },
  channel_videos: {
    yt_video_id: "abc123xyz00",
    content_channels: { name: GULF_CHANNEL.name, dialect: "Gulf" },
  },
};

function publisherUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "content_reviewer" }]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/vocab_concepts": () => json({ english_gloss: "dog" }),
    "/rest/v1/clip_candidates": (request) => {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-range": "*/0" } });
      }
      if (request.method === "GET") return json([verifiedCandidate]);
      return new Response(null, { status: 204 });
    },
    "/rest/v1/published_clips": () => json(null, 201),
    "ai.gateway.lovable.dev": () =>
      chatCompletion("", { translation: "This dog is really big", transliteration: "hatha kalb wayid kabeer" }),
    ...extra,
  };
}

async function callPublisher(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("publish-verified-clips", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("publish-verified-clips", body));
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
      inserts: fn
        .callsTo("/rest/v1/published_clips")
        .filter((c) => c.method === "POST")
        .map((c) => JSON.parse(c.body ?? "{}")),
      patches: fn
        .callsTo("/rest/v1/clip_candidates")
        .filter((c) => c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}")),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("publish-verified-clips translates and publishes a verified candidate", async () => {
  const { status, body, inserts, patches } = await callPublisher({}, publisherUpstreams());

  assertEquals(status, 200, JSON.stringify(body));
  assertEquals(body.published, 1);

  // The learner row carries everything playback and save-word need.
  assertEquals(inserts.length, 1);
  const row = inserts[0];
  assertEquals(row.yt_video_id, "abc123xyz00");
  assertEquals(row.start_ms, 10000);
  assertEquals(row.end_ms, 14000);
  assertEquals(row.term, "كلب");
  assertEquals(row.term_gloss, "dog");
  assertEquals(row.arabic, "هذا كلب وايد كبير");
  assertEquals(row.translation, "This dog is really big");
  assertEquals(row.dialect, "Gulf");

  assertEquals(patches.length, 1);
  assertEquals(patches[0].status, "published");
});

Deno.test("publish-verified-clips never ships a clip without a translation", async () => {
  const { body, inserts, patches } = await callPublisher(
    {},
    publisherUpstreams({
      "ai.gateway.lovable.dev": () => new Response("down", { status: 500 }),
    }),
  );

  // Left 'verified' for the next run — not published untranslated, not lost.
  assertEquals(body.published, 0);
  assertEquals(inserts.length, 0);
  assertEquals(patches.length, 0);
  const skipped = body.skipped as Array<{ reason: string }>;
  assertEquals(skipped[0].reason, "translation unavailable");
});

Deno.test("publish-verified-clips is content-manager only", async () => {
  const { status } = await callPublisher(
    {},
    publisherUpstreams({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(status, 403);
});

Deno.test("verify-clip-candidate is gated, with a pipeline-secret path for automation", async () => {
  // No JWT, no secret: refused.
  const closed = await loadFunction("verify-clip-candidate", { upstreams: verifierUpstreams() });
  try {
    const refused = await closed.handler(
      jsonRequest("verify-clip-candidate", {}, { jwt: null }),
    );
    assertEquals(refused.status, 403);
  } finally {
    closed.restore();
  }

  // Matching secret, no JWT: the automation loop's path.
  const open = await loadFunction("verify-clip-candidate", {
    env: { CLIP_PIPELINE_SECRET: "cron-secret" },
    upstreams: verifierUpstreams(),
  });
  try {
    const allowed = await open.handler(
      jsonRequest("verify-clip-candidate", { candidateId: CANDIDATE }, {
        jwt: null,
        headers: { "x-pipeline-secret": "cron-secret" },
      }),
    );
    assertEquals(allowed.status, 200);
  } finally {
    open.restore();
  }
});
