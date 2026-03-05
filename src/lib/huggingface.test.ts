import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ---- mock the openai module ---- */
const createMock = vi.fn();
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: createMock } },
    })),
  };
});

/* The module under test reads import.meta.env at call time, so we can set it
   before each test. */
beforeEach(() => {
  vi.stubEnv("VITE_HF_TOKEN", "hf_test_token");
  vi.useFakeTimers();
  createMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/* --- dynamic import so the mock is installed first --- */
async function loadModule() {
  return import("./huggingface");
}

describe("getDialectResponse", () => {
  it("returns content from a successful API call", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "مرحبا" } }],
    });

    const { getDialectResponse } = await loadModule();
    const result = await getDialectResponse("Say hello", "standard");
    expect(result).toBe("مرحبا");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "tiiuae/Falcon-H1-7B-Instruct:cheapest",
      }),
    );
  });

  it("uses the premium model when requested", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "أهلاً" } }],
    });

    const { getDialectResponse } = await loadModule();
    await getDialectResponse("Greet me", "premium");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "inceptionai/Jais-2-8B-Chat:cheapest",
      }),
    );
  });

  it("retries on a 503 error and eventually succeeds", async () => {
    const busyError = Object.assign(new Error("503 Service Unavailable"), {
      status: 503,
    });

    createMock
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce({
        choices: [{ message: { content: "نجحنا" } }],
      });

    const { getDialectResponse } = await loadModule();
    const promise = getDialectResponse("Try again", "standard");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe("نجحنا");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("returns a fallback message after exhausting retries", async () => {
    const busyError = Object.assign(new Error("503 Service Unavailable"), {
      status: 503,
    });

    createMock
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError);

    const { getDialectResponse } = await loadModule();
    const promise = getDialectResponse("Fail", "standard");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toContain("Sorry, the service is temporarily busy");
  });

  it("returns a fallback message for an empty response", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const { getDialectResponse } = await loadModule();
    const result = await getDialectResponse("Empty", "standard");
    expect(result).toContain("Sorry, the service is temporarily busy");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("throws when VITE_HF_TOKEN is missing", async () => {
    vi.stubEnv("VITE_HF_TOKEN", "");

    const { getDialectResponse } = await loadModule();
    await expect(getDialectResponse("test", "standard")).rejects.toThrow(
      "VITE_HF_TOKEN is not set",
    );
  });
});
