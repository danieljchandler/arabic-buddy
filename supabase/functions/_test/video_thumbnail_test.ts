import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `persist-video-thumbnail` — why a video's picture used to disappear.
 *
 * TikTok's oEmbed does not answer with an address for a still, it answers with
 * a signed one: `x-expires` is roughly forty-eight hours out. Every row that
 * stored what the platform said showed a picture for two days and a broken
 * image after that, and pressing "Fetch thumbnail" again only minted another
 * two-day URL — which is why it looked like a fix and had to be repeated.
 *
 * This function is the actual fix — `_shared/thumbnailMirror.ts` does the
 * copying, `_shared/thumbnailUrlCore.ts` decides what needs copying — and it
 * lives on the server for a concrete reason: `p16-*.tiktokcdn-us.com` serves the image with no
 * `Access-Control-Allow-Origin`, so the admin's browser can display those
 * bytes and cannot read them to keep a copy. The assertions below are
 * therefore about what lands in the column — a URL of ours — and about the two
 * things that must never land there: a signed URL when a copy was possible,
 * and a CDN error page saved as if it were an image.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "22222222-0000-4000-8000-000000000000";

/** A still on loan, in the shape TikTok really answers with. */
const SIGNED_STILL =
  "https://p16.tiktokcdn.test/obj/still.image?x-expires=1788613200&x-signature=abc";

const A_PIXEL = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);

const aVideo = (over: Record<string, unknown> = {}) => ({
  id: VIDEO,
  platform: "tiktok",
  source_url: "https://www.tiktok.com/@creator/video/7451234567890123456",
  embed_url: "https://www.tiktok.com/player/v1/7451234567890123456",
  thumbnail_url: null,
  ...over,
});

function caller(
  video: Record<string, unknown> | null,
  extra: Record<string, UpstreamHandler> = {},
): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    "/rest/v1/discover_videos": (request) =>
      request.method === "GET" ? json(video) : json({}),
    // The oEmbed the function asks when the row carries no still.
    "www.tiktok.com/oembed": () => json({ thumbnail_url: SIGNED_STILL }),
    // The CDN, which answers the bytes happily — just not to a browser.
    "p16.tiktokcdn.test": () =>
      new Response(A_PIXEL, { status: 200, headers: { "content-type": "image/jpeg" } }),
    "/storage/v1/object/flashcard-images": () => json({ Key: "flashcard-images/x" }),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("persist-video-thumbnail", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("persist-video-thumbnail", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed, calls: fn.calls.map((c) => c.url), fn };
  } finally {
    fn.restore();
  }
}

/** What was written to the row, across every PATCH the function made. */
function storedThumbnail(fn: { callsTo: (m: string) => { body: string | null }[] }): string | null {
  const writes = fn
    .callsTo("/rest/v1/discover_videos")
    .map((c) => c.body)
    .filter((b): b is string => typeof b === "string" && b.includes("thumbnail_url"));
  const last = writes.at(-1);
  return last ? (JSON.parse(last) as { thumbnail_url: string }).thumbnail_url : null;
}

Deno.test("copies a still that expires into our own bucket", async () => {
  const { status, body, fn } = await call({ videoId: VIDEO }, caller(aVideo()));

  assertEquals(status, 200);
  assertEquals(body.mirrored, true);
  // The whole point: what goes on the row is ours and has no expiry on it.
  assertStringIncludes(
    String(body.thumbnailUrl),
    "/storage/v1/object/public/flashcard-images/video-stills/",
  );
  assertEquals(storedThumbnail(fn), body.thumbnailUrl);
  assert(!String(storedThumbnail(fn)).includes("x-expires"));
});

Deno.test("asks TikTok for a still the row does not have", async () => {
  const { calls } = await call({ videoId: VIDEO }, caller(aVideo()));

  assert(calls.some((url) => url.includes("tiktok.com/oembed")));
  assert(calls.some((url) => url.includes("p16.tiktokcdn.test")));
});

Deno.test("replaces a signed still already sitting on the row", async () => {
  // The rows this was written for: added weeks ago, blank ever since, and
  // nothing about them looked wrong at the time.
  const { status, body, fn } = await call(
    { videoId: VIDEO },
    caller(aVideo({ thumbnail_url: SIGNED_STILL })),
  );

  assertEquals(status, 200);
  assertEquals(body.mirrored, true);
  assert(!String(storedThumbnail(fn)).includes("x-expires"));
});

Deno.test("leaves a permanent still alone", async () => {
  // A copy of one of ours would spend storage to make a stable picture
  // slightly less stable, and re-asking the platform costs a call for nothing.
  const stored =
    "https://e2e.supabase.co/storage/v1/object/public/flashcard-images/video-stills/v.jpg";
  const { status, body, calls } = await call(
    { videoId: VIDEO },
    caller(aVideo({ thumbnail_url: stored })),
  );

  assertEquals(status, 200);
  assertEquals(body, { thumbnailUrl: stored, source: "stored", mirrored: false });
  assert(!calls.some((url) => url.includes("oembed")));
  assert(!calls.some((url) => url.includes("/storage/v1/object/flashcard-images")));
});

Deno.test("derives a YouTube still rather than asking anyone", async () => {
  // Permanent by construction — a pure function of the video id — so it is
  // stored as it is and nothing is copied.
  const { status, body } = await call(
    { videoId: VIDEO },
    caller(
      aVideo({
        platform: "youtube",
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embed_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      }),
    ),
  );

  assertEquals(status, 200);
  assertEquals(body.source, "derived");
  assertEquals(body.mirrored, false);
  assertEquals(body.thumbnailUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
});

Deno.test("stores a still the caller already has, copied if it expires", async () => {
  // The admin form's paths: a freshly parsed oEmbed (expires — copy it) and a
  // frame captured from an upload (already in our bucket — store it as is).
  const fromOembed = await call({ videoId: VIDEO, thumbnailUrl: SIGNED_STILL }, caller(aVideo()));
  assertEquals(fromOembed.body.source, "given");
  assertEquals(fromOembed.body.mirrored, true);

  const captured =
    "https://e2e.supabase.co/storage/v1/object/public/flashcard-images/tiktok-thumbs/f.jpg";
  const fromCapture = await call({ videoId: VIDEO, thumbnailUrl: captured }, caller(aVideo()));
  assertEquals(fromCapture.body.thumbnailUrl, captured);
  assertEquals(fromCapture.body.mirrored, false);
});

Deno.test("never stores the CDN's error page as an image", async () => {
  // An expired signature comes back 403 with an XML body. Storing those bytes
  // under a .jpg would turn a recoverable blank into a permanent one, so the
  // borrowed URL is kept instead — a picture for two days beats none — and the
  // response says the copy did not happen.
  const { status, body, fn } = await call(
    { videoId: VIDEO },
    caller(aVideo(), {
      "p16.tiktokcdn.test": () =>
        new Response("<Error><Code>AccessDenied</Code></Error>", {
          status: 403,
          headers: { "content-type": "application/xml" },
        }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.mirrored, false);
  assertEquals(storedThumbnail(fn), SIGNED_STILL);
  assert(!fn.callsTo("/storage/v1/object/flashcard-images").length);
});

Deno.test("tells a human what to do about Instagram", async () => {
  // No public oEmbed without a Facebook app token, so the only way to a still
  // is uploading the video and capturing a frame from it.
  const { status, body } = await call(
    { videoId: VIDEO },
    caller(
      aVideo({
        platform: "instagram",
        source_url: "https://www.instagram.com/reel/CxYzAbCdEfG/",
        embed_url: "https://www.instagram.com/p/CxYzAbCdEfG/embed",
      }),
    ),
  );

  assertEquals(status, 422);
  assertStringIncludes(String(body.message), "capture a frame");
});

Deno.test("says so when the platform has nothing", async () => {
  const { status, body } = await call(
    { videoId: VIDEO },
    caller(aVideo(), { "www.tiktok.com/oembed": () => json({}, 404) }),
  );

  assertEquals(status, 422);
  assertEquals(body.error, "no_thumbnail");
});

Deno.test("refuses a caller with no content role", async () => {
  // This writes `discover_videos` under the service role, so the gate here is
  // the one RLS would have applied — `can_manage_content()`.
  const { status } = await call(
    { videoId: VIDEO },
    caller(aVideo(), { "/rest/v1/user_roles": () => json([]) }),
  );

  assertEquals(status, 403);
});

Deno.test("refuses a caller with no token at all", async () => {
  const { status } = await call({ videoId: VIDEO }, caller(aVideo()), { jwt: null });
  assertEquals(status, 403);
});

Deno.test("needs a video that exists", async () => {
  const missing = await call({ videoId: VIDEO }, caller(null));
  assertEquals(missing.status, 404);

  const nameless = await call({}, caller(aVideo()));
  assertEquals(nameless.status, 400);
});
