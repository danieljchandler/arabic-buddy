import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { chatCompletion, geminiImage, json, openaiImage } from "./upstreams.ts";

/**
 * `_shared/aiGateway.ts` — which upstream actually receives a model call.
 *
 * This is the module the move off the Lovable gateway turned into a decision
 * rather than a constant, and it is the one place in the backend where getting
 * it wrong is quiet. A model sent to the wrong provider does not throw: it 404s
 * or 400s, the caller reads a failure, and the feature degrades to whatever its
 * fallback is. So the assertions here are about *where the request went and
 * under whose key*, not about what came back.
 *
 * Three behaviours carry the design:
 *   - the vendor prefix picks the provider, and the prefix is then stripped for
 *     the vendors whose own APIs do not use it;
 *   - a provider whose key is absent is not an error while OpenRouter can serve
 *     the same model id;
 *   - a provider that answers badly is retried once on OpenRouter — a provider
 *     swap, never a model swap.
 */

const GOOGLE = "generativelanguage.googleapis.com/v1beta/openai";
const OPENROUTER = "openrouter.ai";
const OPENAI = "api.openai.com/v1/chat/completions";

type Gateway = typeof import("../_shared/aiGateway.ts");

async function withGateway(
  run: (mod: Gateway, up: StubbedUpstreams) => Promise<void> | void,
  options: Parameters<typeof stubUpstreams>[0] = {},
): Promise<void> {
  const up = stubUpstreams(options);
  try {
    await run(await loadSharedModule<Gateway>("aiGateway"), up);
  } finally {
    up.restore();
  }
}

const bodyOf = (call: { body: string | null }) => JSON.parse(call.body ?? "{}") as Record<string, unknown>;

// ── Routing ─────────────────────────────────────────────────────────────────

Deno.test("a Gemini model goes to Google, under Google's key and Google's id", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("google/gemini-3.5-flash", { messages: [] });

    const [call] = up.callsTo(GOOGLE);
    assert(call, "expected the call to reach Google");
    assertEquals(call.headers.authorization, "Bearer fixture-gemini");
    // The `google/` prefix belongs to OpenRouter's namespace; Google's own API
    // 404s on it.
    assertEquals(bodyOf(call).model, "gemini-3.5-flash");
  });
});

Deno.test("a GPT model goes to OpenAI, with the vendor prefix stripped", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("openai/gpt-5-mini", { messages: [] });

    const [call] = up.callsTo(OPENAI);
    assert(call, "expected the call to reach OpenAI");
    assertEquals(call.headers.authorization, "Bearer fixture-openai");
    assertEquals(bodyOf(call).model, "gpt-5-mini");
  });
});

Deno.test("everything else goes to OpenRouter with its id intact", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("anthropic/claude-sonnet-4.5", { messages: [] });

    const [call] = up.callsTo(OPENROUTER);
    assert(call, "expected the call to reach OpenRouter");
    assertEquals(call.headers.authorization, "Bearer fixture-openrouter");
    // OpenRouter is the namespace the registry is written in, so the id it is
    // given is the id it was asked for.
    assertEquals(bodyOf(call).model, "anthropic/claude-sonnet-4.5");
  });
});

Deno.test("a missing vendor key routes the same model through OpenRouter", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("google/gemini-3.5-flash", { messages: [] });

    assertEquals(up.callsTo(GOOGLE).length, 0);
    const [call] = up.callsTo(OPENROUTER);
    assert(call, "expected the call to fall through to OpenRouter");
    // Same model, different provider — which is exactly why the registry's ids
    // are kept in OpenRouter's namespace.
    assertEquals(bodyOf(call).model, "google/gemini-3.5-flash");
  }, { env: { GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined } });
});

Deno.test("providerForModel answers without making a request", async () => {
  await withGateway(async (mod, up) => {
    assertEquals(mod.providerForModel("google/gemini-3.5-flash"), "google");
    assertEquals(mod.providerForModel("openai/gpt-5-mini"), "openai");
    assertEquals(mod.providerForModel("qwen/qwen3-max"), "openrouter");
    // Callers branch on this to decide whether to send OpenRouter-only fields,
    // so it has to be free of side effects.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("nothing configured is reported as a configuration error, not a call", async () => {
  await withGateway(async (mod, up) => {
    assertEquals(mod.hasAnyProvider(), false);
    await assertRejects(
      () => mod.chatFetch("google/gemini-3.5-flash", { messages: [] }),
      Error,
      "GEMINI_API_KEY",
    );
    assertEquals(up.calls.length, 0);
  }, {
    env: {
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
    },
  });
});

// ── The OpenRouter retry ────────────────────────────────────────────────────

Deno.test("a vendor outage is retried once on OpenRouter, with the model unchanged", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("google/gemini-3.5-flash", { messages: [] });

    assertEquals(response.status, 200);
    assertEquals(up.callsTo(GOOGLE).length, 1);
    const [retry] = up.callsTo(OPENROUTER);
    assert(retry, "expected a retry on OpenRouter");
    assertEquals(bodyOf(retry).model, "google/gemini-3.5-flash");
  }, { upstreams: { [GOOGLE]: () => json({ error: "down" }, 503) } });
});

Deno.test("a rate limit is passed back rather than spent on another provider", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("google/gemini-3.5-flash", { messages: [] });

    // 429 is a real signal several callers surface to the learner. Quietly
    // spending a second provider's quota to paper over it hides the cap instead
    // of respecting it.
    assertEquals(response.status, 429);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, { upstreams: { [GOOGLE]: () => json({ error: "slow down" }, 429) } });
});

Deno.test("noFallback leaves the first provider's failure standing", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch(
      "google/gemini-3.5-flash",
      { messages: [] },
      { noFallback: true },
    );

    // For callers running their own model ladder, a second provider on the same
    // model is a duplicate spend, not a rescue.
    assertEquals(response.status, 503);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, { upstreams: { [GOOGLE]: () => json({ error: "down" }, 503) } });
});

Deno.test("chatFetchDetailed names the provider that actually answered", async () => {
  await withGateway(async (mod) => {
    const result = await mod.chatFetchDetailed("google/gemini-3.5-flash", { messages: [] });

    // Cost telemetry records where the tokens were really bought, which is not
    // the same as where they were requested once a retry has happened.
    assertEquals(result.provider, "openrouter");
    assertEquals(result.fellBackFrom, "google");
  }, { upstreams: { [GOOGLE]: () => json({ error: "down" }, 503) } });
});

// ── Fanar ───────────────────────────────────────────────────────────────────

Deno.test("a Fanar model goes to QCRI's endpoint with its id untouched", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("Fanar-C-2-27B", { messages: [] });

    const [call] = up.callsTo("api.fanar.qa");
    assert(call, "expected the call to reach Fanar");
    assertEquals(call.headers.authorization, "Bearer fixture-fanar");
    // No vendor prefix to strip, and nothing to translate: Fanar's own name for
    // the model is the only name it has.
    assertEquals(bodyOf(call).model, "Fanar-C-2-27B");
    assertEquals(mod.providerForModel("Fanar-C-2-27B"), "fanar");
  });
});

Deno.test("a Fanar outage is never retried on OpenRouter", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("Fanar-C-2-27B", { messages: [] });

    // The retry exists for vendors OpenRouter actually lists. Fanar is a
    // sovereign model on QCRI's own endpoint, so a fallback would turn one real
    // failure into a 404 about a model that was never on that catalogue.
    assertEquals(response.status, 503);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, { upstreams: { "api.fanar.qa": () => json({ error: "down" }, 503) } });
});

Deno.test("an unconfigured Fanar does not silently become another model", async () => {
  await withGateway(async (mod, up) => {
    // Google and OpenAI fall through to OpenRouter when their key is missing,
    // because the same model is served there. Fanar has no such twin: the
    // honest answer is that it cannot be called, not a quiet substitution.
    await assertRejects(
      () => mod.chatFetch("Fanar-C-2-27B", { messages: [] }),
      Error,
      "FANAR_API_KEY",
    );
    assertEquals(up.calls.length, 0);
  }, { env: { FANAR_API_KEY: undefined } });
});

// ── Jais 2 on our own RunPod worker ─────────────────────────────────────────

/**
 * A live Jais: deployed *and* switched on.
 *
 * Both halves are deployment state, so every RunPod test supplies its own —
 * and since `JAIS_ENABLED` defaults off, a test that forgets it gets the
 * paused rung rather than a route, which is the safer way round.
 */
const DEPLOYED = { RUNPOD_JAIS_8B_ENDPOINT_ID: "test1endpoint", JAIS_ENABLED: "on" };

Deno.test("a Jais model goes to our own worker, with the routing prefix stripped", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] });

    const [call] = up.callsTo("test1endpoint.api.runpod.ai");
    assert(call, "expected the call to reach the RunPod worker");
    assertEquals(call.headers.authorization, "Bearer fixture-runpod");
    // `runpod/` says where the model lives, not who publishes it. The worker
    // was started with `--served-model-name jais-2-8b-chat` and 404s on any
    // other name, so the prefix must not survive onto the wire.
    assertEquals(bodyOf(call).model, "jais-2-8b-chat");
    assertEquals(mod.providerForModel("runpod/jais-2-8b-chat"), "runpod");
  }, { env: DEPLOYED });
});

Deno.test("a RunPod outage is never retried on OpenRouter", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] });

    // Same reason as Fanar: Jais 2 is not on OpenRouter's catalogue at all, so
    // the retry would replace one honest failure with a 404 about a model that
    // was never there.
    assertEquals(response.status, 503);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, {
    env: DEPLOYED,
    upstreams: { "api.runpod.ai": () => json({ error: "down" }, 503) },
  });
});

Deno.test("a key with no endpoint deployed is unconfigured, not misrouted", async () => {
  await withGateway(async (mod, up) => {
    // Switched on below, so the address is genuinely the only thing missing.
    // RunPod is the one provider that can be half-configured: an API key is
    // not an address. Nothing is deployed, so there is nowhere to send this,
    // and the error has to name the part that is actually missing rather than
    // send the reader to look at a key that is present.
    await assertRejects(
      () => mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] }),
      Error,
      "RUNPOD_JAIS_8B_ENDPOINT_ID",
    );
    assertEquals(up.calls.length, 0);
  }, { env: { JAIS_ENABLED: "on" } });
});

Deno.test("an absent endpoint leaves tryChatRoute null rather than throwing", async () => {
  await withGateway((mod) => {
    // This is the property the dialect validator leans on: an undeployed Jais
    // has to be answerable without a request, so the validator can skip it
    // silently instead of turning a quality pass into a failure.
    assertEquals(mod.tryChatRoute("runpod/jais-2-8b-chat"), null);
  }, { env: { JAIS_ENABLED: "on" } });
});

Deno.test("the paused switch unroutes Jais however well it is deployed", async () => {
  await withGateway(async (mod, up) => {
    // The whole rung is off by default on cost (see `jaisEnabled`), and the
    // switch has to beat a *fully* configured deployment for that to mean
    // anything: a leftover endpoint id in a project's secrets must not be able
    // to restart the GPU meter on its own. Same null as an undeployed Jais, so
    // every consumer skips it down the path they already had.
    assertEquals(mod.tryChatRoute("runpod/jais-2-8b-chat"), null);
    // And nothing warms a worker it has no address for — this is what stops
    // the per-run pipeline ping that did the actual spending.
    assertEquals(mod.warmRoute("runpod/jais-2-8b-chat"), undefined);
    await Promise.allSettled(up.tasks);
    assertEquals(up.calls.length, 0);

    // The error names the switch rather than sending the reader to hunt for a
    // secret that is already set.
    await assertRejects(
      () => mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] }),
      Error,
      "JAIS_ENABLED",
    );
  }, { env: { RUNPOD_JAIS_8B_ENDPOINT_ID: "test1endpoint" } });
});

Deno.test("the switch alone is not an address either", async () => {
  await withGateway((mod) => {
    // The two halves are independent: switching Jais on in a project that
    // never deployed a worker is still unconfigured, not a broken route.
    assertEquals(mod.tryChatRoute("runpod/jais-2-8b-chat"), null);
  }, { env: { JAIS_ENABLED: "on" } });
});

// ── Waking a worker that scales to zero ─────────────────────────────────────

Deno.test("warming a runpod model wakes the worker without waiting for it", async () => {
  await withGateway(async (mod, up) => {
    // Returns nothing, on purpose. A warm-up whose result a caller could await
    // is just a slow request by another name, and the whole point of this call
    // is that the request it is attached to does not pay for it.
    assertEquals(mod.warmRoute("runpod/jais-2-8b-chat"), undefined);
    await Promise.allSettled(up.tasks);

    const [call] = up.callsTo("test1endpoint.api.runpod.ai");
    assert(call, "expected the wake-up to reach the RunPod worker");
    assertEquals(call.headers.authorization, "Bearer fixture-runpod");
    // The smallest legal completion: this exists for its side effect on the
    // worker, so one token is as much answer as it needs.
    assertEquals(bodyOf(call).max_tokens, 1);
    assertEquals(bodyOf(call).model, "jais-2-8b-chat");
  }, { env: DEPLOYED });
});

Deno.test("a worker that refuses the wake-up is still not an error for the caller", async () => {
  await withGateway(async (mod, up) => {
    mod.warmRoute("runpod/jais-2-8b-chat");
    await Promise.allSettled(up.tasks);

    // Same contract as the four logging sinks: it swallows its own failures, so
    // it can never fail the request it was attached to. A wake-up that throws
    // into an unhandled rejection would take the edge function down over work
    // nobody was waiting for.
    assertEquals(up.callsTo("api.runpod.ai").length, 1);
  }, {
    env: DEPLOYED,
    upstreams: { "api.runpod.ai": () => json({ error: "no capacity" }, 500) },
  });
});

Deno.test("warming is a no-op for a provider that is always on", async () => {
  await withGateway(async (mod, up) => {
    mod.warmRoute("google/gemini-3.1-pro-preview");
    mod.warmRoute("Fanar-C-2-27B");
    await Promise.allSettled(up.tasks);

    // Every provider here but RunPod is somebody else's hosted API: there is no
    // worker asleep, so a wake-up would just be a billed call with its answer
    // thrown away — and against Fanar, one charged to the daily allowance that
    // is the reason it is not a standing validator leg in the first place.
    assertEquals(up.calls.length, 0);
  }, { env: DEPLOYED });
});

Deno.test("warming an undeployed runpod model reaches nothing", async () => {
  await withGateway(async (mod, up) => {
    mod.warmRoute("runpod/jais-2-8b-chat");
    await Promise.allSettled(up.tasks);

    // No endpoint id means no address, and a warm-up must not fall back to
    // whichever worker happens to be up any more than a judgment call may.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a runpod id with no address of its own never borrows a deployed worker", async () => {
  await withGateway(async (mod, up) => {
    // Each size is its own deployment at its own address, so a `runpod/` id
    // nobody has mapped is unroutable — never answered by whichever worker
    // happens to be up. Serving a 70B request on the 8B's worker would return
    // a different model under the requested name, the one substitution the
    // registry exists to prevent. The 70B is the live case: it is a real
    // upstream model deliberately not carried here.
    assertEquals(mod.tryChatRoute("runpod/jais-2-70b-chat"), null);

    await mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] });
    assertEquals(up.callsTo("eightb.api.runpod.ai").length, 1);
  }, { env: { RUNPOD_JAIS_8B_ENDPOINT_ID: "eightb", JAIS_ENABLED: "on" } });
});

Deno.test("asks Jais nothing about reasoning", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("runpod/jais-2-8b-chat", { messages: [] });

    // Jais 2 is not a reasoning model and plain vLLM has no sampler for an
    // effort field, so the default that every OpenRouter call carries must not
    // be attached here.
    const body = bodyOf(up.callsTo("api.runpod.ai")[0]);
    assertEquals("reasoning" in body, false);
    assertEquals("reasoning_effort" in body, false);
  }, { env: DEPLOYED });
});

// ── HUMAIN M3 on HUMAIN Node ────────────────────────────────────────────────

/**
 * A configured M3 is a key and nothing else — Node's base has a real default.
 * The tests still point it at a stub host, because asserting "the call reached
 * HUMAIN" must not mean "the call left the machine".
 */
const NODE = { HUMAIN_BASE_URL: "https://node.humain.test" };

Deno.test("an M3 model goes to HUMAIN Node with its vendor prefix stripped", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("humain/humain-m3", { messages: [] });

    const [call] = up.callsTo("node.humain.test");
    assert(call, "expected the call to reach HUMAIN Node");
    assertEquals(call.headers.authorization, "Bearer fixture-humain");
    // Node serves the model under its bare name; the `humain/` prefix is the
    // registry's vendor form and belongs nowhere on the wire.
    assertEquals(bodyOf(call).model, "humain-m3");
    assertEquals(mod.providerForModel("humain/humain-m3"), "humain");
  }, { env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" } });
});

Deno.test("an M3 outage is never retried on OpenRouter", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("humain/humain-m3", { messages: [] });

    // Same reasoning as Fanar: M3 is on nobody else's catalogue, so retrying
    // there would turn one real failure into a 404 about a model that was
    // never listed. Every consumer of M3 has to survive this status.
    assertEquals(response.status, 503);
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: { "node.humain.test": () => json({ error: "down" }, 503) },
  });
});

Deno.test("an unconfigured M3 is unroutable rather than quietly another model", async () => {
  await withGateway(async (mod, up) => {
    assertEquals(mod.tryChatRoute("humain/humain-m3"), null);
    await assertRejects(
      () => mod.chatFetch("humain/humain-m3", { messages: [] }),
      Error,
      "HUMAIN_NODE_API_KEY",
    );
    assertEquals(up.calls.length, 0);
  }, { env: { ...NODE, HUMAIN_NODE_API_KEY: undefined } });
});

Deno.test("a key alone is enough: Node's own base is the default", async () => {
  await withGateway(async (mod, up) => {
    // Unlike the RunPod worker, Node has a published address, so M3 must not
    // need one configured. HUMAIN_BASE_URL exists for a tenant on its own
    // gateway hostname and for these tests — not as a second required secret.
    const route = mod.tryChatRoute("humain/humain-m3");
    assert(route, "a key with no base URL should still route");
    assertEquals(route.url, "https://api.node.humain.com/v1/chat/completions");
    assertEquals(up.calls.length, 0);
  }, { env: { HUMAIN_NODE_API_KEY: "fixture-humain", HUMAIN_BASE_URL: undefined } });
});

Deno.test("an override replaces Node's base without losing the endpoint path", async () => {
  await withGateway(async (mod) => {
    // The override is a *base*, so the version segment travels with it and the
    // endpoint is appended. A trailing slash must not produce a double one.
    const route = mod.tryChatRoute("humain/humain-m3");
    assertEquals(route?.url, "https://gateway.example/v1/chat/completions");
  }, {
    env: { HUMAIN_NODE_API_KEY: "fixture-humain", HUMAIN_BASE_URL: "https://gateway.example/v1/" },
  });
});

Deno.test("asks M3 nothing about reasoning", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("humain/humain-m3", { messages: [] });

    // The preview tiers differ on whether thinking is even available, and an
    // unsupported field is a 400 on every call. Until a live key settles the
    // shape, M3 is sent no reasoning field at all.
    const body = bodyOf(up.callsTo("node.humain.test")[0]);
    assertEquals("reasoning" in body, false);
    assertEquals("reasoning_effort" in body, false);
  }, { env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" } });
});

/**
 * Node's catalogue is per key. The first live run answered every M3 call with
 * `400 Unsupported model: humain-m3` — the documented id, refused because
 * this key's catalogue did not carry it under that name, or at all. The
 * gateway asks the catalogue and retries rather than leaving the strongest
 * Arabic model in the registry unreachable over a naming question.
 */
const nodeCatalogue = (ids: string[], served?: string) => async (request: Request): Promise<Response> => {
  if (request.method === "GET" && new URL(request.url).pathname.endsWith("/models")) {
    return json({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });
  }
  const body = JSON.parse(await request.clone().text()) as { model: string };
  if (served && body.model === served) return chatCompletion("مرحبا");
  return json({ error: { message: `Unsupported model: ${body.model}`, code: "model_not_found" } }, 400);
};

Deno.test("an M3 id Node refuses is looked up in this key's catalogue and retried under the served name", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("humain/humain-m3", { messages: [] });
    assertEquals(response.status, 200);

    // The refusal, the catalogue read, the retry — in that order, one each.
    const calls = up.callsTo("node.humain.test");
    assertEquals(calls.map((c) => c.method), ["POST", "GET", "POST"]);
    assertEquals(bodyOf(calls[0]).model, "humain-m3");
    // Off the configured base, so a tenant gateway is asked at its own address.
    assertEquals(calls[1].url, "https://node.humain.test/models");
    assertEquals(calls[1].headers.authorization, "Bearer fixture-humain");
    assertEquals(bodyOf(calls[2]).model, "humain-m3-preview");

    // Remembered: the next call goes straight to the served id, no refusal first.
    await mod.chatFetch("humain/humain-m3", { messages: [] });
    const later = up.callsTo("node.humain.test");
    assertEquals(later.length, 4);
    assertEquals(bodyOf(later[3]).model, "humain-m3-preview");
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: { "node.humain.test": nodeCatalogue(["allam-2-7b", "humain-m3-preview"], "humain-m3-preview") },
  });
});

Deno.test("an embedding model that happens to carry m3 is not mistaken for the chat model", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("humain/humain-m3", { messages: [] });

    // BGE-M3 is a real embedding model with the same token in its name. It
    // is listed before the chat model here; the family match must skip it,
    // on the id and on Node's own interface metadata, and land on M3 proper.
    assertEquals(response.status, 200);
    const calls = up.callsTo("node.humain.test");
    assertEquals(calls.map((c) => c.method), ["POST", "GET", "POST"]);
    assertEquals(bodyOf(calls[2]).model, "humain-m3-v1");
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: {
      "node.humain.test": async (request: Request) => {
        if (request.method === "GET") {
          return json({ data: [
            { id: "bge-m3", node: { api_interface: "embeddings" } },
            { id: "humain-m3-embed" },
            { id: "humain-m3-v1", node: { api_interface: "chat" } },
          ] });
        }
        const body = JSON.parse(await request.clone().text()) as { model: string };
        return body.model === "humain-m3-v1"
          ? chatCompletion("مرحبا")
          : json({ error: { message: `Unsupported model: ${body.model}` } }, 400);
      },
    },
  });
});

Deno.test("an alias is remembered only once it has answered", async () => {
  await withGateway(async (mod, up) => {
    // The catalogue names a candidate that Node then refuses too. Nothing is
    // cached, so the next call starts from the registry id again rather than
    // from a guess that already failed.
    const first = await mod.chatFetch("humain/humain-m3", { messages: [] });
    assertEquals(first.status, 400);
    await mod.chatFetch("humain/humain-m3", { messages: [] });
    const posts = up.callsTo("node.humain.test").filter((c) => c.method === "POST");
    assertEquals(posts.map((c) => bodyOf(c).model), ["humain-m3", "humain-m3-preview", "humain-m3", "humain-m3-preview"]);
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: { "node.humain.test": nodeCatalogue(["humain-m3-preview"]) },
  });
});

Deno.test("a key whose catalogue has no M3 keeps the refusal, and can say what it does have", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("humain/humain-m3", { messages: [] });

    // Nothing to retry under: the refusal is the answer, and it is an access
    // question for the HUMAIN account rather than anything a deploy can fix.
    assertEquals(response.status, 400);
    assertEquals(up.callsTo("node.humain.test").map((c) => c.method), ["POST", "GET"]);
    assertEquals(mod.humainCatalogueSummary(), "this key's HUMAIN Node catalogue: allam-2-7b, humain-embed");
    assertEquals(up.callsTo(OPENROUTER).length, 0);
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: { "node.humain.test": nodeCatalogue(["allam-2-7b", "humain-embed"]) },
  });
});

Deno.test("a refusal that is not about the model does not trigger a catalogue read", async () => {
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("humain/humain-m3", { messages: [] });
    assertEquals(response.status, 400);
    assertEquals(up.callsTo("node.humain.test").length, 1);
    assertEquals(mod.humainCatalogueSummary(), null);
  }, {
    env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain" },
    upstreams: { "node.humain.test": () => json({ error: { message: "messages: too long", code: "invalid_request" } }, 400) },
  });
});

Deno.test("HUMAIN_M3_MODEL_ID names the served id outright, and no lookup is made", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("humain/humain-m3", { messages: [] });
    const [call] = up.callsTo("node.humain.test");
    assertEquals(bodyOf(call).model, "humain-m3-research");
    assertEquals(up.callsTo("node.humain.test").length, 1);
  }, { env: { ...NODE, HUMAIN_NODE_API_KEY: "fixture-humain", HUMAIN_M3_MODEL_ID: "humain-m3-research" } });
});

Deno.test("a HUMAIN key alone satisfies the Brain's provider preflight", async () => {
  await withGateway((mod) => {
    // askBrain refuses to start when no upstream at all is configured. M3 is
    // the first model the pipeline can be asked to run on its own, so a
    // deployment holding only this key must not fail before the route that
    // would have served it is built.
    assertEquals(mod.hasAnyProvider(), true);
  }, {
    env: {
      ...NODE,
      HUMAIN_NODE_API_KEY: "fixture-humain",
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
    },
  });
});

// ── Images ──────────────────────────────────────────────────────────────────

Deno.test("an image comes back as bytes from Gemini's inline data", async () => {
  await withGateway(async (mod, up) => {
    const image = await mod.generateImage("a dhow at dusk");

    assert(image, "expected an image");
    assertEquals(image.provider, "google");
    assert(image.bytes.length > 0);
    // Gemini's native endpoint, not the OpenAI-shaped one: image output does
    // not exist on the compatibility surface.
    assert(up.callsTo("-image:generateContent").length > 0);
  }, { upstreams: { "-image:generateContent": () => geminiImage() } });
});

Deno.test("a refusing Gemini falls through to OpenAI's image model", async () => {
  await withGateway(async (mod, up) => {
    const image = await mod.generateImage("a dhow at dusk");

    assert(image, "expected the fallback to produce an image");
    assertEquals(image.provider, "openai");
    assert(up.callsTo("api.openai.com/v1/images/generations").length > 0);
  }, {
    upstreams: {
      "-image:generateContent": () => json({ error: "refused" }, 400),
      "api.openai.com/v1/images/generations": () => openaiImage(),
    },
  });
});

Deno.test("every leg refusing is a null, not a throw", async () => {
  await withGateway(async (mod) => {
    // Callers decide whether a missing image is fatal — for a flashcard it is a
    // "try again" message, for a story render it fails the scene.
    assertEquals(await mod.generateImage("a dhow at dusk"), null);
  }, {
    upstreams: {
      "-image:generateContent": () => json({ error: "refused" }, 400),
      "api.openai.com/v1/images/generations": () => json({ error: "refused" }, 400),
      [OPENROUTER]: () => chatCompletion("no picture here"),
    },
  });
});

// ── Reasoning ────────────────────────────────────────────────────────────────
//
// Whether a model thinks before it answers is a provider default, and the
// lineup that replaced the pre-2026-08-31 one reasons by default: Sonnet 5 at
// "high", Qwen 3.8 Max at "xhigh" (and mandatory), Gemini 3.x Flash at
// "medium". Nothing asked for that, and the transcript merge went from a
// forty-second call to one that thought for minutes and spent its output
// budget doing it. The gateway now asks for the least a model allows unless
// the caller says otherwise — and, since OpenRouter answers 400 to an effort a
// model does not support, retries a rejected default once without it.

Deno.test("asks an OpenRouter model for no reasoning unless told otherwise", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("anthropic/claude-sonnet-5", { messages: [] });

    const [call] = up.callsTo(OPENROUTER);
    assert(call);
    assertEquals(bodyOf(call).reasoning, { effort: "none" });
  });
});

Deno.test("asks a model that must reason for its floor, never for none", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("qwen/qwen3.8-max", { messages: [] });

    const [call] = up.callsTo(OPENROUTER);
    assert(call);
    // Qwen 3.8 Max cannot be switched off; "minimal" is the least it takes.
    assertEquals(bodyOf(call).reasoning, { effort: "minimal" });
  });
});

Deno.test("spells the reasoning default the way Google's endpoint takes it", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("google/gemini-3.7-flash", { messages: [] });

    const [call] = up.callsTo(GOOGLE);
    assert(call);
    // Google's OpenAI-shaped endpoint takes `reasoning_effort`, and Gemini 3.x
    // cannot be turned off, so the least it accepts is "low".
    assertEquals(bodyOf(call).reasoning_effort, "low");
    assertEquals(bodyOf(call).reasoning, undefined);
  });
});

Deno.test("leaves a caller's own reasoning field exactly as written", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("anthropic/claude-sonnet-5", {
      messages: [],
      reasoning: { effort: "high", max_tokens: 4000 },
    });

    const [call] = up.callsTo(OPENROUTER);
    assert(call);
    assertEquals(bodyOf(call).reasoning, { effort: "high", max_tokens: 4000 });
  });
});

Deno.test("sends nothing about reasoning when a caller wants the model's default", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("anthropic/claude-sonnet-5", { messages: [] }, { reasoning: "model-default" });

    const [call] = up.callsTo(OPENROUTER);
    assert(call);
    assertEquals("reasoning" in bodyOf(call), false);
    assertEquals("reasoning_effort" in bodyOf(call), false);
  });
});

Deno.test("lets a caller ask for a specific level", async () => {
  await withGateway(async (mod, up) => {
    await mod.chatFetch("anthropic/claude-sonnet-5", { messages: [] }, { reasoning: { effort: "medium" } });

    const [call] = up.callsTo(OPENROUTER);
    assert(call);
    assertEquals(bodyOf(call).reasoning, { effort: "medium" });
  });
});

Deno.test("retries once without the default when a provider rejects it", async () => {
  // The floor table is a reading of each model's metadata, not a contract; a
  // wrong reading must cost a round trip, not every call for that model.
  let seen = 0;
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("mistralai/mistral-saba", { messages: [] });

    const calls = up.callsTo(OPENROUTER);
    assertEquals(calls.length, 2);
    assertEquals(bodyOf(calls[0]).reasoning, { effort: "none" });
    assertEquals("reasoning" in bodyOf(calls[1]), false);
    assertEquals(response.status, 200);
    assert(seen === 2);
  }, {
    upstreams: {
      "openrouter.ai": (request) => {
        seen += 1;
        return seen === 1
          ? json({ error: { message: "reasoning is not supported for this model" } }, 400)
          : chatCompletion("ok");
      },
    },
  });
});

Deno.test("does not retry a 400 the caller's own body earned", async () => {
  let seen = 0;
  await withGateway(async (mod, up) => {
    const response = await mod.chatFetch("anthropic/claude-sonnet-5", { messages: [] }, { reasoning: "model-default" });
    assertEquals(response.status, 400);
    assertEquals(up.callsTo(OPENROUTER).length, 1);
  }, {
    upstreams: {
      "openrouter.ai": () => {
        seen += 1;
        return json({ error: { message: "bad request" } }, 400);
      },
    },
  });
  assertEquals(seen, 1);
});
