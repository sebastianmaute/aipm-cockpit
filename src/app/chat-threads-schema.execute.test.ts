// src/app/chat-threads-schema.execute.test.ts — the chat_threads statement
// builders EXECUTED against a real SQLite engine (`node:sqlite`), the way
// turso-schema.execute.test.ts does for the workspace tables. String-matching
// the SQL cannot show which rows a DELETE really removes.
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CHAT_THREADS_DDL, chatThreadsHealAlters, upsertThreadStatements, pruneThreadsStatements,
  expireThreadsStatements, deleteOwnerThreadsStatements, deleteThreadStatements, threadsSelect, retentionCutoff,
  legacyThreadIdsSelect,
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

function row(id: string, over: Partial<StoredThreadRow> = {}): StoredThreadRow {
  return {
    id, project_id: "p", owner_id: "alice", name: "c1.n", created_at: daysAgo(1), updated_at: daysAgo(1),
    history_json: "c1.h", display_json: "c1.d", key_owner: "c1.k", key_operator: "r1.k", ...over,
  };
}

/** Insert a legacy row with a real SQL NULL owner, which the builders never bind. */
function insertNullOwner(db: DatabaseSync, id: string, updatedAt: string | null = daysAgo(1), projectId = "p"): void {
  db.prepare("INSERT INTO chat_threads (id, project_id, owner_id, name, updated_at) VALUES (?, ?, NULL, 'Old', ?)")
    .run(id, projectId, updatedAt);
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
    expect(out).toEqual([{ ...row("t1"), name: "c1.renamed" }]);
  });

  it("select returns the owner's rows and the legacy rows of the project, never another owner's", () => {
    run(db, upsertThreadStatements(row("a", { updated_at: daysAgo(3) })));
    run(db, upsertThreadStatements(row("b", { owner_id: "bob" })));
    run(db, upsertThreadStatements(row("e", { owner_id: "" })));
    run(db, upsertThreadStatements(row("q", { project_id: "other" })));
    insertNullOwner(db, "n", daysAgo(2));
    const [stmt] = threadsSelect("p", "alice");
    expect(query(db, stmt).map((r) => r.id)).toEqual(["e", "n", "a"]);
    const [legacyOnly] = threadsSelect("p", null);
    expect(query(db, legacyOnly).map((r) => r.id)).toEqual(["e", "n"]);
  });

  it("prune keeps the newest 50 per owner and never deletes another owner's rows", () => {
    for (let i = 0; i < 55; i += 1) {
      run(db, upsertThreadStatements(row(`a${String(i).padStart(2, "0")}`, { updated_at: daysAgo(100 - i) })));
    }
    for (let i = 0; i < 3; i += 1) run(db, upsertThreadStatements(row(`b${i}`, { owner_id: "bob", updated_at: daysAgo(500) })));
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
    run(db, upsertThreadStatements(row("e1", { owner_id: "", updated_at: daysAgo(9) })));
    run(db, upsertThreadStatements(row("a", { updated_at: daysAgo(99) })));
    run(db, pruneThreadsStatements("p", null, 1));
    expect(ids(db)).toEqual(["a", "n2"]);
  });

  it("expire deletes a row 31 days old at 30, keeps one 29 days old, and deletes NULL or empty updated_at", () => {
    run(db, upsertThreadStatements(row("old", { updated_at: daysAgo(31) })));
    run(db, upsertThreadStatements(row("young", { updated_at: daysAgo(29) })));
    run(db, upsertThreadStatements(row("blank", { updated_at: "" })));
    insertNullOwner(db, "nullts", null);
    run(db, expireThreadsStatements(retentionCutoff(NOW, 30)));
    expect(ids(db)).toEqual(["young"]);
  });

  it("expire deletes a row whose updated_at is not a date, and keeps a well-formed future date", () => {
    run(db, upsertThreadStatements(row("garbage", { updated_at: "garbage" })));
    run(db, upsertThreadStatements(row("future", { updated_at: "9999-01-01T00:00:00.000Z" })));
    run(db, upsertThreadStatements(row("young", { updated_at: daysAgo(29) })));
    run(db, expireThreadsStatements(retentionCutoff(NOW, 30)));
    expect(ids(db)).toEqual(["future", "young"]);
  });

  it("upsert never overwrites another owner's row", () => {
    run(db, upsertThreadStatements(row("t", { name: "c1.alice" })));
    const before = db.prepare("SELECT * FROM chat_threads").all();
    run(db, upsertThreadStatements(row("t", { owner_id: "bob", name: "c1.bob", key_owner: "c1.bobkey" })));
    expect(db.prepare("SELECT * FROM chat_threads").all()).toEqual(before);
  });

  it("upsert takes over a legacy row (NULL or empty owner)", () => {
    insertNullOwner(db, "n");
    run(db, upsertThreadStatements(row("e", { owner_id: "" })));
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
    expect(db.prepare("SELECT * FROM chat_threads").all()).toEqual([
      row("t", { name: "c1.v2", updated_at: daysAgo(0), key_owner: "c1.k2" }),
    ]);
  });

  it("delete is scoped to the owner: bob cannot delete alice's row, but can delete a legacy one", () => {
    run(db, upsertThreadStatements(row("a")));
    insertNullOwner(db, "n");
    run(db, upsertThreadStatements(row("e", { owner_id: "" })));
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
    run(db, upsertThreadStatements(row("old-p", { updated_at: daysAgo(40) })));
    run(db, upsertThreadStatements(row("old-q", { project_id: "q", updated_at: daysAgo(40) })));
    run(db, expireThreadsStatements(retentionCutoff(NOW, 30), "p"));
    expect(ids(db)).toEqual(["old-q"]);
  });

  it("deleteOwnerThreads removes one owner's rows in every project and nothing else", () => {
    run(db, upsertThreadStatements(row("a1")));
    run(db, upsertThreadStatements(row("a2", { project_id: "q" })));
    run(db, upsertThreadStatements(row("b1", { owner_id: "bob" })));
    insertNullOwner(db, "n");
    run(db, deleteOwnerThreadsStatements("alice"));
    expect(ids(db)).toEqual(["b1", "n"]);
  });

  it("legacyThreadIdsSelect returns the ids of every owner-less row in every project, and nothing else", () => {
    run(db, upsertThreadStatements(row("a1")));
    run(db, upsertThreadStatements(row("b1", { owner_id: "bob" })));
    run(db, upsertThreadStatements(row("e", { owner_id: "", project_id: "q" })));
    insertNullOwner(db, "n");
    const [stmt] = legacyThreadIdsSelect();
    expect(query(db, stmt).map((r) => r.id).sort()).toEqual(["e", "n"]);
    expect(stmt.sql).toMatch(/^SELECT id FROM chat_threads/);
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
});
