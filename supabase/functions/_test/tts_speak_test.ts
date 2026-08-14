import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * "tts-speak" — the app's text-to-speech endpoint.
 *
 * Callers name a dialect, never a voice. That is the whole design: which
 * provider and which voice serve a dialect is server configuration, so pointing
 * Yemeni at a cloned voice is a secret rather than a frontend deploy — and the
 * six call sites that each carried their own dialect→voice table, and disagreed
 * with each other about Yemeni, now cannot.
 *
 * Like the three per-provider functions it sits alongside, this runs with
 * `verify_jwt = false` and spends money per call, so the anonymous path matters.
 * And like them, *bytes with the right content type* is the whole interface: a
 * JSON body on a 200 is an unplayable source.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const CATALOGUE = [
  { voice_id: "ar-najdi-male-1", name: "Najdi", gender: "male", dialect: ["najdi", "khaleeji"], type: "neural" },
  { voice_id: "ar-emirati-male-1", name: "Emirati", gender: "male", dialect: ["emirati"], type: "neural" },
  { voice_id: "ar-masri-male-1", name: "Masri", gender: "male", dialect: ["masri"], type: "neural" },
  { voice_id: "ar-fusha-male-1", name: "Fusha", gender: "male", dialect: ["fusha"], type: "neural" },
];

const wav = (): UpstreamHandler => () =>
  new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
    status: 200,
    headers: { "content-type": "audio/wav" },
  });

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "api.munsit.com/api/v1/voices": () => json(CATALOGUE),
    "api.munsit.com/api/v1/models": () => json([{ model_id: "faseeh-v1-preview" }]),
    "api.munsit.com/api/v1/text-to-speech": wav(),
    ...extra,
  };
}

async function call(
  body: unknown,
  opts: {
    jwt?: string | null;
    env?: Record<string, string | undefined>;
    upstreams?: Record<string, UpstreamHandler>;
  } = {},
) {
  const fn = await loadFunction("tts-speak", {
    // Cleared so each test states its own configuration; the fixture env pins
    // both, which would short-circuit the routing under test.
    env: { MUNSIT_TTS_MODEL_ID: undefined, MUNSIT_GULF_VOICE_ID: undefined, ...opts.env },
    upstreams: upstreams(opts.upstreams),
  });
  try {
    const response = await fn.handler(
      jsonRequest("tts-speak", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Audio, not JSON — which is the success case.
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      provider: response.headers.get("x-tts-provider") ?? "",
      source: response.headers.get("x-tts-source") ?? "",
      bytes: buffer.byteLength,
      parsed,
      calls: fn.calls,
      callsTo: fn.callsTo,
    };
  } finally {
    fn.restore();
  }
}

// ── The happy path, per dialect ──────────────────────────────────────────────

Deno.test("tts-speak answers with Munsit audio for every dialect", async () => {
  for (const dialect of ["Gulf", "Egyptian", "Yemeni", "MSA"]) {
    const res = await call({ text: "كيف حالك", dialect });
    assertEquals(res.status, 200, `${dialect} should succeed`);
    assertEquals(res.contentType, "audio/wav", `${dialect} should be Munsit WAV`);
    assertEquals(res.provider, "munsit", `${dialect} should route to Munsit`);
    assert(res.bytes > 0, `${dialect} returned no bytes`);
    // A JSON body on a 200 is an unplayable <audio> source.
    assertEquals(Object.keys(res.parsed).length, 0);
  }
});

Deno.test("tts-speak reports which rung produced the audio", async () => {
  const gulf = await call({ text: "مرحبا", dialect: "Gulf" });
  assertEquals(gulf.source, "munsit-native");

  // Yemeni has no Munsit voice of its own, so it borrows Gulf's — and says so.
  const yemeni = await call({ text: "مرحبا", dialect: "Yemeni" });
  assertEquals(yemeni.source, "munsit-gulf-fallback");
});

Deno.test("tts-speak gives Yemeni a different voice from Gulf", async () => {
  const voiceSentFor = async (dialect: string) => {
    const res = await call({ text: "مرحبا", dialect });
    const call_ = res.callsTo("text-to-speech")[0];
    return JSON.parse(call_.body ?? "{}").voice_id as string;
  };
  assert(
    (await voiceSentFor("Yemeni")) !== (await voiceSentFor("Gulf")),
    "Yemeni and Gulf must not share a lead voice",
  );
});

Deno.test("tts-speak defaults to Gulf when no dialect is given", async () => {
  const res = await call({ text: "مرحبا" });
  assertEquals(res.status, 200);
  assertEquals(res.provider, "munsit");
});

// ── Voices are configuration, never input ────────────────────────────────────

Deno.test("tts-speak ignores a caller-supplied voice", async () => {
  // The reason this endpoint takes no voice parameter: there is no allow-list to
  // maintain because there is nothing to allow. A caller cannot reach a premium
  // or arbitrary voice by naming one, however it is spelled.
  const res = await call({
    text: "مرحبا",
    dialect: "Gulf",
    voice: "ar-YE-MaryamNeural",
    voiceId: "some-expensive-voice",
    voice_id: "another-one",
  });

  assertEquals(res.status, 200);
  const body = JSON.parse(res.callsTo("text-to-speech")[0].body ?? "{}");
  assertEquals(body.voice_id, "ar-najdi-male-1");

  const sent = JSON.stringify(res.calls.map((c) => c.body));
  assert(!sent.includes("some-expensive-voice"), "a caller-supplied id reached an upstream");
  assert(!sent.includes("ar-YE-MaryamNeural"), "a caller-supplied id reached an upstream");
});

Deno.test("tts-speak honours the per-dialect rollback lever", async () => {
  const res = await call({ text: "مرحبا", dialect: "Yemeni" }, {
    env: { TTS_PROVIDER_YEMENI: "azure" },
  });
  assertEquals(res.provider, "azure");
  assertEquals(res.source, "azure-emergency");
  assertEquals(res.contentType, "audio/mpeg");
});

Deno.test("tts-speak uses a pinned cloned voice once one is configured", async () => {
  const res = await call({ text: "مرحبا", dialect: "Yemeni" }, {
    env: { MUNSIT_YEMENI_VOICE_IDS: "cl-friend-8f21" },
  });
  assertEquals(res.source, "munsit-pinned");
  assertEquals(JSON.parse(res.callsTo("text-to-speech")[0].body ?? "{}").voice_id, "cl-friend-8f21");
});

// ── Degradation ──────────────────────────────────────────────────────────────

Deno.test("tts-speak still returns audio when Munsit is down", async () => {
  // Every dialect shares one Munsit account now, so an outage is an outage for
  // the whole app. Azure is the floor, and the headers say it was used.
  const res = await call({ text: "مرحبا", dialect: "Gulf" }, {
    upstreams: {
      "api.munsit.com/api/v1/text-to-speech": () => new Response("rate limited", { status: 429 }),
    },
  });

  assertEquals(res.status, 200);
  assertEquals(res.provider, "azure");
  assertEquals(res.contentType, "audio/mpeg");
  assert(res.bytes > 0);
});

Deno.test("tts-speak answers 502 when every provider fails", async () => {
  const res = await call({ text: "مرحبا", dialect: "Gulf" }, {
    upstreams: {
      "api.munsit.com/api/v1/text-to-speech": () => new Response("down", { status: 500 }),
      "tts.speech.microsoft.com": () => new Response("down", { status: 500 }),
    },
  });
  assertEquals(res.status, 502);
  assertEquals(res.parsed.error, "TTS_FAILED");
});

// ── Contract ─────────────────────────────────────────────────────────────────

Deno.test("tts-speak rejects an empty body", async () => {
  for (const body of [{}, { text: "" }, { text: "   " }, { text: "", dialect: "Gulf" }]) {
    const res = await call(body);
    assertEquals(res.status, 400);
    assertStringIncludes(String(res.parsed.error), "text");
  }
});

Deno.test("tts-speak refuses an anonymous caller", async () => {
  // The daily cap is the only access control on a function that spends money.
  const res = await call({ text: "مرحبا", dialect: "Gulf" }, { jwt: null });
  assertEquals(res.status, 401);
});

Deno.test("tts-speak answers a CORS preflight without spending anything", async () => {
  const fn = await loadFunction("tts-speak", { upstreams: upstreams() });
  try {
    const res = await fn.handler(optionsRequest("tts-speak"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("access-control-allow-origin"), "https://hakiya.app");
    assertEquals(fn.callsTo("api.munsit.com").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("tts-speak caps the text it will synthesize", async () => {
  const res = await call({ text: "ا".repeat(9000), dialect: "Gulf" });
  assertEquals(res.status, 200);
  const body = JSON.parse(res.callsTo("text-to-speech")[0].body ?? "{}");
  assert(
    (body.text as string).length <= 2000,
    `sent ${(body.text as string).length} characters upstream`,
  );
});
