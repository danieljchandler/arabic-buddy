import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * discover-video-audio hands a signed-in learner a short-lived URL for a
 * published video's own audio copy. What must hold: nobody signed out gets a
 * URL, nobody gets one for an unpublished video, the staged object is found
 * by the same extension order the pipeline writes, and "nothing staged" is a
 * clean answer rather than an error, so the player can fall into timer mode.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "aaaaaaaa-0000-4000-8000-000000000000";

function upstreams(options: {
  user?: string | null;
  published?: boolean;
  objects?: string[];
  sourceUrl?: string | null;
} = {}) {
  const { user = USER, published = true, objects = [`${VIDEO}.wav`], sourceUrl = null } = options;
  return {
    "/auth/v1/user": () =>
      user === null ? json({ message: "invalid claim" }, 401) : json({ id: user, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/discover_videos": () =>
      json([{ id: VIDEO, published, source_url: sourceUrl, embed_url: null }]),
    "/storage/v1/object/list/video-audio": async (request: Request) => {
      const { search } = (await request.json()) as { search?: string };
      return json(objects.filter((name) => name.includes(search ?? "")).map((name) => ({ name })));
    },
    "/storage/v1/object/sign/video-audio/": (request: Request) => {
      const path = new URL(request.url).pathname.split("/sign/video-audio/")[1];
      return json({ signedURL: `/object/sign/video-audio/${path}?token=fixture` });
    },
  };
}

Deno.test("discover-video-audio signs the staged wav for a signed-in learner", async () => {
  const fn = await loadFunction("discover-video-audio", { upstreams: upstreams() });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.path, `${VIDEO}.wav`);
    assert(String(body.url).includes(`/object/sign/video-audio/${VIDEO}.wav`));
    assert(String(body.url).includes("token=fixture"));
    // The service role signs; the caller's own token never reaches storage.
    const sign = fn.callsTo("/object/sign/video-audio/").at(-1);
    assert(sign);
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio turns a signed-out caller away before touching storage", async () => {
  const fn = await loadFunction("discover-video-audio", { upstreams: upstreams({ user: null }) });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }, { jwt: null }));
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, "auth_required");
    assertEquals(fn.callsTo("/storage/v1/").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio does not sign audio for an unpublished video", async () => {
  const fn = await loadFunction("discover-video-audio", { upstreams: upstreams({ published: false }) });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }));
    assertEquals(response.status, 404);
    assertEquals(fn.callsTo("/storage/v1/").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio prefers the extension order the pipeline writes", async () => {
  const fn = await loadFunction("discover-video-audio", {
    upstreams: upstreams({ objects: [`${VIDEO}.mp3`, `${VIDEO}.mp4`, `${VIDEO}.opus`] }),
  });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }));
    assertEquals((await response.json()).path, `${VIDEO}.mp4`);
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio falls back to the legacy YouTube-id key", async () => {
  const fn = await loadFunction("discover-video-audio", {
    upstreams: upstreams({ objects: ["kTKcSSW6NZw.wav"], sourceUrl: "https://youtube.com/shorts/kTKcSSW6NZw?si=x" }),
  });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }));
    assertEquals((await response.json()).path, "kTKcSSW6NZw.wav");
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio answers 'no audio' cleanly when nothing is staged", async () => {
  const fn = await loadFunction("discover-video-audio", { upstreams: upstreams({ objects: [] }) });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: VIDEO }));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { url: null, reason: "no_audio" });
  } finally {
    fn.restore();
  }
});

Deno.test("discover-video-audio rejects a malformed id", async () => {
  const fn = await loadFunction("discover-video-audio", { upstreams: upstreams() });
  try {
    const response = await fn.handler(jsonRequest("discover-video-audio", { videoId: "../etc/passwd" }));
    assertEquals(response.status, 400);
  } finally {
    fn.restore();
  }
});
