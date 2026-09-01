import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { geminiImage, imageLadder, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-story-cover` — the admin-driven cover illustration for one
 * interactive story.
 *
 * The function builds its prompt from the story row itself (title,
 * description, dialect), generates one image through the gateway, uploads it,
 * and writes the public URL onto interactive_stories.cover_image_url. The
 * properties worth pinning: only content managers get in, the prompt really
 * is conditioned on the story's own dialect and title (a Yemeni story must
 * not get a Gulf cover), and the row update carries the new URL.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "cccccccc-0000-4000-8000-000000000000";

/** A 1x1 PNG, base64, standing in for the image model's answer. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const storyRow = (over: Record<string, unknown> = {}) => ({
  id: STORY,
  title: "The Lost Falcon",
  title_arabic: "الصقر الضايع",
  description: "A boy searches the old city for his father's falcon.",
  dialect: "Yemeni",
  difficulty: "Beginner",
  ...over,
});

function coverBackend(
  options: {
    story?: Record<string, unknown> | null;
    extra?: Record<string, UpstreamHandler>;
  } = {},
) {
  const { story = storyRow(), extra = {} } = options;
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    "/storage/v1": () => json({ Key: `listen-audio/interactive-stories/${STORY}/cover` }),
    "/rest/v1/interactive_stories": (request: Request) =>
      request.method === "GET" ? json(story) : json([], 200),
    ...imageLadder(() => geminiImage(PNG_B64)),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("generate-story-cover", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("generate-story-cover", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      methods: fn.calls.map((c) => c.method),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

/** The body of the last call whose URL contains `part`. */
function lastBody(
  result: { calls: string[]; methods: string[]; bodies: Array<string | null> },
  part: string,
  method?: string,
): Record<string, unknown> | undefined {
  const found = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes(part) && (!method || c.method === method))
    .at(-1);
  return found ? (JSON.parse(found.body ?? "{}") as Record<string, unknown>) : undefined;
}

Deno.test("generate-story-cover answers the preflight", async () => {
  const fn = await loadFunction("generate-story-cover", { upstreams: coverBackend() });
  try {
    const response = await fn.handler(optionsRequest("generate-story-cover"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-cover turns away an anonymous caller", async () => {
  const result = await call(
    { story_id: STORY },
    coverBackend({ extra: { "/auth/v1/user": () => json({ error: "no session" }, 401) } }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-cover turns away a caller who may not manage content", async () => {
  const result = await call(
    { story_id: STORY },
    coverBackend({ extra: { "/rest/v1/user_roles": () => json([]) } }),
  );

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "forbidden");
});

Deno.test("generate-story-cover needs a story id", async () => {
  const result = await call({}, coverBackend());
  assertEquals(result.status, 400);
});

Deno.test("generate-story-cover says so when the story is gone", async () => {
  const result = await call({ story_id: STORY }, coverBackend({ story: null }));
  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "story not found");
});

Deno.test("generate-story-cover conditions the prompt on the story itself", async () => {
  const result = await call({ story_id: STORY }, coverBackend());

  assertEquals(result.status, 200);
  const gen = lastBody(result, "-image:generateContent");
  assert(gen, "expected an image generation call");
  const prompt = String((gen.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text);
  // The cover must be this story's, in this story's world: title and the
  // dialect's own setting, not the Gulf default.
  assertStringIncludes(prompt, "The Lost Falcon");
  assertStringIncludes(prompt, "Sana'a");
});

Deno.test("generate-story-cover appends the admin's steering note", async () => {
  const result = await call(
    { story_id: STORY, prompt_extra: "make it a night scene" },
    coverBackend(),
  );

  assertEquals(result.status, 200);
  const gen = lastBody(result, "-image:generateContent");
  assert(gen, "expected an image generation call");
  assertStringIncludes(
    String((gen.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text),
    "make it a night scene",
  );
});

Deno.test("generate-story-cover writes the public URL onto the story row", async () => {
  const result = await call({ story_id: STORY }, coverBackend());

  assertEquals(result.status, 200);
  assert(String(result.body.cover_image_url).length > 0, "expected a cover URL in the response");

  const write = lastBody(result, "interactive_stories", "PATCH");
  assert(write, "expected an update to interactive_stories");
  assertStringIncludes(String(write.cover_image_url), `interactive-stories/${STORY}/cover-`);

  // And the image itself went through storage.
  assert(result.calls.some((url) => url.includes("/storage/v1")), "expected a storage upload");
});
