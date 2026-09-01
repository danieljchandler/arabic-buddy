import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ManagedRole =
  | "admin"
  | "bible_reader"
  | "content_reviewer"
  | "beta_tester"
  | "complimentary"
  | "transcriber";

/**
 * The roles the console hands out, in the order the picker shows them.
 *
 * `recorder` is deliberately absent: it pairs with a recording setup that
 * happens outside the app, and granting it here would not make that pairing
 * happen. Keep this list in step with `public.is_grantable_role` in the
 * database — the listing RPC filters on the SQL side and the picker is built
 * from this side, so a role in only one of them is either ungrantable or
 * invisible once granted.
 */
export const MANAGED_ROLES: ManagedRole[] = [
  "bible_reader",
  "content_reviewer",
  "beta_tester",
  "complimentary",
  "transcriber",
  "admin",
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
  // Everything, including this page. Granting it is how another person gets to
  // hand out roles, so the UI confirms before writing it.
  admin: "Admin (full access)",
};

/**
 * Roles that carry the console with them, and so need a confirmation step.
 *
 * The distinction is not "important" — a complimentary grant is worth real
 * money — but "can the holder grant more of it". An admin can mint admins and
 * revoke anyone else's access; a content reviewer cannot reach this page at
 * all. Only the first kind is worth interrupting someone over.
 */
export const ELEVATED_ROLES: ManagedRole[] = ["admin"];

export function isElevatedRole(role: ManagedRole): boolean {
  return ELEVATED_ROLES.includes(role);
}

export function isManagedRole(role: string): role is ManagedRole {
  return (MANAGED_ROLES as string[]).includes(role);
}


const CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES = [
  "/admin/videos",
  "/admin/set-phrases",
  // Chunk candidates promote into set_phrases drafts — same audience, same
  // editorial pass.
  "/admin/chunks",
  "/admin/dialect-rules",
  // The clip pipeline's two review surfaces: channel vetting and the clip
  // candidate queue. Same audience as video review.
  "/admin/channels",
  "/admin/clips",
  // The social-post review queue: judging harvested posts is the same
  // editorial call as vetting clips, so the same audience.
  "/admin/social-trends",
  // The old transcript review workspace, kept only so its redirect to the
  // video pages still renders for people holding stale links.
  "/admin/transcribe",
];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function canAccessContentReviewerAdminPath(pathname: string): boolean {
  if (pathname === "/admin") return true;

  return matchesPrefix(pathname, CONTENT_REVIEWER_ALLOWED_ADMIN_PREFIXES);
}

/**
 * The only part of /admin a transcriber may open.
 *
 * Transcript review lives on the Manage Videos pages now, so a transcriber — an
 * outside contributor, a native speaker hired to check Arabic, not a member of
 * staff — may open the video list and a video's edit page, where the pages
 * themselves hide the management controls and RLS plus the `transcript-review`
 * function refuse every write that is not a review. Deliberately NOT a bare
 * "/admin/videos" prefix: that would also admit "/admin/videos/new", and
 * creating videos is management, not review. Widening this list is how a
 * transcriber ends up next to the publish button or the role-grant page, so
 * treat any addition as a decision about trust rather than about convenience.
 */
export function canAccessTranscriberAdminPath(pathname: string): boolean {
  // The old workspace addresses only redirect to the video pages now, but the
  // redirect has to render to happen.
  if (matchesPrefix(pathname, ["/admin/transcribe"])) return true;

  if (pathname === "/admin/videos") return true;
  return /^\/admin\/videos\/[^/]+\/edit$/.test(pathname);
}

export function hasBibleAccessFromRoles(roles: Iterable<AppRole>): boolean {
  const roleSet = new Set(roles);

  if (roleSet.has("admin")) return true;

  return roleSet.has("bible_reader") && !roleSet.has("content_reviewer");
}
