import { describe, expect, it } from "vitest";
import {
  ALWAYS_ALLOWED,
  normalizeArabic,
} from "../../supabase/functions/_shared/msaLeakDetector";

const MIGRATION =
  "supabase/migrations/20260804120000_yemeni_corpus_rule_drafts.sql";

async function loadRules() {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const sql = await readFile(resolve(MIGRATION), "utf8");
  const blobs = [...sql.matchAll(/'(\{"good"[\s\S]*?\})',/g)].map((m) =>
    JSON.parse(m[1]),
  );
  return { sql, blobs };
}

// These rows seed dialect_rules from the Lisan corpus. Two failure modes are
// invisible at review time and expensive later, so they are pinned here.
describe("Yemeni corpus rule drafts", () => {
  it("parses, and every rule carries both example arrays", async () => {
    const { blobs } = await loadRules();
    expect(blobs.length).toBeGreaterThan(0);
    for (const b of blobs) {
      expect(Array.isArray(b.good)).toBe(true);
      expect(Array.isArray(b.bad)).toBe(true);
    }
  });

  // harvestForbiddenTokens drops any bad example that sits in ALWAYS_ALLOWED,
  // so a rule arguing against a whitelisted form does nothing at all — it just
  // reads as policy that is silently never applied. هذا/هذه are the live case:
  // the corpus put them on the whitelist, so no rule may argue against them.
  it("never argues against a form the whitelist permits", async () => {
    const { blobs } = await loadRules();
    const allowed = ALWAYS_ALLOWED.Yemeni;
    const voided: string[] = [];
    for (const b of blobs) {
      for (const bad of b.bad as unknown[]) {
        if (typeof bad !== "string") continue;
        if (allowed.has(normalizeArabic(bad))) voided.push(bad);
      }
    }
    expect(voided, "bad examples that ALWAYS_ALLOWED.Yemeni would drop").toEqual(
      [],
    );
  });

  // Nothing reaches a generator until an admin approves it: fetchRules in
  // dialectHelpers selects status='approved' only.
  it("seeds only drafts, attributed to the corpus", async () => {
    const { sql } = await loadRules();
    const statuses = [...sql.matchAll(/'(draft|approved|retired)',\s*'(\w+)'/g)];
    expect(statuses.length).toBeGreaterThan(0);
    for (const [, status, source] of statuses) {
      expect(status).toBe("draft");
      expect(source).toBe("corpus_mined");
    }
  });
});
