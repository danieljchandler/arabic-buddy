import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The Web Share Target's two server halves.
 *
 * `screen-shared-content` is the AI triage step: one forced tool call on the
 * cheapest model, deciding which feature a bare shared payload belongs to and
 * converting it on the way (a chat screenshot → the Arabic text inside it).
 * Its defining property is that a share never dead-ends: when the screener
 * fails, the payload still lands somewhere sensible.
 *
 * `ingest-shared-video` is the admin one-step pipeline: share a TikTok link,
 * get a discover_videos row and a running process-approved-video job. The
 * properties worth pinning are the gate (admin only — it writes content the
 * whole app serves), the dedup (re-sharing a video must not fork a second
 * pipeline run), and the kickoff (the pipeline call actually goes out with the
 * service-role key).
 */

const USER = "00000000-0000-4000-8000-000000000001";
const TIKTOK_URL = "https://www.tiktok.com/@creator/video/7301234567890123456";

/** Auth + caps + brain plumbing every call needs. */
function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    ...extra,
  };
}

/** The gateway answering with a forced `route_shared_content` tool call. */
const screening = (result: Record<string, unknown>): UpstreamHandler => () =>
  chatCompletion("", result);

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest(name, body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      requests: fn.calls,
    };
  } finally {
    fn.restore();
  }
}

// ── screen-shared-content ───────────────────────────────────────────────────

Deno.test("screen-shared-content routes Arabic text to translate", async () => {
  const { status, body } = await call(
    "screen-shared-content",
    { text: "شخبارك؟ وين رايح بكره؟", dialect: "Gulf" },
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": screening({
        destination: "translate",
        extracted_text: "شخبارك؟ وين رايح بكره؟",
        reason: "Gulf Arabic message to understand",
      }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.destination, "translate");
  assertEquals(body.extractedText, "شخبارك؟ وين رايح بكره؟");
  assertEquals(body.fallback, false);
});

Deno.test("screen-shared-content routes an English 'how do I say' ask", async () => {
  const { status, body } = await call(
    "screen-shared-content",
    { text: "how do I politely decline a coffee invitation?" },
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": screening({
        destination: "how_do_i_say",
        extracted_text: "politely decline a coffee invitation",
      }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.destination, "how_do_i_say");
  assertEquals(body.extractedText, "politely decline a coffee invitation");
});

Deno.test("screen-shared-content demands some content", async () => {
  const { status, body } = await call("screen-shared-content", {}, caller());

  assertEquals(status, 400);
  assertEquals(body.error, "missing_content");
});

Deno.test("screen-shared-content rejects a non-image payload posing as one", async () => {
  const { status, body } = await call(
    "screen-shared-content",
    { imageBase64: "data:text/html,<script>alert(1)</script>" },
    caller(),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "invalid_image");
});

Deno.test("a failed screener still lands shared text in translate", async () => {
  // The share must never dead-end on a model hiccup: text falls back to
  // translate carrying the original payload, flagged so the client knows.
  const { status, body } = await call(
    "screen-shared-content",
    { text: "مرحبا يا صديقي" },
    caller({ "generativelanguage.googleapis.com/v1beta/openai": () => json({ error: "overloaded" }, 500) }),
  );

  assertEquals(status, 200);
  assertEquals(body.destination, "translate");
  assertEquals(body.extractedText, "مرحبا يا صديقي");
  assertEquals(body.fallback, true);
});

Deno.test("a translate verdict with no text from a bare image degrades to meme", async () => {
  // The meme analyzer does its own OCR; translate with an empty box is the one
  // destination that renders nothing.
  const { status, body } = await call(
    "screen-shared-content",
    { imageBase64: `data:image/jpeg;base64,${btoa("fake jpeg")}` },
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": screening({ destination: "translate", extracted_text: "" }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.destination, "meme");
});

// ── ingest-shared-video ─────────────────────────────────────────────────────

/** Upstreams for a happy-path admin ingest of a fresh TikTok. */
function adminIngest(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return caller({
    "/rest/v1/user_roles": () => json({ role: "admin" }),
    "/rest/v1/discover_videos": (request) =>
      request.method === "POST"
        ? json({ id: "dv-fixture-1" }, 201)
        : json(null),
    "/rest/v1/content_import_logs": () => json({}, 201),
    "www.tiktok.com/oembed": () =>
      json({
        title: "وناسة الديرة",
        author_name: "creator",
        thumbnail_url: "https://cdn.test/thumb.jpg",
      }),
    "/functions/v1/process-approved-video": () =>
      json({ success: true, message: "Processing started" }, 202),
    ...extra,
  });
}

Deno.test("ingest-shared-video turns a shared TikTok into a running pipeline", async () => {
  const { status, body, calls, requests } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL, dialect: "Gulf" },
    adminIngest(),
  );

  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(body.alreadyExists, false);
  assertEquals(body.videoId, "dv-fixture-1");
  assertEquals(body.title, "وناسة الديرة");
  assertEquals(body.adminPath, "/admin/videos/dv-fixture-1/edit");

  // The row is created before the pipeline is asked to process it.
  const insert = requests.find(
    (c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST",
  );
  assert(insert, "expected a discover_videos insert");
  const record = JSON.parse(insert.body ?? "{}") as Record<string, unknown>;
  assertEquals(record.platform, "tiktok");
  assertEquals(record.published, false);
  assertEquals(record.transcription_status, "pending");
  assertEquals(record.created_by, USER);

  // The kickoff goes out under the service-role key, not the caller's JWT —
  // the pipeline outlives this request and the admin's session.
  const kickoff = requests.find((c) => c.url.includes("/functions/v1/process-approved-video"));
  assert(kickoff, "expected a process-approved-video kickoff");
  assertEquals(
    kickoff.headers["authorization"],
    "Bearer e2e-service-role-not-a-real-secret",
  );
  assertEquals(JSON.parse(kickoff.body ?? "{}"), { videoId: "dv-fixture-1" });

  // No Cobalt call from here: audio acquisition is the pipeline's job.
  assertEquals(calls.filter((u) => u.includes("cobalt") || u.includes("imput")).length, 0);
});

Deno.test("ingest-shared-video keeps its own copy of a still that expires", async () => {
  // TikTok's oEmbed answers with a *signed* URL — `x-expires` about
  // forty-eight hours out — so a row that stored it verbatim went blank two
  // days after the link was shared, with nobody having touched it. The copy
  // has to happen here rather than in the browser: the CDN serves the bytes
  // without CORS headers.
  const { requests } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL, dialect: "Gulf" },
    adminIngest({
      "www.tiktok.com/oembed": () =>
        json({
          title: "وناسة الديرة",
          thumbnail_url: "https://p16.tiktokcdn.test/obj/s.image?x-expires=1788613200&x-signature=a",
        }),
      "p16.tiktokcdn.test": () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      "/storage/v1/object/flashcard-images": () => json({ Key: "flashcard-images/x" }),
    }),
  );

  const insert = requests.find(
    (c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST",
  );
  const record = JSON.parse(insert?.body ?? "{}") as Record<string, unknown>;
  assertStringIncludes(
    String(record.thumbnail_url),
    "/storage/v1/object/public/flashcard-images/video-stills/",
  );
});

Deno.test("ingest-shared-video refuses anonymous callers", async () => {
  const { status, body } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL },
    caller(),
    { jwt: null },
  );

  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
});

Deno.test("ingest-shared-video refuses signed-in non-admins", async () => {
  const { status, body, calls } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL },
    caller(), // user_roles answers null — no admin row
  );

  assertEquals(status, 403);
  assertEquals(body.error, "admin_only");
  // Refused before anything is written or fetched.
  assertEquals(calls.filter((u) => u.includes("discover_videos")).length, 0);
});

Deno.test("ingest-shared-video rejects links it cannot parse", async () => {
  const { status, body } = await call(
    "ingest-shared-video",
    { url: "https://example.com/some/article" },
    adminIngest(),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "unsupported_url");
});

Deno.test("re-sharing an ingested video opens the existing row", async () => {
  const { status, body, calls } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL },
    adminIngest({
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET"
          ? json({ id: "dv-existing", title: "Already here", transcription_status: "completed" })
          : json({ id: "dv-should-not-insert" }, 201),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.alreadyExists, true);
  assertEquals(body.videoId, "dv-existing");
  // No second pipeline run for the same video.
  assertEquals(calls.filter((u) => u.includes("process-approved-video")).length, 0);
});

Deno.test("dedup escapes a video id that contains a LIKE wildcard", async () => {
  // YouTube ids and Instagram shortcodes legally contain "_", which LIKE
  // reads as "any single character". Unescaped, `abc_defghij` also matched a
  // different video's `abc-defghij`, and the share was dropped as a duplicate
  // of a row it has nothing to do with.
  const { calls } = await call(
    "ingest-shared-video",
    { url: "https://www.youtube.com/watch?v=abc_defghij" },
    adminIngest({
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET" ? json(null) : json({ id: "dv-new" }, 201),
    }),
  );

  const lookup = calls.find((u) => u.includes("discover_videos") && u.includes("source_url"));
  assert(lookup, "expected a dedup lookup");
  // The pattern carries the escape (%5C is a URL-encoded backslash), so the
  // underscore is matched literally.
  assert(
    lookup!.includes("%5C_") || lookup!.includes("\\_"),
    `expected the underscore to be escaped, got: ${lookup}`,
  );
});

Deno.test("a failed pipeline kickoff marks the row failed rather than stranding it", async () => {
  const { status, body, requests } = await call(
    "ingest-shared-video",
    { url: TIKTOK_URL },
    adminIngest({
      "/functions/v1/process-approved-video": () => json({ error: "boom" }, 500),
    }),
  );

  assertEquals(status, 502);
  assertEquals(body.error, "pipeline_start_failed");
  assertEquals(body.videoId, "dv-fixture-1");

  const patch = requests.find(
    (c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH",
  );
  assert(patch, "expected the row to be marked failed");
  const update = JSON.parse(patch.body ?? "{}") as Record<string, unknown>;
  assertEquals(update.transcription_status, "failed");
});
