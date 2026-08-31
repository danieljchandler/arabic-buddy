import { ROLE_LABELS, type ManagedRole } from "./rbac";

/**
 * What `admin_grant_role_by_email` did, and what to say about it.
 *
 * Granting a role has four ordinary outcomes, not two. The address may belong
 * to an account (grant it now), may belong to an account that already holds the
 * role (say so, write nothing), may belong to nobody yet (park an invitation
 * for signup), or may already have an invitation waiting. Only the last of the
 * five — an identifier that can never match anything — is an error.
 *
 * The RPC decides which one happened, because only it can see `auth.users`.
 * This module turns that answer into the message and the tone, so the page does
 * not carry a five-branch conditional and the wording is testable without a
 * browser.
 */
export type GrantStatus = "granted" | "already" | "pending" | "invited" | "not_found";

export interface GrantResult {
  status: GrantStatus;
  user_id: string | null;
  email: string | null;
}

export type GrantTone = "success" | "info" | "error";

export interface GrantMessage {
  tone: GrantTone;
  title: string;
  description?: string;
}

/** Does this identifier look like something a future signup could match? */
export function isEmailIdentifier(identifier: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier.trim().toLowerCase());
}

/** The same normalisation the RPC applies, so the UI can echo what was stored. */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function describeGrantResult(
  result: GrantResult,
  role: ManagedRole,
  identifier: string,
): GrantMessage {
  const label = ROLE_LABELS[role];
  const who = result.email ?? normalizeIdentifier(identifier);

  switch (result.status) {
    case "granted":
      return { tone: "success", title: `${label} granted`, description: who };
    case "already":
      return { tone: "info", title: "This role is already assigned to that user." };
    case "pending":
      return {
        tone: "success",
        title: `${label} invitation saved`,
        // Said plainly because the difference matters: nothing has happened to
        // anyone yet, and it never will if that address never signs up.
        description: `${who} has no account yet. The role is applied automatically when they sign up with this address.`,
      };
    case "invited":
      return {
        tone: "info",
        title: "That invitation is already waiting.",
        description: `${who} will get ${label} on signup.`,
      };
    case "not_found":
      return {
        tone: "error",
        title: "User not found",
        // A UUID is the only identifier that lands here: an email with no
        // account behind it becomes an invitation rather than an error.
        description: "Enter an email address, or a user UUID that exists.",
      };
  }
}

/**
 * Where a role actually lands someone, and what to say when handing them a link.
 *
 * Granting a role sends no email — nothing in the app notifies the recipient,
 * so the only way they learn about it is the admin telling them. That makes the
 * destination part of the grant: a transcriber who is never given
 * `/admin/videos` has a role and no way to use it.
 */
export interface RoleAccessLink {
  /** In-app path the role unlocks. */
  path: string;
  /** One line the admin can paste alongside the link. */
  blurb: string;
}

export const ROLE_ACCESS_LINKS: Record<ManagedRole, RoleAccessLink> = {
  admin: { path: "/admin", blurb: "Sign in with this email, then open the admin console." },
  content_reviewer: {
    path: "/admin/videos",
    blurb: "Sign in with this email, then open Manage Videos to review transcripts.",
  },
  transcriber: {
    path: "/admin/videos",
    blurb:
      "Sign in with this email, then open this link to review and correct video transcripts.",
  },
  beta_tester: { path: "/", blurb: "Sign in with this email to get beta access." },
  bible_reader: { path: "/bible", blurb: "Sign in with this email, then open the Bible reader." },
  complimentary: { path: "/", blurb: "Sign in with this email — full access is already applied." },
};

/** Absolute link to paste into a message. `origin` comes from the browser. */
export function roleAccessUrl(role: ManagedRole, origin: string): string {
  return `${origin.replace(/\/$/, "")}${ROLE_ACCESS_LINKS[role].path}`;
}

/** The whole message: link plus the sentence explaining what to do with it. */
export function roleInviteMessage(role: ManagedRole, email: string, origin: string): string {
  const { blurb } = ROLE_ACCESS_LINKS[role];
  return `You've been given ${ROLE_LABELS[role]} access (${email}). ${blurb}\n${roleAccessUrl(role, origin)}`;
}
