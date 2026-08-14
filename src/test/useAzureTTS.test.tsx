import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAzureTTS } from "@/hooks/useAzureTTS";

/**
 * The hook every surface plays audio through.
 *
 * It used to carry its own dialect→voice table, and so did the vocabulary audio
 * helper, the conversation simulator, the listening quiz and two edge functions.
 * They disagreed: Yemeni was `ar-YE-MaryamNeural` here and `ar-YE-SalehNeural`
 * in the simulator — the same learner, the same dialect, a different speaker's
 * gender depending on which screen they were on.
 *
 * So the assertions worth having are about what the hook *stops* deciding. It
 * names a dialect and the server picks the voice, which is also what lets a
 * cloned Yemeni voice be switched on with a secret rather than a deploy.
 *
 * Mocked at the module boundary rather than run against the in-memory backend,
 * because the request body is the thing under test and the harness installs its
 * own `fetch` over any stub.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
let respond: () => Response;

const audio = (type = "audio/wav") =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": type } });

beforeEach(() => {
  calls = [];
  respond = () => audio();

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return respond();
  }));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:tts"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const called = (fn: string) => calls.filter((c) => c.url.includes(`/functions/v1/${fn}`));

describe("useAzureTTS", () => {
  it("asks tts-speak for a dialect, not a voice", async () => {
    renderHook(() => useAzureTTS({ text: "كتاب", dialect: "Yemeni" }));

    await waitFor(() => expect(called("tts-speak")).toHaveLength(1));
    expect(called("tts-speak")[0].body).toEqual({ text: "كتاب", dialect: "Yemeni" });
  });

  it("never names an Azure voice for any dialect", async () => {
    // The regression that matters: an `ar-YE-*` voice reaching a request body
    // means a call site has started deciding for itself again.
    for (const dialect of ["Gulf", "Egyptian", "Yemeni", "MSA"]) {
      calls = [];
      renderHook(() => useAzureTTS({ text: "كتاب", dialect }));
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(JSON.stringify(calls)).not.toMatch(/ar-[A-Z]{2}-\w+Neural/);
    }
  });

  it("still honours an explicit voice, straight to azure-tts", async () => {
    // The one escape hatch, for a caller that needs a specific voice rather
    // than "whatever this dialect sounds like".
    renderHook(() => useAzureTTS({ text: "ق", voice: "ar-SA-HamedNeural" }));

    await waitFor(() => expect(called("azure-tts")).toHaveLength(1));
    expect(called("azure-tts")[0].body).toEqual({ text: "ق", voice: "ar-SA-HamedNeural" });
    expect(called("tts-speak")).toHaveLength(0);
  });

  it("falls back to azure-tts when the router is unreachable", async () => {
    // Covers the window between shipping the client and deploying the function,
    // where tts-speak 404s and the learner would otherwise get silence.
    respond = () => new Response("not found", { status: 404 });

    renderHook(() => useAzureTTS({ text: "كتاب", dialect: "Gulf" }));

    await waitFor(() => expect(called("azure-tts")).toHaveLength(1));
    expect(called("azure-tts")[0].body).toEqual({ text: "كتاب" });
  });

  it("treats a JSON body on a 200 as a failure, not as audio", async () => {
    // An error envelope handed to <audio> is an unplayable source, so the
    // content type is the check rather than the status.
    respond = () =>
      new Response(JSON.stringify({ error: "nope" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    renderHook(() => useAzureTTS({ text: "كتاب", dialect: "Gulf" }));

    await waitFor(() => expect(called("azure-tts")).toHaveLength(1));
  });

  it("asks for nothing when skipped or empty", async () => {
    renderHook(() => useAzureTTS({ text: "كتاب", dialect: "Gulf", skip: true }));
    renderHook(() => useAzureTTS({ text: "", dialect: "Gulf" }));

    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
  });
});
