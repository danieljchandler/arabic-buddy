import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one door every speaker button in the app goes through.
 *
 * Two things here are load-bearing and neither is obvious from the call site.
 * The first is that requests are *serialised*: our TTS provider caps concurrent
 * synthesis, and a page that shows a speaker on every line of an article would
 * otherwise fire a dozen at once and take 429s for most of them. The queue is a
 * module-level mutex, which is precisely why this code is a module and not a
 * hook — a second copy of it would silently double our concurrency.
 *
 * The second is that a 200 is not proof of audio. `tts-speak` answers JSON when
 * it has an error to report, and answers 404 in the window before a deploy has
 * landed; both used to reach the caller as a blob that played silence. Audio is
 * what the content type says it is, and anything else falls back to the
 * per-provider function.
 */

const toastFn = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastFn(...args), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "learner-token" } },
      })),
    },
  },
}));

/**
 * jsdom's `Blob` and the one the fetch polyfill constructs come from different
 * realms, so `toBeInstanceOf(Blob)` is false for a perfectly good blob. Assert
 * on what the caller actually uses it for.
 */
const isAudioBlob = (value: unknown) =>
  Boolean(value) && (value as Blob).type === "audio/mpeg";

const audio = (body = "bytes") =>
  new Response(body, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
const envelope = (status = 200) =>
  new Response(JSON.stringify({ error: "no" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const called = () =>
  fetchMock.mock.calls.map(([url]) => String(url).split("/functions/v1/")[1]);

beforeEach(async () => {
  vi.resetModules();
  toastFn.mockClear();
  fetchMock = vi.fn(async () => audio());
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const load = async () => (await import("./speakArabic")).fetchSpeechBlob;

describe("fetchSpeechBlob", () => {
  it("asks tts-speak for a dialect, never for a voice", async () => {
    const fetchSpeechBlob = await load();
    const blob = await fetchSpeechBlob({ text: "مرحبا", dialect: "Yemeni" });

    expect(isAudioBlob(blob)).toBe(true);
    expect(called()).toEqual(["tts-speak"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ text: "مرحبا", dialect: "Yemeni" });
    // Which voice speaks Yemeni is server configuration; a client that named
    // one would be a frontend deploy standing between a learner and a fix.
    expect(body).not.toHaveProperty("voice");
  });

  it("sends the learner's token, so the daily cap knows whose it is", async () => {
    const fetchSpeechBlob = await load();
    await fetchSpeechBlob({ text: "مرحبا", dialect: "Gulf" });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer learner-token");
  });

  it("goes straight to azure-tts when the caller names a voice", async () => {
    const fetchSpeechBlob = await load();
    await fetchSpeechBlob({ text: "مرحبا", voice: "ar-SA-HamedNeural" });

    expect(called()).toEqual(["azure-tts"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).voice).toBe(
      "ar-SA-HamedNeural",
    );
  });

  it("falls back to azure-tts when tts-speak answers something that is not audio", async () => {
    // A JSON body on a 200 is an error envelope. It used to be handed back as a
    // blob, which plays as silence — a speaker button that looks like it worked.
    fetchMock.mockResolvedValueOnce(envelope(200));
    const fetchSpeechBlob = await load();

    const blob = await fetchSpeechBlob({ text: "مرحبا", dialect: "Gulf" });

    expect(called()).toEqual(["tts-speak", "azure-tts"]);
    expect(isAudioBlob(blob)).toBe(true);
  });

  it("returns null rather than silence when neither provider has audio", async () => {
    fetchMock.mockResolvedValue(envelope(500));
    const fetchSpeechBlob = await load();

    expect(await fetchSpeechBlob({ text: "مرحبا", dialect: "Gulf" })).toBeNull();
  });

  it("says what a signed-out visitor needs to do, once", async () => {
    fetchMock.mockResolvedValue(envelope(401));
    const fetchSpeechBlob = await load();

    await fetchSpeechBlob({ text: "واحد", dialect: "Gulf" });
    await fetchSpeechBlob({ text: "اثنين", dialect: "Gulf" });

    // Both calls 401; a learner tapping down a page should not get a toast per
    // line. The button used to fail silently, which was the other extreme.
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(String(toastFn.mock.calls[0][0])).toMatch(/sign in/i);
  });

  it("serialises routed requests, so a page of speakers is one call at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          release.push(() => {
            inFlight--;
            resolve(audio());
          });
        }),
    );
    const fetchSpeechBlob = await load();

    const all = Promise.all([
      fetchSpeechBlob({ text: "أ", dialect: "Gulf" }),
      fetchSpeechBlob({ text: "ب", dialect: "Gulf" }),
      fetchSpeechBlob({ text: "ت", dialect: "Gulf" }),
    ]);

    // Let each queued task reach its fetch, then let it finish.
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(release.length).toBe(i + 1));
      release[i]();
    }
    await all;

    expect(peak).toBe(1);
    expect(called()).toEqual(["tts-speak", "tts-speak", "tts-speak"]);
  });

  it("does not hold the queue when a caller aborts", async () => {
    const controller = new AbortController();
    const rejectAborted = () =>
      Promise.reject(new DOMException("Aborted", "AbortError"));
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      // Real fetch rejects an already-aborted signal rather than hanging, and
      // the caller can abort before the request is even issued.
      if (init.signal?.aborted) return rejectAborted();
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    const fetchSpeechBlob = await load();

    const aborted = fetchSpeechBlob({
      text: "مرحبا",
      dialect: "Gulf",
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toThrow();

    // The mutex has to survive it: a rejected task that left the chain pending
    // would deadlock every speaker button for the rest of the session.
    fetchMock.mockResolvedValue(audio());
    expect(isAudioBlob(await fetchSpeechBlob({ text: "بعدين", dialect: "Gulf" }))).toBe(true);
  });
});
