import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ManagedRole =
  | "bible_reader"
  | "content_reviewer"
  | "beta_tester"
  | "complimentary"
  | "transcriber";

export const MANAGED_ROLES: ManagedRole[] = [
  "bible_reader",
  "content_reviewer",
  "beta_tester",
  "complimentary",
  "transcriber",
];

export const ROLE_LABELS: Record<ManagedRole, string> = {
  bible_reader: "Bible reader",
  content_reviewer: "Content reviewer",
  beta_tester: "Beta tester",
  // Full All-In access with no payment — investors, partners, press.
  complimentary: "Complimentary (All-In, free)",
  // A native speaker who checks the AI's Arabic and English. Not staff: they
  // reach the review workspace and nothing else in /admin.
  transcriber: "Transcriber (native reviewer)",
};


const CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES = [
  "/admin/videos",
  "/admin/set-phrases",
  "/admin/dialect-rules",
  // The clip pipeline's two review surfaces: channel vetting and the clip
  // candidate queue. Same audience as video review.
  "/admin/channels",
  "/admin/clips",
  // The transcript review workspace. A content reviewer is already trusted with
  // the video form, which is a superset of it.
  "/admin/transcribe",
];

/**
 * The only part of /admin a transcriber may open.
 *
 * Deliberately one prefix. A transcriber is an outside contributor — a native
 * speaker hired to check Arabic — not a member of staff, and the review
 * workspace is built so that everything they legitimately need (the lines, the
 * audio, the cultural notes, the grammar points, the vocabulary) is reachable
 * from inside it. Widening this list is how a transcriber ends up next to the
 * publish button or the role-grant page, so treat any addition as a decision
 * about trust rather than about convenience.
 */
const TRANSCRIBER_ALLOWED_ADMIN_PREFIXES = ["/admin/transcribe"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function canAccessContentReviewerAdminPath(pathname: string): boolean {
  if (pathname === "/admin") return true;

  return matchesPrefix(pathname, CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES);
}

export function canAccessTranscriberAdminPath(pathname: string): boolean {
  // The dashboard renders a role-appropriate tile set, so it is safe to land on
  // and is the only way a transcriber finds the workspace in the first place.
  if (pathname === "/admin") return true;

  return matchesPrefix(pathname, TRANSCRIBER_ALLOWED_ADMIN_PREFIXES);
}

export function hasBibleAccessFromRoles(roles: Iterable<AppRole>): boolean {
  const roleSet = new Set(roles);

  if (roleSet.has("admin")) return true;

  return roleSet.has("bible_reader") && !roleSet.has("content_reviewer");
}
