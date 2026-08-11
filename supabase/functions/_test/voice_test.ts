import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The two functions behind the voice call, and the one behind Learn from X.
 *
 * `realtime-session-token` is the only place the long-lived `OPENAI_API_KEY`
 * is used. It mints a short-lived client secret so the browser can do the WebRTC
 * SDP exchange with OpenAI directly — the key never reaches the page, and the
 * SDP never passes through the edge runtime, which corrupts multipart payloads
 * and produces OpenAI's "failed to unmarshal SDP: EOF". It also keeps a
 * compatibility path for stale bundles that still post an offer here.
 *
 * `scrape-x-post` fetches an arbitrary URL through Jina Reader, so its URL
 * check is a security boundary rather than a nicety: without it the function is
 * an open proxy running on the app's own credentials. Its extraction has three
 * ordered strategies because X's title format is the reliable one and the other
 * two are what is left when it changes.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function subscriber(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

/** OpenAI's realtime endpoints, routed by path — they answer different things. */
function openai(
  { secret = "ek_fixture", sdpAnswer = "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" } = {},
): UpstreamHandler {
  return (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/client_secrets")) {
      return json({
        value: secret,
        expires_at: 1893456000,
        session: { id: "sess_fixture" },
      });
    }
    return new Response(sdpAnswer, {
      status: 200,
      headers: { "content-type": "application/sdp" },
    });
  };
}

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  jwt?: string | null,
) {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(jsonRequest(name, body, jwt === undefined ? {} : { jwt }));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Not every response is JSON — the SDP path returns raw text.
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      headers: fn.calls.map((c) => c.headers),
    };
  } finally {
    fn.restore();
  }
}

// ── realtime-session-token ──────────────────────────────────────────────────

Deno.test("realtime-session-token mints an ephemeral key", async () => {
  const { status, body } = await call(
    "realtime-session-token",
    { dialect: "Gulf", difficulty: "beginner" },
    subscriber({ "api.openai.com": openai() }),
  );

  assertEquals(status, 200);
  // Emitted under both names as flat strings. The client reads `value` first
  // and falls back to `client_secret`, so both have to carry the key or a
  // client on either branch gets an empty secret and a silent connect failure.
  assertEquals(body.value, "ek_fixture");
  assertEquals(body.client_secret, "ek_fixture");
  assertEquals(body.model, "gpt-realtime-2");
});

Deno.test("realtime-session-token never sends the long-lived key downstream", async () => {
  const { body, headers, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({ "api.openai.com": openai() }),
  );

  // The whole reason this function exists. The server key authenticates the
  // mint call and nothing else; what comes back is a short-lived secret the
  // browser may hold.
  const mint = calls.findIndex((url) => url.includes("client_secrets"));
  assertStringIncludes(headers[mint].authorization, "fixture");
  assert(!JSON.stringify(body).includes(headers[mint].authorization.replace("Bearer ", "")));
});

Deno.test("realtime-session-token hashes the user into a safety identifier", async () => {
  const { headers, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({ "api.openai.com": openai() }),
  );

  const mint = calls.findIndex((url) => url.includes("client_secrets"));
  const identifier = headers[mint]["openai-safety-identifier"];
  // A SHA-256 hex digest, not the user id: OpenAI gets a stable handle for
  // abuse tracking without being handed the app's own identifiers.
  assertEquals(identifier.length, 64);
  assert(!identifier.includes(USER));
});

Deno.test("realtime-session-token picks a voice per dialect", async () => {
  for (const [dialect, voice] of [
    ["Gulf", "ballad"],
    ["Egyptian", "shimmer"],
    ["Yemeni", "verse"],
  ] as const) {
    const { body, bodies, calls } = await call(
      "realtime-session-token",
      { dialect },
      subscriber({ "api.openai.com": openai() }),
    );

    assertEquals(body.voice, voice);
    const mint = calls.findIndex((url) => url.includes("client_secrets"));
    assertStringIncludes(bodies[mint] ?? "", `"voice":"${voice}"`);
  }
});

Deno.test("realtime-session-token falls back to the Gulf voice for an unknown dialect", async () => {
  const { body } = await call(
    "realtime-session-token",
    { dialect: "Klingon" },
    subscriber({ "api.openai.com": openai() }),
  );

  // An unmapped dialect would otherwise send `voice: undefined` and OpenAI
  // would reject the whole session config.
  assertEquals(body.voice, "ballad");
});

Deno.test("realtime-session-token scales the instructions to the difficulty", async () => {
  const { bodies, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf", difficulty: "advanced" },
    subscriber({ "api.openai.com": openai() }),
  );

  const mint = calls.findIndex((url) => url.includes("client_secrets"));
  // The instruction is baked into the session at mint time; there is no way to
  // change it once the call is live.
  assertStringIncludes(bodies[mint] ?? "", "Speak naturally at full pace");
});

Deno.test("realtime-session-token opens on the topic when given one", async () => {
  const { bodies, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf", topicHint: "ordering coffee" },
    subscriber({ "api.openai.com": openai() }),
  );

  const mint = calls.findIndex((url) => url.includes("client_secrets"));
  assertStringIncludes(bodies[mint] ?? "", "ordering coffee");
});

Deno.test("realtime-session-token asks for Arabic transcription of the learner", async () => {
  const { bodies, calls } = await call(
    "realtime-session-token",
    { dialect: "Egyptian" },
    subscriber({ "api.openai.com": openai() }),
  );

  const mint = calls.findIndex((url) => url.includes("client_secrets"));
  const sent = bodies[mint] ?? "";
  // Without `language: "ar"` the transcriber guesses, and a learner's halting
  // Arabic is routinely guessed as something else — the on-screen transcript
  // then shows the wrong language back at them.
  assertStringIncludes(sent, '"language":"ar"');
  assertStringIncludes(sent, "Egyptian");
});

Deno.test("realtime-session-token says so when its key is missing", async () => {
  const fn = await loadFunction("realtime-session-token", {
    env: { OPENAI_API_KEY: undefined },
    upstreams: subscriber({ "api.openai.com": openai() }),
  });
  try {
    const response = await fn.handler(jsonRequest("realtime-session-token", { dialect: "Gulf" }));

    assertEquals(response.status, 500);
    assertEquals((await response.json()).error, "OPENAI_API_KEY not configured");
    // Nothing is attempted without it — an unconfigured deployment must not
    // look like a network problem.
    assert(!fn.calls.some((c) => c.url.includes("api.openai.com")));
  } finally {
    fn.restore();
  }
});

Deno.test("realtime-session-token reports a refused mint as 502", async () => {
  const { status, body } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({ "api.openai.com": () => json({ error: "invalid key" }, 401) }),
  );

  // 502, not a pass-through 401: the learner is authenticated, the *server* is
  // not. Forwarding the 401 would read as "sign in again".
  assertEquals(status, 502);
  assertEquals(body.error, "Failed to mint Realtime client secret");
  assertStringIncludes(String(body.details), "invalid key");
});

Deno.test("realtime-session-token rejects a mint response with no secret in it", async () => {
  const { status, body } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({ "api.openai.com": () => json({ session: { id: "sess" } }) }),
  );

  // Caught here rather than shipped to the browser as an empty string, which
  // would fail later at the SDP exchange with a far less obvious message.
  assertEquals(status, 502);
  assertEquals(body.error, "Malformed Realtime client secret response");
});

Deno.test("realtime-session-token reads the nested client_secret shape too", async () => {
  const { status, body } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({
      "api.openai.com": () => json({ client_secret: { value: "ek_nested" } }),
    }),
  );

  // OpenAI has returned the key both flat and nested across API revisions, so
  // all three shapes are accepted rather than pinning one.
  assertEquals(status, 200);
  assertEquals(body.value, "ek_nested");
});

Deno.test("realtime-session-token exchanges an SDP offer for stale bundles", async () => {
  const { status, contentType, text, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" },
    subscriber({ "api.openai.com": openai() }),
  );

  assertEquals(status, 200);
  assertStringIncludes(contentType, "application/sdp");
  assertStringIncludes(text, "v=0");
  // Two upstream calls, in order: mint the ephemeral key, then use it for the
  // SDP. The server key is never used for the second.
  assert(calls.some((url) => url.includes("client_secrets")));
  assert(calls.some((url) => url.includes("/realtime/calls")));
});

Deno.test("realtime-session-token refuses an SDP that is not one", async () => {
  const { status, body, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf", sdp: "definitely not sdp" },
    subscriber({ "api.openai.com": openai() }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "Invalid SDP offer");
  // The key has already been minted by this point — the guard only prevents
  // the second call, not the first.
  assert(!calls.some((url) => url.includes("/realtime/calls")));
});

Deno.test("realtime-session-token reports a failed SDP exchange as 502", async () => {
  const { status, body } = await call(
    "realtime-session-token",
    { dialect: "Gulf", sdp: "v=0\r\n" },
    subscriber({
      "api.openai.com": (request) =>
        new URL(request.url).pathname.endsWith("/client_secrets")
          ? json({ value: "ek_fixture" })
          : json({ error: "bad offer" }, 400),
    }),
  );

  assertEquals(status, 502);
  assertEquals(body.error, "Failed to exchange Realtime SDP");
});

Deno.test("realtime-session-token turns an anonymous caller away", async () => {
  const { status, body, calls } = await call(
    "realtime-session-token",
    { dialect: "Gulf" },
    subscriber({ "api.openai.com": openai() }),
    null,
  );

  // The cap runs before the key is even read, so an anonymous caller cannot
  // burn a mint — each one is billable.
  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assert(!calls.some((url) => url.includes("api.openai.com")));
});

// ── scrape-x-post ───────────────────────────────────────────────────────────

/** Jina Reader's envelope: everything the function reads is under `data`. */
const jina = (data: Record<string, string>): UpstreamHandler => () => json({ data });

Deno.test("scrape-x-post pulls the tweet out of the page title", async () => {
  const { status, body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "الجو حلو اليوم" / X' }) },
  );

  assertEquals(status, 200);
  // The title is the reliable source. X renders the post body through
  // JavaScript, so the markdown Jina returns often has everything *except* the
  // tweet — and the ' / X' suffix has to come off or it lands in the analyser.
  assertEquals(body.text, "الجو حلو اليوم");
});

Deno.test("scrape-x-post handles a title with no trailing suffix", async () => {
  const { body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "الجو حلو اليوم"' }) },
  );

  assertEquals(body.text, "الجو حلو اليوم");
});

Deno.test("scrape-x-post handles a title truncated before its closing quote", async () => {
  const { body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "الجو حلو اليوم وكل شي تمام' }) },
  );

  // X truncates long posts in the title. Salvaging what is there beats
  // reporting the post as unreadable.
  assertEquals(body.text, "الجو حلو اليوم وكل شي تمام");
});

Deno.test("scrape-x-post falls back to the description", async () => {
  const { body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: "Someone on X", description: "الجو حلو اليوم" }) },
  );

  assertEquals(body.text, "الجو حلو اليوم");
});

Deno.test("scrape-x-post falls back to the Arabic lines of the body", async () => {
  const { body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    {
      "r.jina.ai": jina({
        title: "Someone on X",
        content: "Log in\nSign up\nالجو حلو اليوم\nTrending now\nوالشمس طالعة",
      }),
    },
  );

  // Last resort, and it works by filtering on script: everything X wraps the
  // post in is Latin chrome, so the Arabic lines are the post.
  assertEquals(body.text, "الجو حلو اليوم\nوالشمس طالعة");
});

Deno.test("scrape-x-post retries with the API key when the free tier finds nothing", async () => {
  let attempt = 0;
  const { status, body, calls, headers } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    {
      "r.jina.ai": () => {
        attempt += 1;
        return attempt === 1
          ? json({ data: {} })
          : json({ data: { title: 'Someone on X: "الجو حلو اليوم" / X' } });
      },
    },
  );

  assertEquals(status, 200);
  assertEquals(body.text, "الجو حلو اليوم");
  assertEquals(calls.length, 2);
  // Free first, authenticated second. Reversing that spends quota on every
  // post, including the ones the free tier would have handled.
  assertEquals(headers[0].authorization, undefined);
  assert(headers[1].authorization);
});

Deno.test("scrape-x-post does not retry when the free tier succeeded", async () => {
  const { calls } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "الجو حلو اليوم" / X' }) },
  );

  assertEquals(calls.length, 1);
});

Deno.test("scrape-x-post reports an unreadable post as 422", async () => {
  const { status, body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({}) },
  );

  // 422, not 500: the request was fine and the post was not. That distinction
  // is what lets the page say "private or deleted" rather than "try again".
  assertEquals(status, 422);
  assertEquals(body.success, false);
  assertStringIncludes(String(body.error), "may be private");
});

Deno.test("scrape-x-post refuses a post with no Arabic in it", async () => {
  const { status, body } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "just an english post" / X' }) },
  );

  assertEquals(status, 422);
  // Checked here rather than downstream: the analyser would otherwise spend a
  // model call to conclude the same thing.
  assertStringIncludes(String(body.error), "No Arabic text found");
});

Deno.test("scrape-x-post survives a non-JSON body from Jina", async () => {
  const { status } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": () => new Response("<html>rate limited</html>", { status: 200 }) },
  );

  // A 200 carrying an HTML error page is Jina's usual failure mode, and
  // `response.json()` throws on it.
  assertEquals(status, 422);
});

Deno.test("scrape-x-post treats an upstream failure as an unreadable post", async () => {
  const { status } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": () => json({ error: "rate limited" }, 429) },
  );

  assertEquals(status, 422);
});

Deno.test("scrape-x-post accepts the old twitter.com host", async () => {
  const { status } = await call(
    "scrape-x-post",
    { url: "https://twitter.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'Someone on X: "الجو حلو" / X' }) },
  );

  assertEquals(status, 200);
});

Deno.test("scrape-x-post fetches nothing for a URL that is not an X post", async () => {
  for (
    const url of [
      "https://example.com/some/page",
      "https://x.com/someone",
      "https://x.com/someone/status/abc",
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data/",
    ]
  ) {
    const { status, calls } = await call(
      "scrape-x-post",
      { url },
      { "r.jina.ai": jina({ title: 'X: "الجو" / X' }) },
    );

    // The security half of the guard. This function fetches whatever it is
    // handed, so an unvalidated URL makes it a proxy for arbitrary requests —
    // including link-local metadata endpoints — from the app's own network.
    assertEquals(status, 400, `expected ${url} to be refused`);
    assertEquals(calls.length, 0, `expected no fetch for ${url}`);
  }
});

Deno.test("scrape-x-post refuses a request with no URL at all", async () => {
  const { status, body } = await call(
    "scrape-x-post",
    {},
    { "r.jina.ai": jina({}) },
  );

  assertEquals(status, 400);
  assertEquals(body.error, "Missing or invalid URL");
});

Deno.test("scrape-x-post needs no sign-in", async () => {
  const { status } = await call(
    "scrape-x-post",
    { url: "https://x.com/someone/status/123" },
    { "r.jina.ai": jina({ title: 'X: "الجو حلو" / X' }) },
    null,
  );

  // Pinned as-is. `verify_jwt = false` and there is no `enforceDailyCap`, so
  // this is the one function in the pair that anyone on the internet can drive
  // — each call spends Jina quota. Learn from X gates its *analysis* step
  // behind a cap, but the scrape in front of it is open.
  assertEquals(status, 200);
});

// ── CORS ────────────────────────────────────────────────────────────────────

for (const name of ["realtime-session-token", "scrape-x-post"]) {
  Deno.test(`${name} answers a preflight`, async () => {
    const fn = await loadFunction(name, { upstreams: subscriber() });
    try {
      const response = await fn.handler(optionsRequest(name));

      assertEquals(response.status, 200);
      assert(response.headers.get("access-control-allow-origin"));
      assertEquals(fn.calls.length, 0);
    } finally {
      fn.restore();
    }
  });
}
