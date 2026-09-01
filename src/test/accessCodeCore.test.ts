import { describe, expect, it } from "vitest";
import {
  ACCESS_ID_DOMAIN,
  ACCESS_ID_LENGTH,
  ACCESS_ID_ROLES,
  accessIdLoginUrl,
  accessIdToEmail,
  credentialMessage,
  emailToAccessId,
  formatAccessId,
  generateAccessId,
  generatePassword,
  isAccessId,
  isAccessIdEmail,
  isAccessIdRole,
  normalizeAccessId,
  secureRandomInt,
  type RandomInt,
} from "../../supabase/functions/_shared/accessCodeCore";

/** A deterministic stand-in for the CSPRNG: cycles a fixed list of draws. */
function scriptedRandom(draws: number[]): RandomInt {
  let i = 0;
  return (max) => draws[i++ % draws.length] % max;
}

describe("normalizing what a person types", () => {
  it.each([
    ["4031 8825", "40318825"],
    ["4031-8825", "40318825"],
    ["  40318825  ", "40318825"],
    ["ID 40318825", "40318825"],
  ])("reads %s as %s", (typed, expected) => {
    // The whole point: an ID arrives by chat and comes back with the sender's
    // formatting attached. None of these is a wrong credential.
    expect(normalizeAccessId(typed)).toBe(expected);
  });

  it("survives an empty or absent value without throwing", () => {
    expect(normalizeAccessId("")).toBe("");
    expect(normalizeAccessId(undefined as unknown as string)).toBe("");
  });
});

describe("ID shape", () => {
  it("accepts exactly eight digits and nothing else", () => {
    expect(isAccessId("40318825")).toBe(true);
    expect(isAccessId("4031882")).toBe(false);
    expect(isAccessId("403188250")).toBe(false);
    expect(isAccessId("4031882a")).toBe(false);
  });

  it("groups in fours for reading aloud", () => {
    expect(formatAccessId("40318825")).toBe("4031 8825");
  });
});

describe("the ID to address mapping", () => {
  it("is the same rule in both directions", () => {
    const email = accessIdToEmail("40318825");
    expect(email).toBe(`40318825@${ACCESS_ID_DOMAIN}`);
    expect(emailToAccessId(email)).toBe("40318825");
  });

  it("maps a formatted ID onto the same address as a bare one", () => {
    // A sign-in that failed only because the reviewer kept the space would be
    // indistinguishable, to them, from a wrong password.
    expect(accessIdToEmail("4031 8825")).toBe(accessIdToEmail("40318825"));
  });

  it("refuses to invent an address for something that is not an ID", () => {
    expect(() => accessIdToEmail("40318")).toThrow();
    expect(() => accessIdToEmail("")).toThrow();
  });

  it("does not claim an ordinary account as an ID login", () => {
    expect(emailToAccessId("someone@gmail.com")).toBe(null);
    expect(isAccessIdEmail("someone@gmail.com")).toBe(false);
    expect(isAccessIdEmail(null)).toBe(false);
    // Right domain, wrong local part — a hand-made account in the ID domain is
    // still not an ID login, and showing it as one would misreport who it is.
    expect(emailToAccessId(`admin@${ACCESS_ID_DOMAIN}`)).toBe(null);
  });

  it("reads a stored address case-insensitively", () => {
    expect(emailToAccessId(`40318825@${ACCESS_ID_DOMAIN.toUpperCase()}`)).toBe("40318825");
  });
});

describe("minting a credential", () => {
  it("generates the declared number of digits", () => {
    const id = generateAccessId(scriptedRandom([3, 7, 1, 9, 4, 0, 2, 8]));
    expect(id).toHaveLength(ACCESS_ID_LENGTH);
    expect(isAccessId(id)).toBe(true);
  });

  it("never starts with a zero", () => {
    // A leading zero survives nothing: a spreadsheet, a phone keypad and every
    // "helpful" numeric input drop it, and the ID then matches no account.
    const alwaysZero = generateAccessId(() => 0);
    expect(alwaysZero.startsWith("0")).toBe(false);
    expect(isAccessId(alwaysZero)).toBe(true);
  });

  it("produces a dictatable password with no ambiguous glyphs", () => {
    const password = generatePassword(scriptedRandom([0, 5, 11, 23, 2, 17, 8, 29, 13, 4, 19, 6]));
    expect(password).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // O/0, I/1, L and U are the pairs that turn a working password into a
    // support message the holder cannot resolve on their own.
    expect(password).not.toMatch(/[OIL10U]/);
  });

  it("draws from a real random source by default", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateAccessId()));
    expect(ids.size).toBe(50);
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });

  it("keeps the integer draw inside the requested range", () => {
    for (let i = 0; i < 200; i++) {
      const value = secureRandomInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it("refuses a nonsensical range rather than returning NaN", () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(-3)).toThrow();
    expect(() => secureRandomInt(2.5)).toThrow();
  });
});

describe("which roles may be an ID login", () => {
  it("covers the outside contributors and not the console", () => {
    expect(isAccessIdRole("transcriber")).toBe(true);
    expect(isAccessIdRole("content_reviewer")).toBe(true);
    // An admin who cannot receive email cannot be verified as themselves, and
    // this credential is minted by someone else and sent over a chat app.
    expect(isAccessIdRole("admin")).toBe(false);
    expect(isAccessIdRole("complimentary")).toBe(false);
    expect(ACCESS_ID_ROLES).not.toContain("admin");
  });
});

describe("the message an admin sends", () => {
  const message = credentialMessage({
    accessId: "40318825",
    password: "K7QM-4RTX-9BFD",
    origin: "https://hakiya.app/",
    roleLabel: "transcript reviewer",
  });

  it("carries the link, the ID and the password in one block", () => {
    expect(message).toContain("https://hakiya.app/login/id");
    expect(message).toContain("4031 8825");
    expect(message).toContain("K7QM-4RTX-9BFD");
    expect(message).toContain("transcript reviewer");
  });

  it("says no email is needed, because that is the reason it exists", () => {
    expect(message).toMatch(/no email/i);
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(accessIdLoginUrl("https://hakiya.app/")).toBe("https://hakiya.app/login/id");
    expect(accessIdLoginUrl("https://hakiya.app")).toBe("https://hakiya.app/login/id");
  });

  it("reads sensibly without a role label", () => {
    const plain = credentialMessage({
      accessId: "40318825",
      password: "K7QM-4RTX-9BFD",
      origin: "https://hakiya.app",
    });
    expect(plain).toContain("your access details");
  });
});
