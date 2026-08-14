import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `ttsVoiceRouting` — secrets, Munsit catalogue discovery, and the fallback chain.
 *
 * The decision logic is pure and lives in `ttsVoiceRoutingCore`, exercised from
 * Vitest against fixtures. What can only be tested here is everything that half
 * cannot touch: which secrets are read and how a malformed one degrades, what a
 * failed `/voices` call does, and whether a dead provider produces audio anyway.
 *
 * Note the module memoises the catalogue at module scope. `loadSharedModule`
 * re-evaluates it per call, which is what keeps these tests independent — a
 * static import would share one cache across the whole file.
 */

interface RoutingModule {
  parseVoiceIds(raw: string | undefined | null, max?: number): string[];
  planForDialect(
    dialect: string,
    opts?: { minVoices?: number },
  ): Promise<{ provider: string; voices: string[]; source: string; ext: string; modelId?: string }>;
  synthesizeForDialect(
    text: string,
    dialect: string,
    opts?: Record<string, unknown>,
  ): Promise<{ bytes: Uint8Array; plan: { provider: string; source: string } }>;
}

/** Munsit's catalogue, in the shape `GET /voices` returns. */
const CATALOGUE = [
  { voice_id: "ar-najdi-male-1", name: "Najdi", gender: "male", dialect: ["najdi", "khaleeji"], type: "neural" },
  { voice_id: "PCtWbxjoNTpVQ6gIPaVZ2Hqm", name: "Emirati", gender: "male", dialect: ["emirati"], type: "neural" },
  { voice_id: "ar-hijazi-female-1", name: "Hijazi", gender: "female", dialect: ["hijazi"], type: "neural" },
  { voice_id: "ar-masri-male-1", name: "Masri", gender: "male", dialect: ["masri"], type: "neural" },
  { voice_id: "ar-fusha-male-1", name: "Fusha", gender: "male", dialect: ["fusha"], type: "neural" },
  // A cloned voice, exactly as Munsit returns one: every descriptive field null.
  { voice_id: "cl-friend-8f21", name: "Yemeni friend", gender: null, dialect: null, type: null },
];

function munsitUpstreams(extra: Record<string, UpstreamHandler> = {}) {
  return {
    "api.munsit.com/api/v1/voices": () => json(CATALOGUE),
    "api.munsit.com/api/v1/models": () => json([{ model_id: "faseeh-v1-preview" }]),
    ...extra,
  };
}

async function withRouting<T>(
  opts: { env?: Record<string, string | undefined>; upstreams?: Record<string, UpstreamHandler> },
  run: (mod: RoutingModule) => Promise<T>,
): Promise<T> {
  const stub = stubUpstreams({
    // The fixture environment pins both of these. Cleared by default so each
    // test states its own configuration — with MUNSIT_GULF_VOICE_ID left set,
    // every Gulf plan comes back `munsit-pinned` and the tag matching this file
    // exists to check is never reached.
    env: { MUNSIT_TTS_MODEL_ID: undefined, MUNSIT_GULF_VOICE_ID: undefined, ...opts.env },
    upstreams: munsitUpstreams(opts.upstreams),
  });
  try {
    return await run(await loadSharedModule<RoutingModule>("ttsVoiceRouting"));
  } finally {
    stub.restore();
  }
}

// ── The headline claim ───────────────────────────────────────────────────────

Deno.test("every dialect resolves to a Munsit voice with the right tag", async () => {
  await withRouting({}, async (mod) => {
    const expected: Array<[string, string]> = [
      ["Gulf", "ar-najdi-male-1"],
      ["Egyptian", "ar-masri-male-1"],
      ["MSA", "ar-fusha-male-1"],
    ];
    for (const [dialect, voice] of expected) {
      const plan = await mod.planForDialect(dialect, { minVoices: 1 });
      assertEquals(plan.provider, "munsit", `${dialect} should be Munsit`);
      assertEquals(plan.source, "munsit-native", `${dialect} should match its own tag`);
      assertEquals(plan.voices[0], voice);
      assertEquals(plan.ext, "wav");
    }
  });
});

Deno.test("Yemeni borrows a Gulf voice rather than falling to Azure", async () => {
  await withRouting({}, async (mod) => {
    const yemeni = await mod.planForDialect("Yemeni", { minVoices: 1 });
    const gulf = await mod.planForDialect("Gulf", { minVoices: 1 });

    assertEquals(yemeni.provider, "munsit");
    assertEquals(yemeni.source, "munsit-gulf-fallback");
    // The accent is a compromise; sounding identical to Gulf would not be.
    assert(
      yemeni.voices[0] !== gulf.voices[0],
      `Yemeni led with ${yemeni.voices[0]}, the same voice as Gulf`,
    );
  });
});

Deno.test("resolves the Faseeh model from /models when no override is set", async () => {
  await withRouting({}, async (mod) => {
    const plan = await mod.planForDialect("Gulf", { minVoices: 1 });
    assertEquals(plan.modelId, "faseeh-v1-preview");
  });
});

// ── Secrets ──────────────────────────────────────────────────────────────────

Deno.test("a pinned Yemeni voice selects the clone", async () => {
  // The clone is in the catalogue but has no dialect or gender, so tag matching
  // can never reach it. The pin is the only route to a cloned voice.
  await withRouting({ env: { MUNSIT_YEMENI_VOICE_IDS: "cl-friend-8f21" } }, async (mod) => {
    const plan = await mod.planForDialect("Yemeni", { minVoices: 1 });
    assertEquals(plan.source, "munsit-pinned");
    assertEquals(plan.voices, ["cl-friend-8f21"]);
  });
});

Deno.test("two pinned voices keep the order they were configured in", async () => {
  await withRouting({ env: { MUNSIT_YEMENI_VOICE_IDS: "cl-a,cl-b" } }, async (mod) => {
    assertEquals((await mod.planForDialect("Yemeni", { minVoices: 2 })).voices, ["cl-a", "cl-b"]);
  });
});

Deno.test("one pinned voice does not voice both hosts unless allowed", async () => {
  await withRouting({ env: { MUNSIT_YEMENI_VOICE_IDS: "cl-friend-8f21" } }, async (mod) => {
    assertEquals((await mod.planForDialect("Yemeni", { minVoices: 2 })).source, "munsit-gulf-fallback");
  });
  await withRouting({
    env: {
      MUNSIT_YEMENI_VOICE_IDS: "cl-friend-8f21",
      TTS_ALLOW_SINGLE_VOICE_EPISODES: "true",
    },
  }, async (mod) => {
    const plan = await mod.planForDialect("Yemeni", { minVoices: 2 });
    assertEquals(plan.source, "munsit-pinned");
    assertEquals(plan.voices, ["cl-friend-8f21", "cl-friend-8f21"]);
  });
});

Deno.test("the legacy single-value Gulf secret still pins", async () => {
  // An existing deployment sets MUNSIT_GULF_VOICE_ID. Renaming the secret out
  // from under it would silently change which voice Gulf learners hear.
  await withRouting({ env: { MUNSIT_GULF_VOICE_ID: "ar-hijazi-female-1" } }, async (mod) => {
    const plan = await mod.planForDialect("Gulf", { minVoices: 1 });
    assertEquals(plan.source, "munsit-pinned");
    assertEquals(plan.voices, ["ar-hijazi-female-1"]);
  });
});

Deno.test("TTS_PROVIDER_<DIALECT> rolls a dialect back to Azure", async () => {
  await withRouting({
    env: { MUNSIT_YEMENI_VOICE_IDS: "cl-friend-8f21", TTS_PROVIDER_YEMENI: "azure" },
  }, async (mod) => {
    const yemeni = await mod.planForDialect("Yemeni", { minVoices: 1 });
    assertEquals(yemeni.provider, "azure");
    assertEquals(yemeni.voices[0], "ar-YE-MaryamNeural");

    // The lever is per dialect: nothing else moves.
    assertEquals((await mod.planForDialect("Gulf", { minVoices: 1 })).provider, "munsit");
  });
});

Deno.test("parseVoiceIds accepts both Munsit id shapes and rejects junk", async () => {
  await withRouting({}, async (mod) => {
    // Munsit's docs warn there is no id convention: opaque ids, readable ids and
    // cloned ids all coexist. Validation is shape-only for exactly that reason.
    assertEquals(mod.parseVoiceIds("PCtWbxjoNTpVQ6gIPaVZ2Hqm"), ["PCtWbxjoNTpVQ6gIPaVZ2Hqm"]);
    assertEquals(mod.parseVoiceIds("ar-najdi-male-2"), ["ar-najdi-male-2"]);
    assertEquals(mod.parseVoiceIds("cl-layla-8f21"), ["cl-layla-8f21"]);
    assertEquals(mod.parseVoiceIds("cl-a, cl-b"), ["cl-a", "cl-b"]);

    assertEquals(mod.parseVoiceIds(undefined), []);
    assertEquals(mod.parseVoiceIds("   "), []);
    assertEquals(mod.parseVoiceIds("<script>alert(1)</script>"), []);
    // Splitting on whitespace would make this four tokens, two of which pass a
    // shape check — so a pasted sentence would silently become a voice list.
    assertEquals(mod.parseVoiceIds("not a voice id at all!"), []);
    // Too short to be a real id — an accidental single character must not
    // become a voice reference.
    assertEquals(mod.parseVoiceIds("a1"), []);
    // A cap, so a runaway secret cannot be turned into an unbounded voice list.
    assertEquals(mod.parseVoiceIds("aa1,bb2,cc3,dd4,ee5,ff6,gg7").length, 4);
  });
});

Deno.test("a malformed pin is treated as unconfigured, not as an open list", async () => {
  await withRouting({ env: { MUNSIT_YEMENI_VOICE_IDS: "https://evil.example/voice" } }, async (mod) => {
    const plan = await mod.planForDialect("Yemeni", { minVoices: 1 });
    assertEquals(plan.source, "munsit-gulf-fallback");
    assert(
      !plan.voices.some((v) => v.includes("evil")),
      "a rejected id must never reach the voice list",
    );
  });
});

// ── Discovery failures ───────────────────────────────────────────────────────

Deno.test("no Munsit key falls all the way to Azure", async () => {
  await withRouting({ env: { MUNSIT_API_KEY: undefined } }, async (mod) => {
    const plan = await mod.planForDialect("Yemeni", { minVoices: 2 });
    assertEquals(plan.provider, "azure");
    assertEquals(plan.source, "azure-emergency");
    assertEquals(plan.voices, ["ar-YE-MaryamNeural", "ar-YE-SalehNeural"]);
  });
});

Deno.test("a failing /voices call falls to Azure", async () => {
  await withRouting({
    upstreams: {
      "api.munsit.com/api/v1/voices": () => new Response("upstream down", { status: 503 }),
    },
  }, async (mod) => {
    assertEquals((await mod.planForDialect("Gulf", { minVoices: 1 })).source, "azure-emergency");
  });
});

Deno.test("a failed discovery is not cached for the life of the isolate", async () => {
  // Caching an empty catalogue would demote every dialect to Azure until the
  // next cold start — the failure mode this endpoint exists to make visible.
  let attempt = 0;
  await withRouting({
    upstreams: {
      "api.munsit.com/api/v1/voices": () =>
        ++attempt === 1 ? new Response("nope", { status: 503 }) : json(CATALOGUE),
    },
  }, async (mod) => {
    assertEquals((await mod.planForDialect("Gulf", { minVoices: 1 })).source, "azure-emergency");
    assertEquals((await mod.planForDialect("Gulf", { minVoices: 1 })).source, "munsit-native");
  });
});

Deno.test("Egyptian keeps its native ElevenLabs voices when Munsit has none", async () => {
  // Downgrading Egyptian to a Gulf voice to satisfy "all Munsit" would be worse
  // than the status quo, so ElevenLabs sits between Munsit and Azure.
  await withRouting({
    upstreams: {
      "api.munsit.com/api/v1/voices": () =>
        json(CATALOGUE.filter((v) => !v.dialect?.includes("masri"))),
    },
  }, async (mod) => {
    const plan = await mod.planForDialect("Egyptian", { minVoices: 2 });
    assertEquals(plan.provider, "elevenlabs");
    assertEquals(plan.source, "elevenlabs-egyptian");
  });
});

// ── Synthesis ────────────────────────────────────────────────────────────────

Deno.test("synthesizeForDialect sends the resolved voice to Munsit", async () => {
  const stub = stubUpstreams({
    env: { MUNSIT_TTS_MODEL_ID: undefined },
    upstreams: munsitUpstreams({
      "api.munsit.com/api/v1/text-to-speech": () =>
        new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
    }),
  });
  try {
    const mod = await loadSharedModule<RoutingModule>("ttsVoiceRouting");
    const { plan } = await mod.synthesizeForDialect("مرحبا", "Yemeni", { minVoices: 1 });
    assertEquals(plan.provider, "munsit");

    const call = stub.calls.find((c) => c.url.includes("text-to-speech"));
    assert(call, "expected a call to Munsit's synthesis endpoint");
    const body = JSON.parse(call.body ?? "{}");
    assertEquals(body.text, "مرحبا");
    assertEquals(body.voice_id, "PCtWbxjoNTpVQ6gIPaVZ2Hqm"); // Gulf list, rotated
  } finally {
    stub.restore();
  }
});

Deno.test("a dead Munsit still produces audio, via Azure", async () => {
  // Every dialect now shares one Munsit account, so an outage is an outage for
  // the whole app rather than a third of it. Azure is the floor.
  const stub = stubUpstreams({
    upstreams: munsitUpstreams({
      "api.munsit.com/api/v1/text-to-speech": () => new Response("rate limited", { status: 429 }),
    }),
  });
  try {
    const mod = await loadSharedModule<RoutingModule>("ttsVoiceRouting");
    const { bytes, plan } = await mod.synthesizeForDialect("مرحبا", "Gulf", { minVoices: 1 });

    assertEquals(plan.provider, "azure");
    assert(bytes.length > 0, "expected audio bytes from the fallback");
    assert(
      stub.calls.some((c) => c.url.includes("tts.speech.microsoft.com")),
      "expected Azure to have been called",
    );
  } finally {
    stub.restore();
  }
});
