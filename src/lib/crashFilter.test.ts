import { describe, expect, it } from "vitest";
import { describeCrash, isBenignRejection } from "./crashFilter";

/**
 * The global crash handler's filter. A cancellation the browser reports as a
 * rejected promise is not a crash; a real error still is.
 */
describe("isBenignRejection", () => {
  it("ignores a skipped or aborted view transition", () => {
    expect(
      isBenignRejection(
        new DOMException("Transition was aborted because of invalid state. Document hidden", "InvalidStateError"),
      ),
    ).toBe(true);
    expect(isBenignRejection(new DOMException("Transition was skipped", "AbortError"))).toBe(true);
    // Some browsers reject with a plain Error carrying only the message.
    expect(isBenignRejection(new Error("Transition was aborted"))).toBe(true);
  });

  it("ignores an AbortController cancelled on unmount", () => {
    expect(isBenignRejection(new DOMException("signal is aborted without reason", "AbortError"))).toBe(true);
    expect(isBenignRejection(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });

  it("keeps a real error", () => {
    expect(isBenignRejection(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isBenignRejection(new Error("Failed to fetch"))).toBe(false);
    expect(isBenignRejection("Unknown error")).toBe(false);
    expect(isBenignRejection(null)).toBe(false);
    expect(isBenignRejection(undefined)).toBe(false);
  });
});

describe("describeCrash", () => {
  it("keeps the message an Error would lose to JSON.stringify", () => {
    expect(describeCrash(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
    expect(JSON.parse(JSON.stringify(describeCrash(new Error("kept"))))).toEqual({ name: "Error", message: "kept" });
  });

  it("copes with strings and bare objects", () => {
    expect(describeCrash("plain")).toEqual({ name: "Error", message: "plain" });
    expect(describeCrash({ message: "obj" })).toEqual({ name: "Error", message: "obj" });
    expect(describeCrash(undefined)).toEqual({ name: "Error", message: "" });
  });
});
