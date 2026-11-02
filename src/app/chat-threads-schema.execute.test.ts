// src/app/chat-threads-schema.execute.test.ts — the chat_threads statement
// builders EXECUTED against a real SQLite engine (`node:sqlite`), the way
// turso-schema.execute.test.ts does for the workspace tables. String-matching
// the SQL cannot show which rows a DELETE really removes.
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAT_THREADS_DDL, chatThreadsHealAlters, upsertThreadStatements, pruneThreadsStatements,
  expireThreadsStatements, deleteOwnerThreadsStatements, deleteThreadStatements, threadsSelect, retentionCutoff,
  legacyThreadIdsSelect, updateStoredThreadStatements, allThreadIdsSelect, ownerThreadsSelect,
  type StoredThreadRow,
} from "./chat-threads-schema";
import { pragmaStatements } from "./turso-migrate";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function run(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) db.exec(s.sql);
    else db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}

function query(db: DatabaseSync, stmt: SqlStmt): Record<string, unknown>[] {
  return db.prepare(stmt.sql).all(...(stmt.args ?? []).map(bindArg));
}

function asResult(rows: Record<string, unknown>[]): PipelineResultLike {
  const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [{ name: "name" }];
  return {
    type: "ok",
    response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] as string }))) } },
  };
}

function ids(db: DatabaseSync): string[] {
  return (db.prepare("SELECT id FROM chat_threads ORDER BY id").all() as { id: string }[]).map((r) => r.id);
}

const DAY = 86_400_000;
const NOW = new Date("2026-11-01T12:00:00.000Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY).toISOString();
// Expiry reads the DATABASE's clock ('now' in SQL), so its rows are dated from the real clock.
const HOUR = 3_600_000;
const realAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

function row(id: string, over: Partial<StoredThreadRow> = {}): StoredThreadRow {
  return {
    id, project_id: "p", owner_id: "alice", name: "c1.n", created_at: daysAgo(1), updated_at: daysAgo(1),
    history_json: "c1.h", display_json: "c1.d", key_owner: "c1.k", key_operator: "r1.k", ...over,
  };
}

/** A legacy row with a real SQL NULL owner, which the builders never bind. The owner guard refuses an
 *  owner-less INSERT, so it is written owned and then made owner-less, the way a row from before the
 *  guard looks. */
function insertNullOwner(db: DatabaseSync, id: string, updatedAt: string | null = daysAgo(1), projectId = "p"): void {
  db.prepare("INSERT INTO chat_threads (id, project_id, owner_id, name, updated_at) VALUES (?, ?, 'seed', 'Old', ?)")
    .run(id, projectId, updatedAt);
  db.prepare("UPDATE chat_threads SET owner_id = NULL WHERE id = ?").run(id);
}

/** Insert a row exactly as given, its dates included: the builders date every write by the database
 *  clock, so a fixture that needs an age is seeded directly. */
function seed(db: DatabaseSync, r: StoredThreadRow): void {
  const cols = Object.keys(r) as (keyof StoredThreadRow)[];
  const owner = r.owner_id === "" ? "seed" : r.owner_id;
  db.prepare(`INSERT INTO chat_threads (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...cols.map((c) => (c === "owner_id" ? owner : r[c])));
  // A legacy (owner-less) fixture: the owner guard refuses an owner-less INSERT, so it is made
  // owner-less afterwards, the way a row from before the guard looks.
  if (r.owner_id === "") db.prepare("UPDATE chat_threads SET owner_id = '' WHERE id = ?").run(r.id);
}

/** Rows without their two dates, which every write takes from the database clock. */
function undated(rows: unknown[]): Record<string, unknown>[] {
  return (rows as Record<string, unknown>[]).map((r) => {
    const copy = { ...r };
    delete copy.created_at;
    delete copy.updated_at;
    return copy;
  });
}

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  run(db, CHAT_THREADS_DDL.map((sql) => ({ sql })));
});

describe("chat_threads statements against a real engine", () => {
  it("the DDL carries the owner and key columns", () => {
    const cols = (db.prepare(`PRAGMA table_info("chat_threads")`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["owner_id", "key_owner", "key_operator"]));
  });

  it("upsert writes every column and replaces in place", () => {
    run(db, upsertThreadStatements(row("t1")));
    run(db, upsertThreadStatements(row("t1", { name: "c1.renamed" })));
    const out = db.prepare("SELECT * FROM chat_threads").all();
    expect(undated(out)).toEqual(undated([{ ...row("t1"), name: "c1.renamed" }]));
  });

  it("select returns the owner's rows and the legacy rows of the project, never another owner's", () => {
    seed(db, row("a", { updated_at: daysAgo(3) }));
    seed(db, row("b", { owner_id: "bob" }));
    seed(db, row("e", { owner_id: "" }));
    seed(db, row("q", { project_id: "other" }));
    insertNullOwner(db, "n", daysAgo(2));
    const [stmt] = threadsSelect("p", "alice");
    expect(query(db, stmt).map((r) => r.id)).toEqual(["e", "n", "a"]);
    const [legacyOnly] = threadsSelect("p", null);
    expect(query(db, legacyOnly).map((r) => r.id)).toEqual(["e", "n"]);
  });

  it("prune keeps the newest 50 per owner and never deletes another owner's rows", () => {
    for (let i = 0; i < 55; i += 1) {
      seed(db, row(`a${String(i).padStart(2, "0")}`, { updated_at: daysAgo(100 - i) }));
    }
    for (let i = 0; i < 3; i += 1) seed(db, row(`b${i}`, { owner_id: "bob", updated_at: daysAgo(500) }));
    insertNullOwner(db, "legacy", daysAgo(900));
    run(db, pruneThreadsStatements("p", "alice", 50));
    const left = ids(db);
    expect(left.filter((id) => id.startsWith("a"))).toHaveLength(50);
    expect(left).not.toContain("a00");
    expect(left).toContain("a54");
    expect(left.filter((id) => id.startsWith("b"))).toEqual(["b0", "b1", "b2"]);
    expect(left).toContain("legacy");
  });

  it("prune of the legacy group touches only owner-less rows", () => {
    insertNullOwner(db, "n1", daysAgo(5));
    insertNullOwner(db, "n2", daysAgo(1));
    seed(db, row("e1", { owner_id: "", updated_at: daysAgo(9) }));
    seed(db, row("a", { updated_at: daysAgo(99) }));
    run(db, pruneThreadsStatements("p", null, 1));
    expect(ids(db)).toEqual(["a", "n2"]);
  });

  it("expire deletes a row 31 days old at 30, keeps one 29 days old, and deletes NULL or empty updated_at", () => {
    seed(db, row("old", { updated_at: realAgo(31 * DAY) }));
    seed(db, row("young", { updated_at: realAgo(29 * DAY) }));
    seed(db, row("blank", { updated_at: "" }));
    insertNullOwner(db, "nullts", null);
    run(db, expireThreadsStatements(30));
    expect(ids(db)).toEqual(["young"]);
  });

  it("expire deletes a row whose updated_at is not a date", () => {
    seed(db, row("garbage", { updated_at: "garbage" }));
    seed(db, row("young", { updated_at: realAgo(29 * DAY) }));
    run(db, expireThreadsStatements(30));
    expect(ids(db)).toEqual(["young"]);
  });

  it("expire deletes a date more than a day in the future by the database clock, and keeps one an hour ahead", () => {
    seed(db, row("far", { updated_at: realAgo(-2 * DAY) }));
    seed(db, row("year9999", { updated_at: "9999-01-01T00:00:00.000Z" }));
    seed(db, row("soon", { updated_at: realAgo(-HOUR) }));
    run(db, expireThreadsStatements(30));
    expect(ids(db)).toEqual(["soon"]);
  });

  it("expire computes its cutoff in SQL from the database clock, not from a bound instant", () => {
    const [stmt] = expireThreadsStatements(30);
    expect(stmt.sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)");
    expect(stmt.args).toEqual([{ type: "text", value: "-30 days" }]);
  });

  it("upsert never overwrites another owner's row", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.alice" })));
    const before = db.prepare("SELECT * FROM chat_threads").all();
    run(db, upsertThreadStatements(row("t", { owner_id: "bob", name: "c1.bob", key_owner: "c1.bobkey" })));
    expect(db.prepare("SELECT * FROM chat_threads").all()).toEqual(before);
  });

  it("upsert takes over a legacy row (NULL or empty owner)", () => {
    insertNullOwner(db, "n");
    seed(db, row("e", { owner_id: "" }));
    run(db, upsertThreadStatements(row("n", { owner_id: "bob", name: "c1.bob" })));
    run(db, upsertThreadStatements(row("e", { owner_id: "bob", name: "c1.bob" })));
    expect(db.prepare("SELECT id, owner_id, name FROM chat_threads ORDER BY id").all()).toEqual([
      { id: "e", owner_id: "bob", name: "c1.bob" },
      { id: "n", owner_id: "bob", name: "c1.bob" },
    ]);
  });

  it("upsert with the same id in another project leaves the original untouched", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.p" })));
    const before = db.prepare("SELECT * FROM chat_threads").all();
    run(db, upsertThreadStatements(row("t", { project_id: "q", name: "c1.q" })));
    expect(db.prepare("SELECT * FROM chat_threads").all()).toEqual(before);
  });

  it("an owner re-saving their own row updates it", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.v1" })));
    run(db, upsertThreadStatements(row("t", { name: "c1.v2", updated_at: daysAgo(0), key_owner: "c1.k2" })));
    expect(undated(db.prepare("SELECT * FROM chat_threads").all())).toEqual(undated([
      row("t", { name: "c1.v2", key_owner: "c1.k2" }),
    ]));
  });

  it("the stored-thread update never brings back a deleted row", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.v1" })));
    run(db, deleteOwnerThreadsStatements("alice"));
    const [stmt] = updateStoredThreadStatements(row("t", { name: "c1.v2" }));
    expect(db.prepare(stmt.sql).run(...(stmt.args ?? []).map(bindArg)).changes).toBe(0);
    expect(ids(db)).toEqual([]);
  });

  it("the stored-thread update rewrites the owner's row, takes over a legacy one, and leaves another owner's or project's alone", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.v1" })));
    run(db, updateStoredThreadStatements(row("t", { name: "c1.v2", updated_at: daysAgo(0), key_owner: "c1.k2" })));
    expect(undated(db.prepare("SELECT * FROM chat_threads").all())).toEqual(undated([
      row("t", { name: "c1.v2", key_owner: "c1.k2" }),
    ]));
    insertNullOwner(db, "n");
    run(db, updateStoredThreadStatements(row("n", { name: "c1.bob", owner_id: "bob" })));
    run(db, updateStoredThreadStatements(row("t", { name: "c1.bob", owner_id: "bob" })));
    run(db, updateStoredThreadStatements(row("t", { name: "c1.q", project_id: "q" })));
    expect(db.prepare("SELECT id, owner_id, name FROM chat_threads ORDER BY id").all()).toEqual([
      { id: "n", owner_id: "bob", name: "c1.bob" },
      { id: "t", owner_id: "alice", name: "c1.v2" },
    ]);
  });

  describe("every write is dated by the database clock, never the browser's", () => {
    const FAST = new Date(Date.now() + 3 * DAY).toISOString(); // a client clock three days fast
    const SLOW = new Date(Date.now() - 400 * DAY).toISOString(); // and one a year behind
    const dates = (id: string) =>
      db.prepare("SELECT created_at, updated_at FROM chat_threads WHERE id = ?").get(id) as { created_at: string; updated_at: string };
    const nearNow = (iso: string) => Math.abs(Date.parse(iso) - Date.now()) < 60_000;

    it("an insert, an update and a re-save with a fast client clock are not expired by the next expiry", () => {
      run(db, upsertThreadStatements(row("ins", { created_at: FAST, updated_at: FAST })));
      seed(db, row("upd"));
      run(db, updateStoredThreadStatements(row("upd", { updated_at: FAST })));
      seed(db, row("re"));
      run(db, upsertThreadStatements(row("re", { updated_at: FAST })));
      run(db, expireThreadsStatements(30));
      expect(ids(db)).toEqual(["ins", "re", "upd"]);
      for (const id of ["ins", "re", "upd"]) expect(nearNow(dates(id).updated_at)).toBe(true);
      expect(nearNow(dates("ins").created_at)).toBe(true);
    });

    it("a write with a slow client clock is dated now, so the next expiry keeps it", () => {
      run(db, upsertThreadStatements(row("ins", { created_at: SLOW, updated_at: SLOW })));
      run(db, expireThreadsStatements(30));
      expect(ids(db)).toEqual(["ins"]);
    });

    it("a re-save keeps the row's created_at; the date format is the one toISOString writes", () => {
      seed(db, row("t", { created_at: daysAgo(5) }));
      run(db, upsertThreadStatements(row("t", { created_at: FAST, updated_at: FAST })));
      expect(dates("t").created_at).toBe(daysAgo(5));
      expect(dates("t").updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    });
  });

  it("the RUNBOOK's expire one-liner is the app's statement for 30 days, word for word", () => {
    const [stmt] = expireThreadsStatements(30);
    const sql = `${stmt.sql.replace("?", "'-30 days'")};`;
    const runbook = readFileSync(join(process.cwd(), "docs", "RUNBOOK.md"), "utf8");
    expect(runbook.split(/\r?\n/)).toContain(sql);
  });

  it("delete is scoped to the owner: bob cannot delete alice's row, but can delete a legacy one", () => {
    seed(db, row("a"));
    insertNullOwner(db, "n");
    seed(db, row("e", { owner_id: "" }));
    run(db, deleteThreadStatements("a", "p", "bob"));
    run(db, deleteThreadStatements("n", "p", "bob"));
    run(db, deleteThreadStatements("e", "p", "bob"));
    expect(ids(db)).toEqual(["a"]);
    run(db, deleteThreadStatements("a", "q", "alice"));
    expect(ids(db)).toEqual(["a"]);
    run(db, deleteThreadStatements("a", "p", "alice"));
    expect(ids(db)).toEqual([]);
  });

  it("delete refuses an empty owner id", () => {
    expect(() => deleteThreadStatements("a", "p", "")).toThrow();
  });

  it("expire scoped to a project leaves other projects alone", () => {
    seed(db, row("old-p", { updated_at: realAgo(40 * DAY) }));
    seed(db, row("old-q", { project_id: "q", updated_at: realAgo(40 * DAY) }));
    run(db, expireThreadsStatements(30, "p"));
    expect(ids(db)).toEqual(["old-q"]);
  });

  it("deleteOwnerThreads removes one owner's rows in every project and nothing else", () => {
    seed(db, row("a1"));
    seed(db, row("a2", { project_id: "q" }));
    seed(db, row("b1", { owner_id: "bob" }));
    insertNullOwner(db, "n");
    run(db, deleteOwnerThreadsStatements("alice"));
    expect(ids(db)).toEqual(["b1", "n"]);
  });

  it("legacyThreadIdsSelect returns the ids of every owner-less row in every project, and nothing else", () => {
    seed(db, row("a1"));
    seed(db, row("b1", { owner_id: "bob" }));
    seed(db, row("e", { owner_id: "", project_id: "q" }));
    insertNullOwner(db, "n");
    const [stmt] = legacyThreadIdsSelect();
    expect(query(db, stmt).map((r) => r.id).sort()).toEqual(["e", "n"]);
    expect(stmt.sql).toMatch(/^SELECT id FROM chat_threads/);
  });

  it("allThreadIdsSelect returns every id in the database and no content", () => {
    seed(db, row("a"));
    seed(db, row("b", { owner_id: "bob", project_id: "q" }));
    insertNullOwner(db, "n");
    const out = query(db, allThreadIdsSelect()[0]);
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "n"]);
    expect(Object.keys(out[0])).toEqual(["id"]);
  });

  it("ownerThreadsSelect returns one owner's rows in every project, and no legacy or other owner's row", () => {
    seed(db, row("a1"));
    seed(db, row("a2", { project_id: "q" }));
    seed(db, row("b1", { owner_id: "bob" }));
    seed(db, row("e", { owner_id: "" }));
    insertNullOwner(db, "n");
    expect(query(db, ownerThreadsSelect("alice")[0]).map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(() => ownerThreadsSelect("")).toThrow();
  });

  it("deleteOwnerThreads refuses an empty owner id", () => {
    expect(() => deleteOwnerThreadsStatements("")).toThrow();
  });

  it("retentionCutoff is now minus whole days, as ISO", () => {
    expect(retentionCutoff(NOW, 30)).toBe("2026-10-02T12:00:00.000Z");
  });
});

describe("chat_threads heal", () => {
  const OLD_DDL = "CREATE TABLE chat_threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, history_json TEXT, display_json TEXT)";

  function pragma(d: DatabaseSync): PipelineResultLike {
    return asResult(query(d, pragmaStatements(["chat_threads"])[0]));
  }

  it("adds the three columns to an old-shaped table and is a no-op the second time", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(OLD_DDL);
    old.prepare("INSERT INTO chat_threads (id, project_id, name) VALUES ('t', 'p', 'Old')").run();
    run(old, CHAT_THREADS_DDL.map((sql) => ({ sql })));
    const alters = chatThreadsHealAlters(pragma(old));
    expect(alters.map((a) => a.sql)).toEqual([
      `ALTER TABLE "chat_threads" ADD COLUMN "owner_id" TEXT`,
      `ALTER TABLE "chat_threads" ADD COLUMN "key_owner" TEXT`,
      `ALTER TABLE "chat_threads" ADD COLUMN "key_operator" TEXT`,
    ]);
    run(old, alters);
    expect(chatThreadsHealAlters(pragma(old))).toEqual([]);
    // The legacy row survives as an owner-less row.
    expect(old.prepare("SELECT id, owner_id FROM chat_threads").all()).toEqual([{ id: "t", owner_id: null }]);
  });

  it("emits nothing for a fresh table or an unknown PRAGMA result", () => {
    expect(chatThreadsHealAlters(pragma(db))).toEqual([]);
    expect(chatThreadsHealAlters(undefined)).toEqual([]);
  });

  it("leaves an old-shaped database with the owner guard, which refuses the previous release's insert", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(OLD_DDL);
    old.prepare("INSERT INTO chat_threads (id, project_id, name) VALUES ('t', 'p', 'Old')").run();
    // The heal: the DDL, then the ALTERs it computes.
    run(old, CHAT_THREADS_DDL.map((sql) => ({ sql })));
    run(old, chatThreadsHealAlters(pragma(old)));
    const triggers = old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'chat_threads'").all();
    expect(triggers).toEqual([{ name: "chat_threads_owner_required" }]);
    expect(() => old.exec(`${PREVIOUS_RELEASE_INSERT} VALUES ('n', 'p', 'New', 'x', 'x', '[]', '[]')`)).toThrow(/owner required/);
    expect(old.prepare("SELECT id, owner_id FROM chat_threads").all()).toEqual([{ id: "t", owner_id: null }]);
  });
});

/** The previous release's save: an owner-less plaintext row, replacing any row with the same id. */
const PREVIOUS_RELEASE_INSERT =
  "INSERT OR REPLACE INTO chat_threads (id, project_id, name, created_at, updated_at, history_json, display_json)";

describe("chat_threads owner guard", () => {
  it("refuses an owner-less insert of a new id: no row is written", () => {
    expect(() => db.exec(`${PREVIOUS_RELEASE_INSERT} VALUES ('n', 'p', 'Plain', 'x', 'x', '[]', '[]')`)).toThrow(/owner required/);
    expect(() => db.exec("INSERT INTO chat_threads (id, project_id, owner_id) VALUES ('m', 'p', '')")).toThrow(/owner required/);
    expect(ids(db)).toEqual([]);
  });

  it("refuses an owner-less replace of an owned row: the owned row stays byte-identical", () => {
    seed(db, row("t1"));
    const before = db.prepare("SELECT * FROM chat_threads").all();
    expect(() => db.exec(`${PREVIOUS_RELEASE_INSERT} VALUES ('t1', 'p', 'Plain', 'x', 'x', '[]', '[]')`)).toThrow(/owner required/);
    expect(db.prepare("SELECT * FROM chat_threads").all()).toEqual(before);
  });

  it("lets an owned write through, as an insert and as an update of a legacy row it takes over", () => {
    run(db, upsertThreadStatements(row("t1")));
    seed(db, row("e", { owner_id: "" }));
    run(db, upsertThreadStatements(row("e")));
    expect(db.prepare("SELECT id, owner_id FROM chat_threads ORDER BY id").all()).toEqual([
      { id: "e", owner_id: "alice" }, { id: "t1", owner_id: "alice" },
    ]);
  });
});
