import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every table the app knows about must be created by a migration.
 *
 * `src/integrations/supabase/types.ts` is generated from production, so a
 * table that appears there but in no `CREATE TABLE` under
 * `supabase/migrations/` was made from the dashboard and would not survive a
 * rebuild from this repo. Five such tables went unnoticed until the 2026-09-04
 * audit (`docs/qa-audit-2026-09-04.md`, M6); this keeps the count at zero
 * without needing a database, unlike migrationReplay.test.ts.
 *
 * Views are excluded — they live under `Views` in the generated types and are
 * created with CREATE VIEW, which this does not parse.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO_ROOT, "supabase/migrations");

function tablesInTypes(): string[] {
  const source = readFileSync(resolve(REPO_ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const start = source.indexOf("    Tables: {");
  const end = source.indexOf("    Views: {", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  return [...body.matchAll(/^ {6}([a-z_0-9]+): \{$/gm)].map((m) => m[1]);
}

function tablesCreatedByMigrations(): Set<string> {
  const created = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) {
      created.add(m[1].toLowerCase());
    }
  }
  return created;
}

describe("tables in the generated types are created by migrations", () => {
  it("names every table in types.ts in some CREATE TABLE", () => {
    const created = tablesCreatedByMigrations();
    const missing = tablesInTypes().filter((table) => !created.has(table));

    expect(
      missing,
      `These tables exist in src/integrations/supabase/types.ts but no migration creates them. ` +
        `They were made from the dashboard; add a CREATE TABLE IF NOT EXISTS migration ` +
        `(see 20260904120000_out_of_band_tables.sql) so a rebuilt database has them.`,
    ).toEqual([]);
  });

  it("parses enough of both sides to mean something", () => {
    expect(tablesInTypes().length).toBeGreaterThan(100);
    expect(tablesCreatedByMigrations().size).toBeGreaterThan(100);
  });
});
