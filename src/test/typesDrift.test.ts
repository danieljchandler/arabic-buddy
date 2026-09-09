import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS_MISSING_FROM_TYPES,
  type DriftedColumn,
} from "./support/postgrest/typesDrift";
import { columnsFromTypes, getTable } from "./support/postgrest/schema";

/**
 * Two guards on the relationship between the migrations and the generated
 * types, pulling in opposite directions.
 *
 * 1. The drift list is honest. `typesDrift.ts` tells the test backend to
 *    accept columns that `src/integrations/supabase/types.ts` does not know
 *    about. That is a hole in the strongest check the suite has — the emulator
 *    otherwise rejects an unknown column exactly as PostgREST does, which is
 *    what catches a fixture inventing a field and then silently matching
 *    nothing. So each entry has to earn its place: the migration it names must
 *    exist, must genuinely create that column on that table, and the column
 *    must still be absent from the generated types.
 *
 * 2. The generated types are complete. Every column the migrations create on a
 *    table the types know about must be listed there, unless a later migration
 *    drops it or the drift list excuses it. This is the guard against the
 *    failure that hit `main` four times in three days (f55f4f7, 62ee579,
 *    aef4417, and once before): Lovable regenerates `types.ts` from the live
 *    schema of its Cloud project at the start of every session, and a
 *    migration merged through GitHub is *not* applied to that project — so
 *    when a migration lands without also being run there, the next Lovable
 *    session deletes its columns from the file, and the loss surfaces two
 *    hops away as a fixture "inventing" columns. Restoring the file is not a
 *    fix; the columns are genuinely missing from production, and the next
 *    regeneration deletes them again. This test names the migration, and says
 *    so.
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

function migrationSource(entry: DriftedColumn): string | undefined {
  const path = `${MIGRATIONS}/${entry.migration}.sql`;
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

interface ColumnRef {
  table: string;
  column: string;
}

/** What one migration does to columns, as far as these guards care. */
interface ColumnChanges {
  added: ColumnRef[];
  dropped: ColumnRef[];
  /** `DROP TABLE t` — every column of `t` goes with it. */
  droppedTables: string[];
  /** `ALTER TABLE a RENAME TO b` — `a`'s columns carry over to `b`. */
  renamedTables: Array<{ from: string; to: string }>;
}

const TABLE = `(?:IF EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const IDENT = `"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const CONSTRAINT_KEYWORDS = /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|LIKE|EXCLUDE)$/i;

/**
 * Parse the column-level DDL out of a migration.
 *
 * Three shapes cover every migration in the repo: `CREATE TABLE t (...)` with a
 * bare `x TYPE` line per column, `ALTER TABLE t ADD COLUMN [IF NOT EXISTS] x`,
 * and the two ways a column goes away, `DROP COLUMN` and `RENAME COLUMN`.
 * Comments are stripped first so a column name in a `--` remark cannot count.
 *
 * The `CREATE TABLE` body ends at the first `);` on its own line, whatever its
 * indentation: a table created inside a `DO $$ ... $$` block (pgvector's
 * `content_embeddings`) is indented, and stopping only at column zero would run
 * the body on into the next function's parameter list.
 */
export function columnChanges(sql: string): ColumnChanges {
  const source = sql.replace(/--[^\n]*/g, "");
  const added: ColumnRef[] = [];
  const dropped: ColumnRef[] = [];
  const droppedTables: string[] = [];
  const renamedTables: Array<{ from: string; to: string }> = [];

  const created = new RegExp(
    `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:public\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = created.exec(source)) !== null) {
    const table = match[1];
    for (const line of match[2].split("\n")) {
      const column = new RegExp(`^\\s*${IDENT}\\s+[A-Za-z]`).exec(line);
      if (column && !CONSTRAINT_KEYWORDS.test(column[1])) {
        added.push({ table, column: column[1] });
      }
    }
  }

  // One ALTER TABLE statement can add several columns, so the table name and a
  // column can be lines apart; the statement runs to its semicolon.
  const altered = new RegExp(`ALTER TABLE\\s+${TABLE}\\s+([\\s\\S]*?);`, "gi");
  while ((match = altered.exec(source)) !== null) {
    const table = match[1];
    const body = match[2];

    const add = new RegExp(`ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?${IDENT}`, "gi");
    let clause: RegExpExecArray | null;
    while ((clause = add.exec(body)) !== null) added.push({ table, column: clause[1] });

    const drop = new RegExp(`DROP COLUMN\\s+(?:IF EXISTS\\s+)?${IDENT}`, "gi");
    while ((clause = drop.exec(body)) !== null) dropped.push({ table, column: clause[1] });

    const rename = new RegExp(`RENAME COLUMN\\s+${IDENT}\\s+TO\\s+${IDENT}`, "gi");
    while ((clause = rename.exec(body)) !== null) {
      dropped.push({ table, column: clause[1] });
      added.push({ table, column: clause[2] });
    }

    const renamed = new RegExp(`^\\s*RENAME TO\\s+${IDENT}`, "i").exec(body);
    if (renamed) renamedTables.push({ from: table, to: renamed[1] });
  }

  const droppedTable = new RegExp(`DROP TABLE\\s+${TABLE}`, "gi");
  while ((match = droppedTable.exec(source)) !== null) droppedTables.push(match[1]);

  return { added, dropped, droppedTables, renamedTables };
}

/** Does this migration create `column` on `table`? */
function createsColumn(sql: string, table: string, column: string): boolean {
  return columnChanges(sql).added.some(
    (ref) => ref.table === table && ref.column === column,
  );
}

interface CreatedColumn extends ColumnRef {
  /** The migration that most recently created it, without the `.sql`. */
  migration: string;
}

/**
 * Every column the migration history leaves in place, replayed in filename
 * order so a column that is added, dropped and added again counts once, under
 * the migration that last created it.
 */
function columnsCreatedByMigrations(): CreatedColumn[] {
  const live = new Map<string, CreatedColumn>();
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const migration = file.replace(/\.sql$/, "");
    const { added, dropped, droppedTables, renamedTables } = columnChanges(
      readFileSync(resolve(MIGRATIONS, file), "utf8"),
    );
    for (const table of droppedTables) {
      for (const key of live.keys()) if (key.startsWith(`${table}.`)) live.delete(key);
    }
    for (const { from, to } of renamedTables) {
      for (const [key, ref] of [...live]) {
        if (ref.table !== from) continue;
        live.delete(key);
        live.set(`${to}.${ref.column}`, { ...ref, table: to });
      }
    }
    for (const ref of dropped) live.delete(`${ref.table}.${ref.column}`);
    for (const ref of added) live.set(`${ref.table}.${ref.column}`, { ...ref, migration });
  }

  return [...live.values()];
}

describe("the generated Supabase types are stale in a known, pinned set of places", () => {
  it("lists something — otherwise the plumbing in schema.ts is dead code", () => {
    expect(COLUMNS_MISSING_FROM_TYPES.length).toBeGreaterThan(0);
  });

  it("has no duplicate entries", () => {
    const keys = COLUMNS_MISSING_FROM_TYPES.map((e) => `${e.table}.${e.column}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  describe.each(COLUMNS_MISSING_FROM_TYPES.map((entry) => [`${entry.table}.${entry.column}`, entry] as const))("%s", (_label, entry) => {
    it(`is created by ${entry.migration}`, () => {
      const sql = migrationSource(entry);
      expect(sql, `supabase/migrations/${entry.migration}.sql does not exist`).toBeDefined();
      expect(
        createsColumn(sql as string, entry.table, entry.column),
        `${entry.migration}.sql does not add "${entry.column}" to "${entry.table}". ` +
          `Either the column name is a typo, or the entry names the wrong migration.`,
      ).toBe(true);
    });

    it("is still missing from the generated types", () => {
      const declared = columnsFromTypes(entry.table);
      // A table absent from the types entirely — the service-role-only ones —
      // has nothing to be stale about.
      if (!declared) return;

      expect(
        declared.has(entry.column),
        `"${entry.column}" is now in types.ts for "${entry.table}". Delete this ` +
          `entry from COLUMNS_MISSING_FROM_TYPES — the drift it documents is fixed.`,
      ).toBe(false);
    });

    it("is accepted by the test backend", () => {
      // The point of the list. Without this the emulator would 400 a write the
      // real database takes, and the failure would look like an app bug.
      expect(getTable(entry.table)?.columns.has(entry.column)).toBe(true);
    });
  });
});

describe("the generated Supabase types list every column the migrations create", () => {
  const excused = new Set(
    COLUMNS_MISSING_FROM_TYPES.map((entry) => `${entry.table}.${entry.column}`),
  );
  // A table with no anon or authenticated grant is absent from the file
  // wholesale — the generator skips it — and the drift list names it column by
  // column. That is the *only* reason a table may be missing: an unapplied
  // migration that creates a whole table (access_credentials in d3b05a2, the
  // 20260902 tables in 8b2f499) also leaves it absent from a regenerated
  // types.ts, and skipping every absent table would let exactly that through.
  const excusedTables = new Set(COLUMNS_MISSING_FROM_TYPES.map((entry) => entry.table));

  const checkable = columnsCreatedByMigrations().filter(
    (ref) => !excused.has(`${ref.table}.${ref.column}`) && !excusedTables.has(ref.table),
  );

  it("sees the migration history — a parser that matches nothing would pass vacuously", () => {
    expect(checkable.length).toBeGreaterThan(1000);
  });

  it("would notice the loss it exists for: the curriculum-track columns, all eight", () => {
    // The columns 20260905100000_curriculum_tracks_schema.sql adds are the ones
    // that have been deleted from types.ts four times. If the parser stopped
    // seeing them, the check below would go quiet while the regressions
    // continued, so their presence in the scan is asserted on its own.
    const curriculumColumns = new Set([
      "lessons.can_do",
      "lessons.culture_notes",
      "lessons.dialogue",
      "lessons.grammar_notes",
      "lessons.source_key",
      "vocabulary_words.example_arabic",
      "vocabulary_words.example_english",
      "vocabulary_words.example_transliteration",
    ]);
    const seen = checkable
      // Reconciliation migrations can legitimately become the most recent
      // creator. Pin the columns the replay sees, not an obsolete provenance.
      .filter((ref) => curriculumColumns.has(`${ref.table}.${ref.column}`))
      .map((ref) => `${ref.table}.${ref.column}`)
      .sort();
    expect(seen).toEqual([
      "lessons.can_do",
      "lessons.culture_notes",
      "lessons.dialogue",
      "lessons.grammar_notes",
      "lessons.source_key",
      "vocabulary_words.example_arabic",
      "vocabulary_words.example_english",
      "vocabulary_words.example_transliteration",
    ]);
  });

  it("would notice a whole table going missing, not only a column", () => {
    // access_credentials is the precedent: created by a branch migration,
    // deleted from types.ts wholesale by the next Lovable session (d3b05a2),
    // back two minutes later once Lovable had applied its own copy. Its
    // columns must be in the scan for the check below to see a repeat. The
    // table is created twice in the history — the branch's migration and
    // Lovable's copy, both IF NOT EXISTS — and the scan credits the later one.
    const seen = checkable.filter((ref) => ref.table === "access_credentials");
    expect(seen.map((ref) => ref.column)).toContain("access_id");
    expect(
      seen.map((ref) => ref.migration),
      "access_credentials is created by the ID-login migrations, whichever copy ran last",
    ).toSatisfy((names: string[]) =>
      names.every((name) =>
        name === "20260901120000_access_id_logins" ||
        name === "20260901155301_3c108159-1e71-43d1-9b5b-aff7bdb65156",
      ),
    );
  });

  it("has every one of them in src/integrations/supabase/types.ts", () => {
    const missing = checkable.filter(
      (ref) => !columnsFromTypes(ref.table)?.has(ref.column),
    );

    const listing = missing
      .map((ref) => {
        const whole = columnsFromTypes(ref.table) === undefined ? ", whole table absent" : "";
        return `  ${ref.table}.${ref.column}  (${ref.migration}.sql${whole})`;
      })
      .join("\n");
    const migrations = [...new Set(missing.map((ref) => ref.migration))].join(", ");

    expect(
      missing.map((ref) => `${ref.table}.${ref.column}`),
      `src/integrations/supabase/types.ts no longer lists these columns, which the migrations create:\n` +
        `${listing}\n\n` +
        `This is almost certainly a regeneration of types.ts against a database where ` +
        `${migrations} has never been applied. Lovable regenerates the file from the live ` +
        `schema of its Cloud project at the start of every session (the "Work in progress" commits), ` +
        `and a migration merged through GitHub is NOT applied to that project — so the column is ` +
        `missing from production too, and every read of it returns nothing.\n\n` +
        `Do not restore the file by hand; the next Lovable session deletes the lines again. Apply the ` +
        `migration to the project (ask Lovable to run it, which commits its own copy under ` +
        `supabase/migrations/, or push it with the Supabase CLI) and let the regeneration bring the ` +
        `columns back. If a column was removed on purpose, say so with a DROP COLUMN migration. If the ` +
        `table carries no anon/authenticated grant, so the generator skips it on purpose, list its ` +
        `columns in COLUMNS_MISSING_FROM_TYPES instead — that is the only excuse for an absent table.`,
    ).toEqual([]);
  });
});
