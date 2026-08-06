import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { alignShaheenLines } from "../../supabase/functions/_shared/shaheenAlign";

describe("alignShaheenLines", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the split lines when the count already matches", () => {
    expect(alignShaheenLines("one\ntwo\nthree", 3)).toEqual(["one", "two", "three"]);
  });

  it("trims surrounding whitespace on each line", () => {
    expect(alignShaheenLines("  one  \n\ttwo\t", 2)).toEqual(["one", "two"]);
  });

  it("recovers from a trailing newline", () => {
    expect(alignShaheenLines("one\ntwo\n", 2)).toEqual(["one", "two"]);
  });

  it("recovers from blank lines inserted between outputs", () => {
    expect(alignShaheenLines("one\n\ntwo\n\nthree", 3)).toEqual(["one", "two", "three"]);
  });

  it("returns null when a line was genuinely dropped", () => {
    expect(alignShaheenLines("one\ntwo", 3)).toBeNull();
  });

  it("returns null when the response split into too many non-empty lines", () => {
    expect(alignShaheenLines("one\ntwo\nthree\nfour", 3)).toBeNull();
  });

  it("returns null for a non-positive expected count", () => {
    expect(alignShaheenLines("anything", 0)).toBeNull();
  });

  it("handles a single line with no newline at all", () => {
    expect(alignShaheenLines("just one", 1)).toEqual(["just one"]);
  });

  it("warns once when it cannot align", () => {
    alignShaheenLines("one\ntwo", 5);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
