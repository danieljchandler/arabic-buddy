import { describe, expect, it } from "vitest";
import {
  describeGrantResult,
  isEmailIdentifier,
  normalizeIdentifier,
  type GrantResult,
} from "./roleGrants";

const result = (over: Partial<GrantResult>): GrantResult => ({
  status: "granted",
  user_id: null,
  email: null,
  ...over,
});

describe("isEmailIdentifier", () => {
  it("accepts an ordinary address", () => {
    expect(isEmailIdentifier("layla@example.com")).toBe(true);
    expect(isEmailIdentifier("  Layla@Example.COM  ")).toBe(true);
    expect(isEmailIdentifier("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects anything a future signup could not match", () => {
    // The consequential one: a mistyped UUID must stay an error rather than
    // becoming an invitation nobody will ever claim.
    expect(isEmailIdentifier("00000000-0000-4000-8000-0000000000c1")).toBe(false);
    expect(isEmailIdentifier("layla")).toBe(false);
    expect(isEmailIdentifier("layla@example")).toBe(false);
    expect(isEmailIdentifier("layla @example.com")).toBe(false);
    expect(isEmailIdentifier("")).toBe(false);
  });
});

describe("normalizeIdentifier", () => {
  it("matches what the RPC stores", () => {
    // The page echoes the normalised form back in the toast, so a mismatch
    // here would show an address different from the one that was saved.
    expect(normalizeIdentifier("  Layla@Example.COM ")).toBe("layla@example.com");
  });
});

describe("describeGrantResult", () => {
  it("celebrates a real grant and names the account", () => {
    const message = describeGrantResult(
      result({ status: "granted", user_id: "u1", email: "layla@example.com" }),
      "transcriber",
      "layla@example.com",
    );

    expect(message.tone).toBe("success");
    expect(message.title).toBe("Transcriber (native reviewer) granted");
    expect(message.description).toBe("layla@example.com");
  });

  it("does not celebrate a no-op", () => {
    const message = describeGrantResult(
      result({ status: "already", user_id: "u1", email: "layla@example.com" }),
      "beta_tester",
      "layla@example.com",
    );

    // Nothing was written, so a green "granted" would tell an admin they had
    // just done something they did not do.
    expect(message.tone).toBe("info");
    expect(message.title).toBe("This role is already assigned to that user.");
  });

  it("says plainly that a pending grant has not happened yet", () => {
    const message = describeGrantResult(
      result({ status: "pending", email: "newhire@example.com" }),
      "admin",
      "newhire@example.com",
    );

    expect(message.tone).toBe("success");
    expect(message.title).toBe("Admin (full access) invitation saved");
    // The distinction the whole feature turns on: an invitation is a promise
    // about a future signup, not access somebody has right now.
    expect(message.description).toContain("no account yet");
    expect(message.description).toContain("sign up");
  });

  it("distinguishes a duplicate invitation from a new one", () => {
    const message = describeGrantResult(
      result({ status: "invited", email: "newhire@example.com" }),
      "content_reviewer",
      "newhire@example.com",
    );

    expect(message.tone).toBe("info");
    expect(message.description).toContain("Content reviewer");
  });

  it("still errors on an identifier nothing could ever match", () => {
    const message = describeGrantResult(
      result({ status: "not_found" }),
      "bible_reader",
      "00000000-0000-4000-8000-0000000000c1",
    );

    expect(message.tone).toBe("error");
    expect(message.title).toBe("User not found");
  });

  it("falls back to the typed identifier when the RPC returned no email", () => {
    const message = describeGrantResult(
      result({ status: "granted", user_id: "u1", email: null }),
      "bible_reader",
      "  Layla@Example.com ",
    );

    expect(message.description).toBe("layla@example.com");
  });
});
