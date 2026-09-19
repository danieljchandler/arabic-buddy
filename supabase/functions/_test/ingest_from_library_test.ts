import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * ingest-from-library — the content-library bridge's push half.
 *
 * Three properties are pinned. The gate is the shared secret and nothing
 * else: a valid admin JWT without the header is refused, because the caller
 * is another app and a JWT proves the wrong thing. The row carries what no
 * other door records — library_item_id and the creator — and the kickoff
 * goes out under the service-role key. And it is idempotent on the
 * library's id: a second send answers with the existing row rather than
 * forking a second pipeline run.
 */

const SECRET = "fixture-library-bridge-secret";
const ITEM = "11111111-2222-4333-8444-555555555555";
const BRIDGE_USER = "00000000-0000-4000-8000-0000000000aa";
const TIKTOK_URL = "https://www.tiktok.com/@abu.saleh/video/7301234567890123456";

function bridgeUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/rest/v1/discover_videos": (request) =>
      request.method === "POST" ? json({ id: "dv-fixture-lib" }, 201) : json(null),
    "/rest/v1/content_import_logs": () => json({}, 201),
    "/functions/v1/process-approved-video": () => json({ success: true }, 202),
    ...extra,
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, headers: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
  const fn = await loadFunction("ingest-from-library", {
    upstreams,
    env: { LIBRARY_BRIDGE_SECRET: SECRET, LIBRARY_BRIDGE_USER_ID: BRIDGE_USER, ...env },
  });
  try {
    const response = await fn.handler(jsonRequest("ingest-from-library", body, { jwt: null, headers }));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* status carries it */ }
    return { status: response.status, body: parsed, requests: fn.calls };
  } finally {
    fn.restore();
  }
}

const payload = {
  library_item_id: ITEM,
  source_url: TIKTOK_URL,
  platform: "tiktok",
  title: "فصال في سوق القات",
  language: "ar",
  dialect: "yemeni",
  subvariety: "sanaani",
  creator_name: "Abu Saleh",
  creator_handle: "@abu.saleh",
  note: "bargaining, slow and clear",
  tags: ["setting:shop"],
};

Deno.test("ingest-from-library refuses a caller without the shared secret, JWT or not", async () => {
  const noHeader = await call(payload, bridgeUpstreams());
  assertEquals(noHeader.status, 401);
  const wrong = await call(payload, bridgeUpstreams(), { "x-library-secret": "nope" });
  assertEquals(wrong.status, 401);
  // Unconfigured means closed, not open.
  const unset = await call(payload, bridgeUpstreams(), { "x-library-secret": SECRET }, { LIBRARY_BRIDGE_SECRET: undefined });
  assertEquals(unset.status, 401);
  assertEquals(noHeader.requests.filter((c) => c.url.includes("discover_videos")).length, 0);
});

Deno.test("ingest-from-library creates an attributed row and kicks the pipeline under the service role", async () => {
  const { status, body, requests } = await call(payload, bridgeUpstreams(), { "x-library-secret": SECRET });
  assertEquals(status, 200);
  assertEquals(body.remote_id, "dv-fixture-lib");
  assertEquals(body.status, "processing");
  assertEquals(body.remote_url, "/admin/videos/dv-fixture-lib/edit");

  const insert = requests.find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST");
  assert(insert, "expected a discover_videos insert");
  const record = JSON.parse(insert.body ?? "{}") as Record<string, unknown>;
  assertEquals(record.library_item_id, ITEM);
  assertEquals(record.creator_name, "Abu Saleh");
  assertEquals(record.creator_handle, "abu.saleh");
  assertEquals(record.dialect, "Yemeni");
  assertEquals(record.dialect_subvariety, "sanaani");
  assertEquals(record.published, false);
  assertEquals(record.transcription_status, "pending");
  // Attributed to a real account, never a placeholder id.
  assertEquals(record.created_by, BRIDGE_USER);

  const kickoff = requests.find((c) => c.url.includes("/functions/v1/process-approved-video"));
  assert(kickoff, "expected a process-approved-video kickoff");
  assertEquals(kickoff.headers["authorization"], "Bearer e2e-service-role-not-a-real-secret");
  assertEquals(JSON.parse(kickoff.body ?? "{}"), { videoId: "dv-fixture-lib" });
});

Deno.test("ingest-from-library is idempotent on the library's id", async () => {
  const { status, body, requests } = await call(
    payload,
    bridgeUpstreams({
      "/rest/v1/discover_videos": (request) =>
        request.method === "POST" ? json({ id: "should-not-insert" }, 201) : json({ id: "dv-existing", transcription_status: "completed" }),
    }),
    { "x-library-secret": SECRET },
  );
  assertEquals(status, 200);
  assertEquals(body.remote_id, "dv-existing");
  assertEquals(body.status, "completed");
  assertEquals(requests.filter((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST").length, 0);
  assertEquals(requests.filter((c) => c.url.includes("process-approved-video")).length, 0);
});

Deno.test("ingest-from-library stages mirrored audio where the pipeline looks first", async () => {
  const { body, requests } = await call(
    { ...payload, audio_url: "https://library.test/storage/v1/object/sign/item-files/x/audio.mp3?token=t" },
    bridgeUpstreams({
      "library.test": () => new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
      "/storage/v1/object/video-audio": () => json({ Key: "video-audio/dv-fixture-lib.mp3" }),
    }),
    { "x-library-secret": SECRET },
  );
  assertEquals(body.audio_staged, true);
  const upload = requests.find((c) => c.url.includes("/storage/v1/object/video-audio/dv-fixture-lib.mp3"));
  assert(upload, "expected the audio to be staged under the new row's id");
});

Deno.test("ingest-from-library answers a status query with the transcript's Arabic once complete", async () => {
  const { status, body } = await call(
    { action: "status", remote_id: "dv-fixture-lib" },
    bridgeUpstreams({
      "/rest/v1/discover_videos": () =>
        json({
          id: "dv-fixture-lib",
          transcription_status: "completed",
          transcription_error: null,
          published: false,
          title: "t",
          duration_seconds: 42,
          transcript_lines: [{ arabic: "وش تبا يا خال", translation: "what do you want, uncle" }, { arabic: "ولا شي", translation: "nothing" }],
        }),
    }),
    { "x-library-secret": SECRET },
  );
  assertEquals(status, 200);
  assertEquals(body.status, "completed");
  assertEquals(body.transcript_text, "وش تبا يا خال\nولا شي");
  assertEquals(body.duration_seconds, 42);
});

Deno.test("ingest-from-library refuses rather than attributing a row to nobody", async () => {
  // There is no user session on this door, so `created_by` comes from
  // configuration. Unset, the honest answer is 503 — a placeholder id would
  // leave content in the catalogue owned by an account that does not exist.
  const { status, body, requests } = await call(
    payload,
    bridgeUpstreams(),
    { "x-library-secret": SECRET },
    { LIBRARY_BRIDGE_USER_ID: undefined },
  );

  assertEquals(status, 503);
  assertEquals(body.error, "bridge_not_configured");
  assertEquals(requests.filter((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST").length, 0);
});
