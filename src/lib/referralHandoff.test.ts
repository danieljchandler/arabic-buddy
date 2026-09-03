import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureReferralFromUrl,
  consumeReferralCode,
  normalizeReferralCode,
  peekReferralCode,
  REFERRAL_STORAGE_KEY,
  referralCodeFromSearch,
  stashReferralCode,
  stripReferralParam,
} from "./referralHandoff";

/**
 * The share link is `https://hakiya.app/?ref=<CODE>`; this module is what
 * turns that into a prefilled redeem box on the far side of sign-up. Three
 * things carry it: the code is normalised the way the edge function does it,
 * the stash is read-once via `consume`, and a blocked localStorage degrades to
 * "type it yourself" rather than a crash on the front door.
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("normalising a code", () => {
  it("trims and uppercases, matching the edge function's redeem path", () => {
    expect(normalizeReferralCode("  gvqx7rpm ")).toBe("GVQX7RPM");
  });

  it("rejects anything that is not a code the generator could have minted", () => {
    // Wrong length, the ambiguous 0/O/1/I the alphabet leaves out, and junk.
    expect(normalizeReferralCode("ABC")).toBeNull();
    expect(normalizeReferralCode("GVQX7RP0")).toBeNull();
    expect(normalizeReferralCode("<script>")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe("reading the search string", () => {
  it("finds ?ref= among other params", () => {
    expect(referralCodeFromSearch("?utm=x&ref=gvqx7rpm&y=1")).toBe("GVQX7RPM");
  });

  it("returns null when there is no ref, or an unusable one", () => {
    expect(referralCodeFromSearch("")).toBeNull();
    expect(referralCodeFromSearch("?text=hello")).toBeNull();
    expect(referralCodeFromSearch("?ref=nope")).toBeNull();
  });

  it("strips only the ref param", () => {
    expect(stripReferralParam("?ref=GVQX7RPM")).toBe("");
    expect(stripReferralParam("?a=1&ref=GVQX7RPM&b=2")).toBe("?a=1&b=2");
    expect(stripReferralParam("")).toBe("");
  });
});

describe("the stash", () => {
  it("stashes under a namespaced key and peeks without consuming", () => {
    stashReferralCode("gvqx7rpm");
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe("GVQX7RPM");
    expect(peekReferralCode()).toBe("GVQX7RPM");
    expect(peekReferralCode()).toBe("GVQX7RPM");
  });

  it("consume returns the code once and then nothing", () => {
    stashReferralCode("GVQX7RPM");
    expect(consumeReferralCode()).toBe("GVQX7RPM");
    expect(consumeReferralCode()).toBeNull();
    expect(peekReferralCode()).toBeNull();
  });

  it("refuses to stash an invalid code", () => {
    stashReferralCode("not a code");
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("ignores a stored value that has been tampered into something invalid", () => {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, "garbage");
    expect(peekReferralCode()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => stashReferralCode("GVQX7RPM")).not.toThrow();
    expect(peekReferralCode()).toBeNull();
    expect(consumeReferralCode()).toBeNull();
  });
});

describe("capturing from the URL on load", () => {
  const fakeWindow = (search: string, pathname = "/", hash = "") => {
    const replaceState = vi.fn();
    return {
      win: {
        location: { search, pathname, hash } as Location,
        history: { state: { idx: 3 }, replaceState } as unknown as History,
      },
      replaceState,
    };
  };

  it("stashes the code and drops the param without a reload", () => {
    const { win, replaceState } = fakeWindow("?ref=gvqx7rpm&utm=share", "/", "#top");

    expect(captureReferralFromUrl(win)).toBe("GVQX7RPM");

    expect(peekReferralCode()).toBe("GVQX7RPM");
    // The rest of the query string and the hash survive; the history entry is
    // replaced rather than pushed, so Back still leaves the app.
    expect(replaceState).toHaveBeenCalledWith({ idx: 3 }, "", "/?utm=share#top");
  });

  it("leaves the URL alone when there is nothing to capture", () => {
    const { win, replaceState } = fakeWindow("?text=hello", "/share");

    expect(captureReferralFromUrl(win)).toBeNull();

    expect(replaceState).not.toHaveBeenCalled();
    expect(peekReferralCode()).toBeNull();
  });

  it("is a no-op with no window at all", () => {
    expect(captureReferralFromUrl(undefined)).toBeNull();
  });

  it("swallows a history that refuses to be rewritten", () => {
    const { win, replaceState } = fakeWindow("?ref=GVQX7RPM");
    replaceState.mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => captureReferralFromUrl(win)).not.toThrow();
    // The stash happened before the URL rewrite failed, so the code is kept.
    expect(peekReferralCode()).toBe("GVQX7RPM");
  });
});
