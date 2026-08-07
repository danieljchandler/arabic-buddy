import type { Row } from "./types";

/** A write the app performed, as recorded for assertions. */
export interface WriteRecord {
  table: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Rows sent by the client. Empty for DELETE. */
  payload: Row[];
  /** Rows the operation actually affected, after filtering. */
  affected: Row[];
  at: number;
}

/** A read the app performed, with its filters already parsed. */
export interface ReadRecord {
  table: string;
  /** The raw query string, for debugging a surprising result. */
  search: string;
  at: number;
}

export interface FailureSpec {
  status: number;
  body?: unknown;
  /** Consume after one request; otherwise it applies until cleared. */
  once: boolean;
}

/**
 * The in-memory database.
 *
 * Deliberately a plain object store rather than anything SQL-like: the point is
 * to answer PostgREST requests faithfully, not to reimplement Postgres. Writes
 * genuinely mutate it, which is what makes "add a word, see it in the list,
 * reload, still there" expressible — the previous double echoed an empty array
 * for every write, so no test could assert that anything was saved.
 */
export class MemoryDb {
  private tables = new Map<string, Row[]>();
  private failures = new Map<string, FailureSpec>();
  private delays = new Map<string, number>();

  readonly writes: WriteRecord[] = [];
  readonly reads: ReadRecord[] = [];

  /** Replace a table's contents. */
  seed(table: string, rows: Row[]): this {
    this.tables.set(table, rows.map((row) => ({ ...row })));
    return this;
  }

  /** Seed several tables at once. */
  seedAll(tables: Record<string, Row[]>): this {
    for (const [table, rows] of Object.entries(tables)) this.seed(table, rows);
    return this;
  }

  /** Append without clearing. */
  add(table: string, ...rows: Row[]): this {
    const existing = this.tables.get(table) ?? [];
    this.tables.set(table, [...existing, ...rows.map((row) => ({ ...row }))]);
    return this;
  }

  /** Current contents, as a copy. Use for assertions on persisted state. */
  rows(table: string): Row[] {
    return (this.tables.get(table) ?? []).map((row) => ({ ...row }));
  }

  has(table: string): boolean {
    return this.tables.has(table);
  }

  /** Live reference, for the executor only. */
  raw(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  // ── Fault injection ────────────────────────────────────────────────────────
  // Error and loading states are a large share of the UI and are almost never
  // covered, because provoking them normally means breaking the backend.

  /** Make the next request touching `table` fail. */
  failNext(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: true });
    return this;
  }

  /** Make every request touching `table` fail until cleared. */
  failAlways(table: string, status = 500, body?: unknown): this {
    this.failures.set(table, { status, body, once: false });
    return this;
  }

  clearFailure(table: string): this {
    this.failures.delete(table);
    return this;
  }

  /** Hold responses for `table` open, so loading states are assertable. */
  delay(table: string, ms: number): this {
    this.delays.set(table, ms);
    return this;
  }

  /** Consumed by the executor; not part of the public test API. */
  takeFailure(table: string): FailureSpec | undefined {
    const failure = this.failures.get(table);
    if (failure?.once) this.failures.delete(table);
    return failure;
  }

  delayFor(table: string): number {
    return this.delays.get(table) ?? 0;
  }

  // ── Journals ───────────────────────────────────────────────────────────────

  recordWrite(record: WriteRecord): void {
    this.writes.push(record);
  }

  recordRead(record: ReadRecord): void {
    this.reads.push(record);
  }

  /** Every write to a table, in order. */
  writesTo(table: string): WriteRecord[] {
    return this.writes.filter((write) => write.table === table);
  }

  /** The most recent write to a table, or undefined. */
  lastWriteTo(table: string): WriteRecord | undefined {
    return this.writesTo(table).at(-1);
  }

  /** Every read of a table, in order. */
  readsOf(table: string): ReadRecord[] {
    return this.reads.filter((read) => read.table === table);
  }

  resetJournals(): void {
    this.writes.length = 0;
    this.reads.length = 0;
  }
}
