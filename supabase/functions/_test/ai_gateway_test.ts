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
