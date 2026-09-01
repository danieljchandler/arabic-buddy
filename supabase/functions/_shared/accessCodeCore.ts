/**
 * ID-number logins: the credential itself, and the rules about its shape.
 *
 * Some of the people this app depends on cannot be reached by an email
 * invitation. A native-speaker reviewer hired to correct transcripts may have
 * no address they check, may use a shared family one, or may simply never
 * complete a signup flow written in a language they do not read — and the role
 * grant is worthless until they do. So there is a second way in: an admin mints
 * an ID number and a password, sends both over whatever channel already works
 * (WhatsApp, in person, a phone call), and the reviewer signs in with them.
 *
 * Underneath it is still an ordinary Supabase account. The ID is not a
 * parallel identity system — it is deterministically mapped onto an address in
 * a domain that receives no mail, and `signInWithPassword` does the rest. That
 * matters: sessions, JWT claims, RLS, `user_roles` and every audit trail keep
 * working exactly as they do for an email account, and nothing downstream has
 * to learn about this at all.
 *
 * Pure and dependency-free so both halves can share it verbatim: the browser
 * needs `accessIdToEmail` to sign someone in, and the `access-credentials` edge
 * function needs the same mapping to create the account in the first place. A
 * second copy of that rule is a lockout waiting to happen.
 */

/**
 * The domain the synthetic addresses live in.
 *
 * A subdomain of the production domain rather than `example.com` or a made-up
 * TLD: it must be one nobody else can ever own, since anyone who controls it
 * could request a password reset for every ID login at once. It publishes no MX
 * record, so mail to it goes nowhere — which is the point. A reviewer holding
 * one of these accounts has no inbox and therefore no self-service recovery;
 * `reset_password` on the admin console is the whole recovery story.
 */
export const ACCESS_ID_DOMAIN = "ids.hakiya.app";

/** Digits in an ID number. Eight is dictatable over the phone and leaves room. */
export const ACCESS_ID_LENGTH = 8;

/**
 * Roles that may be handed out as an ID login.
 *
 * Narrow on purpose, and not the same list as `MANAGED_ROLES`. An ID login is a
 * password credential minted by someone other than its holder, sent over a chat
 * app, and unrecoverable without an admin — appropriate for an outside
 * contributor whose whole job is one page, and not for anything that carries
 * spending, billing or the console. `admin` is absent and must stay absent: an
 * admin who cannot receive email cannot be verified as themselves.
 *
 * Kept in step with `public.is_access_id_role` in the database, which is what
 * actually refuses the write.
 */
export const ACCESS_ID_ROLES = ["transcriber", "content_reviewer"] as const;

export type AccessIdRole = (typeof ACCESS_ID_ROLES)[number];

export function isAccessIdRole(role: string): role is AccessIdRole {
  return (ACCESS_ID_ROLES as readonly string[]).includes(role);
}

/**
 * Strip everything that is not a digit.
 *
 * People retype an ID from a chat message, and they bring the formatting with
 * them: "4031 8825", "4031-8825", a trailing space from a copy. All of those
 * are the same ID, and rejecting them teaches the holder that the credential is
 * broken rather than that they typed a space.
 */
export function normalizeAccessId(raw: string): string {
  return (raw ?? "").replace(/\D+/g, "");
}

export function isAccessId(value: string): boolean {
  return new RegExp(`^[0-9]{${ACCESS_ID_LENGTH}}$`).test(value);
}

/** Grouped in fours for reading aloud and for copying off a screen. */
export function formatAccessId(id: string): string {
  const digits = normalizeAccessId(id);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** The address the ID signs in as. The one rule both sides must agree on. */
export function accessIdToEmail(id: string): string {
  const digits = normalizeAccessId(id);
  if (!isAccessId(digits)) {
    throw new Error(`Not an ID number: ${JSON.stringify(id)}`);
  }
  return `${digits}@${ACCESS_ID_DOMAIN}`;
}

/** The ID behind a synthetic address, or null if it is an ordinary account. */
export function emailToAccessId(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (domain !== ACCESS_ID_DOMAIN) return null;
  return isAccessId(local) ? local : null;
}

export function isAccessIdEmail(email: string | null | undefined): boolean {
  return emailToAccessId(email) !== null;
}

/**
 * Password alphabet: no O/0, I/1, L or U.
 *
 * These credentials are read off a phone screen and typed into another one, or
 * dictated. Ambiguous glyphs turn a working password into a support message,
 * and the person on the other end has no way to reset it themselves.
 */
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** Three groups of four: `K7QM-4RTX-9BFD`. Long enough, and still dictatable. */
const PASSWORD_GROUPS = 3;
const PASSWORD_GROUP_SIZE = 4;

/** A source of integers in `[0, max)`. Injected so generation is testable. */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Uniform integers from the platform CSPRNG, by rejection sampling.
 *
 * `crypto.getRandomValues` is present in every runtime this module is used
 * from — Deno, and every browser the app supports. `Math.random` is not an
 * acceptable fallback for a credential, so there is none: a runtime without
 * `crypto` throws rather than quietly minting guessable passwords.
 *
 * The rejection loop is what keeps it uniform. `value % max` biases toward the
 * low end whenever `max` does not divide 2^32 — small here, but this is the one
 * place in the app where "close enough to random" is not a thing worth saying.
 */
export const secureRandomInt: RandomInt = (maxExclusive: number): number => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("A cryptographic random source is required to mint credentials");
  }

  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % maxExclusive;
  }
};

/**
 * A new ID number. Never starts with a zero, so it survives every round trip
 * through a spreadsheet, a phone keypad or anything else that reads it as a
 * number and drops the leading digit.
 */
export function generateAccessId(randomInt: RandomInt = secureRandomInt): string {
  let id = String(1 + randomInt(9));
  while (id.length < ACCESS_ID_LENGTH) id += String(randomInt(10));
  return id;
}

export function generatePassword(randomInt: RandomInt = secureRandomInt): string {
  const groups: string[] = [];
  for (let g = 0; g < PASSWORD_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < PASSWORD_GROUP_SIZE; i++) {
      group += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export interface CredentialMessageInput {
  accessId: string;
  password: string;
  /** Where to sign in — the deployment's origin, no trailing slash needed. */
  origin: string;
  /** What the credential is for, in the recipient's terms. */
  roleLabel?: string;
}

/** The sign-in page an ID number is used on. */
export const ACCESS_ID_LOGIN_PATH = "/login/id";

export function accessIdLoginUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${ACCESS_ID_LOGIN_PATH}`;
}

/**
 * The whole message an admin sends, ready to paste.
 *
 * Written as one block because that is how it is actually delivered — pasted
 * into a chat — and because a credential split across three messages is a
 * credential half of which never arrives.
 */
export function credentialMessage({
  accessId,
  password,
  origin,
  roleLabel,
}: CredentialMessageInput): string {
  const what = roleLabel ? `your ${roleLabel} access` : "your access";
  return [
    `Here are ${what} details for Hakiya.`,
    ``,
    `Open: ${accessIdLoginUrl(origin)}`,
    `ID number: ${formatAccessId(accessId)}`,
    `Password: ${password}`,
    ``,
    `Type the ID number and the password on that page — no email needed.`,
  ].join("\n");
}
