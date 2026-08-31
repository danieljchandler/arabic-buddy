import { describe, expect, it } from "vitest";
import {
  canAccessContentReviewerAdminPath,
  canAccessTranscriberAdminPath,
  hasBibleAccessFromRoles,
  isElevatedRole,
  isManagedRole,
  MANAGED_ROLES,
  ROLE_LABELS,
  type ManagedRole,
} from "./rbac";

describe("rbac helpers", () => {
  it("allows content reviewers on approved admin content paths only", () => {
    expect(canAccessContentReviewerAdminPath("/admin")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/videos/123/edit")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/set-phrases")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/dialect-rules")).toBe(true);
    expect(canAccessContentReviewerAdminPath("/admin/bible-access")).toBe(false);
    expect(canAccessContentReviewerAdminPath("/admin/curriculum-builder")).toBe(false);
  });

  it("limits transcribers to Manage Videos and transcript edit pages", () => {
    expect(canAccessTranscriberAdminPath("/admin")).toBe(false);
    expect(canAccessTranscriberAdminPath("/admin/videos")).toBe(true);
    expect(canAccessTranscriberAdminPath("/admin/videos/123/edit")).toBe(true);
    expect(canAccessTranscriberAdminPath("/admin/videos/new")).toBe(false);
    expect(canAccessTranscriberAdminPath("/admin/bible-access")).toBe(false);
  });

  it("denies bible access to content reviewers unless admin", () => {
    expect(hasBibleAccessFromRoles(["bible_reader"])).toBe(true);
    expect(hasBibleAccessFromRoles(["content_reviewer"])).toBe(false);
    expect(hasBibleAccessFromRoles(["content_reviewer", "bible_reader"])).toBe(false);
    expect(hasBibleAccessFromRoles(["admin", "content_reviewer"])).toBe(true);
  });
});

describe("managed roles", () => {
  it("offers admin, transcriber and beta tester from the console", () => {
    // The three the owner asked to be able to hand out without a psql session.
    expect(MANAGED_ROLES).toContain("admin");
    expect(MANAGED_ROLES).toContain("transcriber");
    expect(MANAGED_ROLES).toContain("beta_tester");
  });

  it("still leaves recorder out", () => {
    // Not an oversight: recorder pairs with a recording setup arranged outside
    // the app, so granting it here would produce a role with nothing behind it.
    expect(MANAGED_ROLES).not.toContain("recorder" as ManagedRole);
  });

  it("labels every role it offers", () => {
    // An unlabelled role renders as a blank option, which is indistinguishable
    // from the picker being broken.
    for (const role of MANAGED_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("treats only admin as needing confirmation", () => {
    // The test is "can the holder grant more of it", not "is it valuable" —
    // complimentary is worth real money and still does not gate this page.
    expect(isElevatedRole("admin")).toBe(true);
    expect(isElevatedRole("complimentary")).toBe(false);
    expect(isElevatedRole("content_reviewer")).toBe(false);
  });

  it("recognises its own role names and nothing else", () => {
    expect(isManagedRole("admin")).toBe(true);
    expect(isManagedRole("recorder")).toBe(false);
    expect(isManagedRole("superuser")).toBe(false);
  });
});
