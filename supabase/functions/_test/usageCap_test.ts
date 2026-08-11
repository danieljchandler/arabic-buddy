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
