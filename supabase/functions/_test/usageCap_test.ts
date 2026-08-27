import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * The shared daily usage cap.
 *
 * This is the only thing limiting free-tier access to the AI endpoints — the
 * client-side tier gate in src/lib/featureAccess.ts is not wired up to anything
 * — so its behaviour is the real product boundary, and it had no tests.
 *
 * Driven through `grammar-drill`, which is a plain caller of `enforceDailyCap`,
 * because the module reads its environment at import time and is easier to
 * exercise through a function than in isolation.
 */

/** Supabase REST/auth responses the cap makes under the service role. */
function backend(options: {
  user?: string | null;
  subscribed?: boolean;
  subscriptionEnd?: string | null;
  admin?: boolean;
  usageCount?: number;
  usageFails?: boolean;
} = {}) {
  const {
    user = "00000000-0000-4000-8000-000000000001",
    subscribed = false,
    subscriptionEnd = null,
    admin = false,
    usageCount = 1,
    usageFails = false,
  } = options;

  return {
    "/auth/v1/user": () =>
      user === null
        ? json({ message: "invalid claim" }, 401)
        : json({ id: user, aud: "authenticated", role: "authenticated" }),

    "/rest/v1/subscribers": () =>
      json(subscribed ? { subscribed: true, subscription_end: subscriptionEnd } : null),

    "/rest/v1/user_roles": () => json(admin ? { role: "admin" } : null),

    "/rest/v1/rpc/increment_usage_counter": () =>
      usageFails
        ? json({ code: "P0001", message: "counter unavailable" }, 400)
        : json(usageCount),

    // The model call, once the cap lets the request through.
    "ai.gateway.lovable.dev": () =>
      json({ choices: [{ message: { role: "assistant", content: "{}" } }] }),
  };
}

async function callGrammarDrill(
  upstreams: Record<string, () => Response>,
  jwt?: string | null,
): Promise<Response> {
  const fn = await loadFunction("grammar-drill", { upstreams });
  try {
    return await fn.handler(
      jsonRequest("grammar-drill", { category: "negation", dialect: "Gulf" }, { jwt }),
    );
  } finally {
    fn.restore();
  }
}

Deno.test("an anonymous caller is rejected with auth_required", async () => {
  const response = await callGrammarDrill(backend(), null);

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "auth_required");
});

Deno.test("a token the auth server rejects is treated as anonymous", async () => {
  const response = await callGrammarDrill(backend({ user: null }));

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "auth_required");
});

Deno.test("a free user under the limit is let through", async () => {
  const response = await callGrammarDrill(backend({ usageCount: 5 }));

  assertEquals(response.status, 200);
});

Deno.test("a free user over the limit gets 429 with the upgrade path", async () => {
  // The client reads this shape in src/lib/handleCapResponse.ts to show the
  // upgrade toast, so the field names are a contract, not an implementation
  // detail.
  const response = await callGrammarDrill(backend({ usageCount: 999 }));

  assertEquals(response.status, 429);

  const body = await response.json();
  assertEquals(body.error, "daily_limit_reached");
  assertEquals(body.upgrade_url, "/pricing");
  assertEquals(typeof body.limit, "number");
  assertEquals(typeof body.count, "number");
});

Deno.test("an active subscriber bypasses the cap entirely", async () => {
  const response = await callGrammarDrill(
    backend({ subscribed: true, usageCount: 999 }),
  );

  assertEquals(response.status, 200);
});

Deno.test("a subscription that has already ended does not bypass the cap", async () => {
  const response = await callGrammarDrill(
    backend({
      subscribed: true,
      subscriptionEnd: new Date(Date.now() - 86_400_000).toISOString(),
      usageCount: 999,
    }),
  );

  assertEquals(response.status, 429);
});

Deno.test("an admin bypasses the cap", async () => {
  const response = await callGrammarDrill(backend({ admin: true, usageCount: 999 }));

  assertEquals(response.status, 200);
});

Deno.test("a failing counter fails open rather than locking everyone out", async () => {
  // Deliberate: the comment in usageCap.ts says "Don't block on counter
  // failure". A counter outage should degrade to unmetered, not to unusable.
  const response = await callGrammarDrill(backend({ usageFails: true }));

  assertEquals(response.status, 200);
});

Deno.test("a subscribers lookup that throws fails closed, keeping the cap on", async () => {
  // The opposite default from the counter, and also deliberate: an unreadable
  // subscription must not be treated as an active one.
  const response = await callGrammarDrill({
    ...backend({ usageCount: 999 }),
    "/rest/v1/subscribers": () => json({ message: "boom" }, 500),
  });

  assertEquals(response.status, 429);
});

// ── Per-tier ladders ────────────────────────────────────────────────────────
// A feature may pass `tierLimits` to give each paid tier its own ceiling
// instead of the blanket subscriber bypass. Driven through
// `generate-phrase-jingle` (free 15 / standard 40 / allin 120), the music
// endpoint that previously had no cap at all.

async function callPhraseJingle(
  upstreams: Record<string, () => Response>,
): Promise<Response> {
  const fn = await loadFunction("generate-phrase-jingle", { upstreams });
  try {
    return await fn.handler(
      jsonRequest("generate-phrase-jingle", {
        phrase_arabic: "شلونك",
        phrase_english: "how are you",
      }),
    );
  } finally {
    fn.restore();
  }
}

/** The two model calls behind the jingle, answering just enough to succeed. */
function jingleModels() {
  return {
    "ai.gateway.lovable.dev": () =>
      json({
        choices: [
          {
            message: {
              content: JSON.stringify({ lyrics: "شلونك يا صديقي", prompt: "Khaliji pop, 12s" }),
            },
          },
        ],
      }),
    "generativelanguage.googleapis.com": () =>
      json({
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: "audio/L16;rate=48000", data: btoa("\x01\x02\x03\x04") } },
              ],
            },
          },
        ],
      }),
  };
}

Deno.test("a ladder feature caps the standard tier at its own limit", async () => {
  const response = await callPhraseJingle({
    ...backend({ usageCount: 41 }),
    ...jingleModels(),
    "/rest/v1/subscribers": () =>
      json({ subscribed: true, subscription_end: null, subscription_tier: "standard" }),
  });

  // 41 > standard's 40. Before ladders, any subscriber bypassed every cap —
  // which is why the $15 tier bought nothing the $5 tier didn't have.
  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.tier, "standard");
});

Deno.test("a ladder feature lets the All-In tier keep going where standard stops", async () => {
  const response = await callPhraseJingle({
    ...backend({ usageCount: 41 }),
    ...jingleModels(),
    "/rest/v1/subscribers": () =>
      json({ subscribed: true, subscription_end: null, subscription_tier: "allin" }),
  });

  assertEquals(response.status, 200);
});

Deno.test("a subscriber with no recorded tier gets the top tier's ladder, not a lockout", async () => {
  const response = await callPhraseJingle({
    ...backend({ usageCount: 121 }),
    ...jingleModels(),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
  });

  // Fails open to All-In's 120 — and 121 exceeds even that. Never newly block
  // a paying user because the tier column is stale; do block at the ceiling.
  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.tier, "allin");
});

// ── The anonymous cap ────────────────────────────────────────────────────────
// Three endpoints are deliberately usable signed out (the placement quiz is
// the landing page's CTA), which made them unlimited paid calls for anyone
// holding the anon key. enforceAnonymousDailyCap buckets those callers per IP
// through the same counter RPC, under a synthetic id. Driven through
// score-shadow-attempt, the plainest caller.

async function callShadow(
  upstreams: Record<string, () => Response>,
  headers: Record<string, string>,
  // `{ jwt: null }` (the default) sends no Authorization at all; pass `{}` to
  // send the fixture JWT — an explicit `undefined` would just re-trigger a
  // parameter default and silently mean anonymous again.
  auth: { jwt?: string | null } = { jwt: null },
): Promise<{ response: Response; rpcBodies: unknown[] }> {
  const fn = await loadFunction("score-shadow-attempt", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest(
        "score-shadow-attempt",
        { audioBase64: "aGk=", referenceText: "مرحبا", dialect: "Gulf" },
        { jwt: auth.jwt, headers },
      ),
    );
    await response.text();
    return {
      response,
      rpcBodies: fn.calls
        .filter((call) => call.url.includes("increment_usage_counter"))
        .map((call) => call.body),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("an anonymous caller over the limit gets the 429, told to sign up", async () => {
  const { response } = await callShadow(
    { ...backend({ user: null, usageCount: 61 }) },
    { "x-forwarded-for": "203.0.113.9" },
  );

  assertEquals(response.status, 429);
});

Deno.test("anonymous callers are bucketed per IP, stably", async () => {
  const upstreams = () => backend({ user: null, usageCount: 1 });

  const first = await callShadow(upstreams(), { "x-forwarded-for": "203.0.113.9" });
  const again = await callShadow(upstreams(), { "x-forwarded-for": "203.0.113.9" });
  const other = await callShadow(upstreams(), { "x-forwarded-for": "198.51.100.7" });

  const idOf = (bodies: unknown[]) =>
    (JSON.parse((bodies[0] as string | null) ?? "{}") as { _user_id?: string })._user_id;
  // Same IP, same bucket — the count accumulates. A different IP gets its own,
  // so one saturated café NAT cannot spend a stranger's allowance elsewhere.
  assertEquals(idOf(first.rpcBodies), idOf(again.rpcBodies));
  assertEquals(idOf(first.rpcBodies) === idOf(other.rpcBodies), false);
});

Deno.test("a signed-in caller keeps the ordinary per-user cap", async () => {
  const { rpcBodies } = await callShadow(
    {
      ...backend({ usageCount: 1 }),
      // Past the cap, the function reaches for Munsit; fail it fast — the
      // accounting id is what this test is about.
      "api.cntxt.tools": () => json({ error: "down" }, 500),
    },
    {},
    {}, // jwt omitted: jsonRequest sends its fixture JWT — a signed-in caller
  );

  assertEquals(
    (JSON.parse((rpcBodies[0] as string | null) ?? "{}") as { _user_id?: string })._user_id,
    "00000000-0000-4000-8000-000000000001",
  );
});
