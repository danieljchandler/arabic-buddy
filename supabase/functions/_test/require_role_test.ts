import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FIXTURE_ENV, jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json } from "./upstreams.ts";

/**
 * The authorization gate in front of every service-role write to catalogue
 * content.
 *
 * The distinction it exists to draw is the one `verify_jwt` does not: the
 * publishable key is a valid project JWT and ships in the browser bundle, and a
 * bare `auth.getUser()` only proves someone completed a free signup. Neither is
 * permission to rewrite a published transcript.
 *
 * Driven through `backfill-literal-translations` — the smallest caller, and the
 * one that previously had no authentication at all.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function backend(roles: Array<{ role: string }>) {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json(roles),
    "/rest/v1/": () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "*/0" },
      }),
  };
}

Deno.test("requireRole: a signed-in learner with no staff role is refused", async () => {
  const { handler } = await loadFunction("backfill-literal-translations", {
    upstreams: backend([]),
  });
  const res = await handler(
    jsonRequest("backfill-literal-translations", { limit: 1 }, { jwt: "learner-jwt" }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "forbidden");
});

Deno.test("requireRole: a content_reviewer is allowed through", async () => {
  const { handler } = await loadFunction("backfill-literal-translations", {
    upstreams: backend([{ role: "content_reviewer" }]),
  });
  const res = await handler(
    jsonRequest("backfill-literal-translations", { limit: 1 }, { jwt: "reviewer-jwt" }),
  );
  assert(res.status < 400, `expected the gate to pass, got ${res.status}`);
});

Deno.test("requireRole: no Authorization header is 401, not 403", async () => {
  const { handler } = await loadFunction("backfill-literal-translations", {
    upstreams: backend([]),
  });
  const res = await handler(jsonRequest("backfill-literal-translations", { limit: 1 }, { jwt: null }));
  assertEquals(res.status, 401);
});

Deno.test("requireRole: the service-role key is the internal bypass", async () => {
  const { handler } = await loadFunction("backfill-literal-translations", {
    upstreams: backend([]),
  });
  const res = await handler(
    jsonRequest("backfill-literal-translations", { limit: 1 }, {
      jwt: FIXTURE_ENV.SUPABASE_SERVICE_ROLE_KEY,
    }),
  );
  assert(res.status < 400, `expected the service-role bypass to pass, got ${res.status}`);
});

Deno.test("requireRole: the publishable/anon key is NOT a bypass", async () => {
  // The regression this whole module exists for: `process-approved-video`
  // accepted the anon key — and anything prefixed `sb_publishable_` — as proof
  // of authorization. Both are public.
  for (
    const token of [
      FIXTURE_ENV.SUPABASE_ANON_KEY,
      "sb_publishable_anything_at_all",
    ]
  ) {
    const { handler } = await loadFunction("backfill-literal-translations", {
      upstreams: {
        ...backend([]),
        // The anon key is not a user, so getUser rejects it.
        "/auth/v1/user": () => json({ message: "invalid claim" }, 401),
      },
    });
    const res = await handler(jsonRequest("backfill-literal-translations", { limit: 1 }, { jwt: token }));
    assertEquals(res.status, 401, `${token.slice(0, 20)}… should not authorize`);
  }
});

Deno.test("requireRole: a transcriber may re-segment, though not manage content", async () => {
  // The two role sets are deliberately different. `transcriber` is a native
  // speaker whose whole job is the transcript editor, so gating
  // ai-resegment-transcript to content managers alone would have taken a tool
  // away from the people it was built for — while backfill-literal-translations,
  // which rewrites whole videos in bulk, stays narrower.
  const upstreams = {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": (request: Request) =>
      // The gate filters server-side with `.in("role", …)`, so a transcriber row
      // comes back only when the query asked for that role.
      json(request.url.includes("transcriber") ? [{ role: "transcriber" }] : []),
    "generativelanguage.googleapis.com/v1beta/openai": () =>
      chatCompletion("", {
        lines: [{ start: 0, end: 1, text: "مرحبا", translation: "hello", wordIndices: [0] }],
      }),
    "/rest/v1/": () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "*/0" },
      }),
  };

  const resegment = await loadFunction("ai-resegment-transcript", { upstreams });
  const allowed = await resegment.handler(
    jsonRequest("ai-resegment-transcript", {
      segments: [{
        id: "s1",
        video_id: "v1",
        start: 0,
        end: 1,
        text: "مرحبا",
        translation: "hello",
        confidence: 1,
        words: [{ word: "مرحبا", start: 0, end: 1, confidence: 1 }],
      }],
    }, { jwt: "transcriber-jwt" }),
  );
  assert(allowed.status < 400, `a transcriber should be allowed, got ${allowed.status}`);

  const backfill = await loadFunction("backfill-literal-translations", { upstreams });
  const refused = await backfill.handler(
    jsonRequest("backfill-literal-translations", { limit: 1 }, { jwt: "transcriber-jwt" }),
  );
  assertEquals(refused.status, 403);
});
