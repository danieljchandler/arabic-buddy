import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NO_AI_PROVIDER, jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-word-jingle` — a sung mnemonic for a saved word.
 *
 * Two model calls in series and a binary conversion at the end, which is where
 * the substance is. Google's Lyria returns raw PCM (`audio/L16`) as often as
 * it returns MP3, and a browser will not play headerless PCM — so the function
 * synthesises a RIFF/WAVE header around it. Get that wrong and the learner
 * downloads a file that plays as silence or as white noise, with nothing
 * upstream reporting a failure.
 *
 * It answers base64 in JSON rather than raw bytes for a related reason:
 * `functions.invoke` coerces a binary body through UTF-8 in some environments,
 * which corrupts the audio in exactly the same undetectable way.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    ...extra,
  };
}

/** The prompt-writing model, which answers `{ lyrics, prompt }` as prose. */
const promptWriter = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(typeof payload === "string" ? payload : JSON.stringify(payload));

/** Lyria's answer: audio as base64 inline data. */
const lyria = (bytes: Uint8Array, mimeType: string): UpstreamHandler => () =>
  json({
    candidates: [
      {
        content: {
          parts: [
            { inlineData: { data: btoa(String.fromCharCode(...bytes)), mimeType } },
          ],
        },
      },
    ],
  });

/** Sixteen bytes of "PCM": eight 16-bit samples. */
const PCM = new Uint8Array(16).fill(7);

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  env?: Record<string, string | undefined>,
) {
  const fn = await loadFunction("generate-word-jingle", { upstreams, env });
  try {
    const response = await fn.handler(jsonRequest("generate-word-jingle", body));
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
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

/** Decode the base64 audio the function returned. */
const decode = (base64: unknown) =>
  Uint8Array.from(atob(String(base64)), (c) => c.charCodeAt(0));

const aWord = { word_arabic: "كتاب", word_english: "book", dialect: "Gulf" };

Deno.test("generate-word-jingle returns base64 audio with its type and extension", async () => {
  const { status, body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب كتاب", prompt: "Khaliji pop" }),
      "models/lyria": lyria(new Uint8Array([1, 2, 3, 4]), "audio/mpeg"),
    }),
  );

  assertEquals(status, 200);
  // The caller uploads this to storage, so it needs all three: the bytes, the
  // content type to store them under, and the extension to name the file.
  assertEquals(body.mimeType, "audio/mpeg");
  assertEquals(body.extension, "mp3");
  assertEquals(decode(body.audioBase64), new Uint8Array([1, 2, 3, 4]));
  assertEquals(body.lyrics, "كتاب كتاب");
});

Deno.test("generate-word-jingle wraps raw PCM in a WAV header", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "models/lyria": lyria(PCM, "audio/L16;rate=24000"),
    }),
  );

  const out = decode(body.audioBase64);
  // Lyria returns headerless PCM as often as MP3, and no browser plays that.
  // Without the header the learner gets a file that fails silently.
  assertEquals(body.mimeType, "audio/wav");
  assertEquals(body.extension, "wav");
  assertEquals(String.fromCharCode(...out.slice(0, 4)), "RIFF");
  assertEquals(String.fromCharCode(...out.slice(8, 12)), "WAVE");
  assertEquals(out.length, 44 + PCM.length);
});

Deno.test("generate-word-jingle takes the sample rate from the mime type", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "models/lyria": lyria(PCM, "audio/L16;rate=24000"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Wrong sample rate plays the jingle at the wrong pitch and speed — which
  // for a *pronunciation* mnemonic is worse than not playing at all.
  assertEquals(view.getUint32(24, true), 24000);
  // Byte rate = rate × channels × bytes per sample.
  assertEquals(view.getUint32(28, true), 24000 * 2);
});

Deno.test("generate-word-jingle assumes 48kHz when the rate is not stated", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "models/lyria": lyria(PCM, "audio/L16"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assertEquals(view.getUint32(24, true), 48000);
});

Deno.test("generate-word-jingle trims an odd trailing byte off the PCM", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "models/lyria": lyria(new Uint8Array(15).fill(7), "audio/L16;rate=48000"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // 16-bit samples come in pairs. A declared data size with a half sample in it
  // makes some players reject the file outright.
  assertEquals(view.getUint32(40, true), 14);
  assertEquals(out.length, 44 + 14);
});

Deno.test("generate-word-jingle leaves MP3 alone", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "models/lyria": lyria(new Uint8Array([0xff, 0xfb, 1, 2]), "audio/mpeg"),
    }),
  );

  // Only L16/PCM gets a header. Prepending RIFF to an MP3 would corrupt it.
  assertEquals(decode(body.audioBase64), new Uint8Array([0xff, 0xfb, 1, 2]));
  assertEquals(body.extension, "mp3");
});

Deno.test("generate-word-jingle sings the lyrics it wrote", async () => {
  const { bodies, calls } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({
        lyrics: "كِتاب كِتاب، بَين إيديّ",
        prompt: "Khaliji pop, upbeat",
      }),
      "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  const i = calls.findIndex((u) => u.includes("models/lyria"));
  const sent = bodies[i] ?? "";
  // Two calls in series: the first writes lyrics and a style, the second sings
  // them. Sending only the style produces a tune with no word in it, which is
  // not a mnemonic.
  assertStringIncludes(sent, "كِتاب كِتاب، بَين إيديّ");
  assertStringIncludes(sent, "Khaliji pop, upbeat");
});

Deno.test("generate-word-jingle falls back to the raw text when the plan is unparsable", async () => {
  const { status, body, bodies, calls } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter("Just make it sound Khaliji and cheerful."),
      "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  // Prose instead of JSON still describes a song. Better a jingle with no
  // written lyrics than no jingle.
  assertEquals(status, 200);
  assertEquals(body.lyrics, null);
  const i = calls.findIndex((u) => u.includes("models/lyria"));
  assertStringIncludes(bodies[i] ?? "", "Khaliji and cheerful");
});

Deno.test("generate-word-jingle strips markdown fences from the plan", async () => {
  const { body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter(
        '```json\n{"lyrics":"كتاب","prompt":"pop"}\n```',
      ),
      "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  assertEquals(body.lyrics, "كتاب");
});

Deno.test("generate-word-jingle picks a style per dialect", async () => {
  for (
    const [dialect, marker] of [
      ["Gulf", "Khaliji"],
      ["Egyptian", "shaabi"],
      ["Yemeni", "Yemeni folk-pop"],
    ] as const
  ) {
    const { bodies, calls } = await call(
      { ...aWord, dialect },
      caller({
        "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "x", prompt: "p" }),
        "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
    );

    const i = calls.findIndex((u) => u.includes("chat/completions"));
    // A Gulf word sung in shaabi teaches the wrong prosody along with the word.
    assertStringIncludes(bodies[i] ?? "", marker);
  }
});

Deno.test("generate-word-jingle refuses a request missing either half", async () => {
  for (const body of [{ word_english: "book" }, { word_arabic: "كتاب" }, {}]) {
    const { status, calls } = await call(
      body,
      caller({
        "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "x", prompt: "p" }),
        "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
    );

    assertEquals(status, 400);
    assert(!calls.some((u) => u.includes("chat/completions")));
  }
});

Deno.test("generate-word-jingle refuses an empty music prompt", async () => {
  const { status, body, calls } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter(""),
      "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  // Lyria given an empty prompt bills for a generation and returns something
  // arbitrary, so the check is in front of it rather than after.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Empty music prompt");
  assert(!calls.some((u) => u.includes("models/lyria")));
});

Deno.test("generate-word-jingle names each missing dependency", async () => {
  // Two legs with different needs. The lyric writer takes any provider
  // aiGateway can route to, so it is only unconfigured when all of them are
  // missing; Lyria is Google's alone and needs GEMINI_API_KEY by name. Both are
  // checked before either is called — a half-configured deployment otherwise
  // fails after paying for the first call.
  const missing: Array<[Record<string, string | undefined>, string]> = [
    [NO_AI_PROVIDER, "No AI provider"],
    [{ GEMINI_API_KEY: undefined }, "GEMINI_API_KEY"],
  ];
  for (const [env, message] of missing) {
    const { status, body, calls } = await call(
      aWord,
      caller({
        "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "x", prompt: "p" }),
        "models/lyria": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
      env,
    );

    assertEquals(status, 500);
    assertStringIncludes(String(body.error), message);
    assert(!calls.some((u) => u.includes("chat/completions")));
  }
});

Deno.test("generate-word-jingle reports a safety-filtered generation", async () => {
  const { status, body } = await call(
    aWord,
    caller({
      "generativelanguage.googleapis.com/v1beta/openai": promptWriter({ lyrics: "x", prompt: "p" }),
      "models/lyria": () =>
        json({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    }),
  );

  // Named, and it suggests the way out. A blocked generation looks identical
  // to an outage otherwise, and the learner can fix this one by trying another
  // word.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "safety filter");
  assertStringIncludes(String(body.error), "Try a different word");
});

// ── The shared path (`share: true`) ─────────────────────────────────────────
//
// A jingle for a word another learner already has one for is that learner's
// jingle: no lyric call, no Lyria call, nothing charged. A new one is filed for
// the next learner only when its lyrics pass the leak detector and are what was
// actually sung — the store serves every learner, so nothing in it is Fusha.

const LYRIC_ROUTE = "generativelanguage.googleapis.com/v1beta/openai";

const aStoredJingle = {
  id: "asset-1",
  concept_key: "كتاب|book",
  kind: "jingle",
  dialect: "Gulf",
  style_version: "jingle-1",
  url: "https://cdn.test/shared-kitab-jingle.wav",
  payload: { lyrics: "كتاب كتاب يا حلو الكتاب" },
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

/** A `word_assets` that records what was filed and answers `stored` to reads. */
function assetStore(stored: unknown[] = []) {
  const filed: Record<string, unknown>[] = [];
  const handler: UpstreamHandler = async (request) => {
    if (request.method === "GET") return json(stored);
    const row = JSON.parse(await request.text()) as Record<string, unknown>;
    filed.push(row);
    return json({ id: "asset-new", approved_at: null, created_at: "2026-10-09T00:00:00Z", ...row }, 201);
  };
  return { filed, handler };
}

const sharedCaller = (store: UpstreamHandler, writer: UpstreamHandler, extra: Record<string, UpstreamHandler> = {}) =>
  caller({
    "/rest/v1/word_assets": store,
    "/storage/v1/object/flashcard-audio": () => json({ Key: "flashcard-audio/x" }),
    [LYRIC_ROUTE]: writer,
    "models/lyria": lyria(new Uint8Array([1, 2, 3, 4]), "audio/mpeg"),
    ...extra,
  });

Deno.test("generate-word-jingle serves a shared jingle without writing or singing anything", async () => {
  const store = assetStore([aStoredJingle]);
  const { status, body, calls } = await call(
    { ...aWord, share: true },
    sharedCaller(store.handler, promptWriter({ lyrics: "x", prompt: "p" })),
  );

  assertEquals(status, 200);
  assertEquals(body.audioUrl, "https://cdn.test/shared-kitab-jingle.wav");
  assertEquals(body.lyrics, "كتاب كتاب يا حلو الكتاب");
  assertEquals(body.cached, true);
  assert(!calls.some((u) => u.includes(LYRIC_ROUTE)), "a hit must not write lyrics");
  assert(!calls.some((u) => u.includes("models/lyria")), "a hit must not sing");
  assert(!calls.some((u) => u.includes("increment_usage_counter")), "a hit is not charged");
});

Deno.test("generate-word-jingle files a new shared jingle for the next learner", async () => {
  const store = assetStore();
  const { status, body, calls } = await call(
    { ...aWord, share: true },
    sharedCaller(store.handler, promptWriter({ lyrics: "كتاب كتاب يا حلو الكتاب", prompt: "Khaliji pop" })),
  );

  assertEquals(status, 200);
  // Still the bytes, for the learner who asked; and the url they can store.
  assertEquals(decode(body.audioBase64), new Uint8Array([1, 2, 3, 4]));
  assertStringIncludes(String(body.audioUrl), "/flashcard-audio/word-assets/jingle/jingle-1/gulf/");
  assert(calls.some((u) => u.includes("increment_usage_counter")), "a miss is charged");

  assertEquals(store.filed.length, 1);
  const row = store.filed[0];
  assertEquals(row.concept_key, "كتاب|book");
  assertEquals(row.kind, "jingle");
  assertEquals(row.dialect, "Gulf");
  assertEquals(row.url, body.audioUrl);
  assertEquals(row.payload, { lyrics: "كتاب كتاب يا حلو الكتاب" });
});

Deno.test("generate-word-jingle never shares lyrics the leak detector flags as Fusha", async () => {
  const store = assetStore();
  const { status, body, calls } = await call(
    { ...aWord, share: true },
    sharedCaller(store.handler, promptWriter({ lyrics: "سوف أقرأ هذا الكتاب الآن", prompt: "Khaliji pop" })),
  );

  // The learner still gets their jingle, exactly as before the store.
  assertEquals(status, 200);
  assertEquals(decode(body.audioBase64), new Uint8Array([1, 2, 3, 4]));
  assertEquals(body.audioUrl, undefined);
  assertEquals(store.filed, []);
  assert(!calls.some((u) => u.includes("/storage/v1/object/")), "nothing uploaded to share");
});

Deno.test("generate-word-jingle does not share a clip sung from the safe fallback", async () => {
  // The fallback sings only the word, so the lyrics written for it are not
  // what is heard, and filing them would mislabel the clip for everyone.
  let lyriaCalls = 0;
  const store = assetStore();
  const { status, body } = await call(
    { ...aWord, share: true },
    sharedCaller(store.handler, promptWriter({ lyrics: "كتاب كتاب", prompt: "p" }), {
      "models/lyria": (request) =>
        lyriaCalls++ === 0
          ? json({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] })
          : lyria(new Uint8Array([9, 9]), "audio/mpeg")(request),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.audioUrl, undefined);
  assertEquals(store.filed, []);
});

Deno.test("generate-word-jingle regenerates afresh without the store when share is off", async () => {
  // A regeneration asks for a different jingle; and a client on an older
  // bundle, which sends no `share`, must never get a hit it cannot play.
  const store = assetStore([aStoredJingle]);
  const { status, body, calls } = await call(
    aWord,
    sharedCaller(store.handler, promptWriter({ lyrics: "كتاب كتاب", prompt: "p" })),
  );

  assertEquals(status, 200);
  assertEquals(decode(body.audioBase64), new Uint8Array([1, 2, 3, 4]));
  assertEquals(body.audioUrl, undefined);
  assert(!calls.some((u) => u.includes("word_assets")), "share off must not touch the store");
});

Deno.test("generate-word-jingle still hands back a shareable url while the store's table does not exist", async () => {
  const missing: UpstreamHandler = () =>
    json({ code: "PGRST205", message: "Could not find the table 'public.word_assets' in the schema cache" }, 404);
  const { status, body } = await call(
    { ...aWord, share: true },
    sharedCaller(missing, promptWriter({ lyrics: "كتاب كتاب", prompt: "p" })),
  );

  // Uploaded under a name of its own, so the caller stores this url as it
  // would have stored its own upload; it is simply not filed for anyone else.
  assertEquals(status, 200);
  assertStringIncludes(String(body.audioUrl), "/flashcard-audio/word-assets/jingle/");
});

Deno.test("generate-word-jingle turns an anonymous caller away before looking anything up", async () => {
  const store = assetStore([aStoredJingle]);
  const fn = await loadFunction("generate-word-jingle", {
    upstreams: sharedCaller(store.handler, promptWriter({ lyrics: "x", prompt: "p" })),
  });
  try {
    const response = await fn.handler(jsonRequest("generate-word-jingle", { ...aWord, share: true }, { jwt: null }));
    const body = await response.json();
    assertEquals(response.status, 401);
    assertEquals(body.error, "auth_required");
    assertEquals(fn.callsTo("word_assets"), []);
  } finally {
    fn.restore();
  }
});
