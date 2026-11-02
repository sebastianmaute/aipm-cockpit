// src/app/chat-keys-schema.execute.test.ts — the chat_keys statement builders (and the adoption
// re-own UPDATE on chat_threads) EXECUTED against a real SQLite engine (`node:sqlite`), the way
// chat-threads-schema.execute.test.ts does. String-matching the SQL cannot show which rows change.
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CHAT_KEYS_DDL, upsertChatKeyStatements, deleteChatKeyStatements, chatKeyByCodeSelect,
  ownerThreadKeysSelect, reownThreadStatements, isUnlockCodeClash, type ChatKeyRow,
} from "./chat-keys-schema";
import { CHAT_THREADS_DDL, type StoredThreadRow } from "./chat-threads-schema";
import { TABLE_NAMES, type SqlStmt } from "./turso-schema";

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

function keyRow(ownerId: string, over: Partial<ChatKeyRow> = {}): ChatKeyRow {
  return { owner_id: ownerId, unlock_code: `CODE${ownerId.toUpperCase()}`.slice(0, 8), salt: "s", wrapped_key: "iv.ct", created_at: "2026-11-01T00:00:00.000Z", ...over };
}

function threadRow(id: string, ownerId: string): StoredThreadRow {
  return {
    id, project_id: "p", owner_id: ownerId, name: "c1.n", created_at: "c", updated_at: "u",
    history_json: "c1.h", display_json: "c1.d", key_owner: `k-${ownerId}`, key_operator: "r1.op",
  };
}

/** Insert a thread row exactly as given, its dates included (the builders date writes by the database clock). */
function seed(db: DatabaseSync, r: StoredThreadRow): void {
  const cols = Object.keys(r) as (keyof StoredThreadRow)[];
  db.prepare(`INSERT INTO chat_threads (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => r[c]));
}

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  run(db, CHAT_KEYS_DDL.map((sql) => ({ sql })));
  run(db, CHAT_THREADS_DDL.map((sql) => ({ sql })));
});

describe("chat_keys statements against a real engine", () => {
  it("chat_keys is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("chat_keys");
  });

  it("the DDL creates the table with its five columns and is re-runnable", () => {
    run(db, CHAT_KEYS_DDL.map((sql) => ({ sql })));
    const cols = (db.prepare(`PRAGMA table_info("chat_keys")`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["owner_id", "unlock_code", "salt", "wrapped_key", "created_at"]);
  });

  it("setting again replaces the owner's row in place", () => {
    run(db, upsertChatKeyStatements(keyRow("alice", { unlock_code: "AAAAAAAA" })));
    run(db, upsertChatKeyStatements(keyRow("alice", { unlock_code: "BBBBBBBB", salt: "s2" })));
    expect(db.prepare("SELECT owner_id, unlock_code, salt FROM chat_keys").all())
      .toEqual([{ owner_id: "alice", unlock_code: "BBBBBBBB", salt: "s2" }]);
  });

  it("a second owner cannot take an unlock code already in use, and the clash is recognised", () => {
    run(db, upsertChatKeyStatements(keyRow("alice", { unlock_code: "AAAAAAAA" })));
    let err: unknown;
    try {
      run(db, upsertChatKeyStatements(keyRow("bob", { unlock_code: "AAAAAAAA" })));
    } catch (e) {
      err = e;
    }
    expect(isUnlockCodeClash(err)).toBe(true);
    expect(isUnlockCodeClash(new Error("network"))).toBe(false);
    expect(db.prepare("SELECT owner_id FROM chat_keys").all()).toEqual([{ owner_id: "alice" }]);
  });

  it("the unlock select reads only the row with that code", () => {
    run(db, upsertChatKeyStatements(keyRow("alice", { unlock_code: "AAAAAAAA" })));
    run(db, upsertChatKeyStatements(keyRow("bob", { unlock_code: "BBBBBBBB" })));
    const [stmt] = chatKeyByCodeSelect("BBBBBBBB");
    expect(query(db, stmt).map((r) => r.owner_id)).toEqual(["bob"]);
    expect(query(db, chatKeyByCodeSelect("ZZZZZZZZ")[0])).toEqual([]);
  });

  it("remove deletes the caller's own row only, and refuses an empty owner", () => {
    run(db, upsertChatKeyStatements(keyRow("alice", { unlock_code: "AAAAAAAA" })));
    run(db, upsertChatKeyStatements(keyRow("bob", { unlock_code: "BBBBBBBB" })));
    run(db, deleteChatKeyStatements("alice"));
    expect(db.prepare("SELECT owner_id FROM chat_keys").all()).toEqual([{ owner_id: "bob" }]);
    expect(() => deleteChatKeyStatements("")).toThrow();
  });

  it("the owner's thread-key select reads only that owner's rows, in every project", () => {
    seed(db, threadRow("a1", "old"));
    seed(db, { ...threadRow("a2", "old"), project_id: "q" });
    seed(db, threadRow("b1", "bob"));
    const rows = query(db, ownerThreadKeysSelect("old")[0]);
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(rows[0]).toHaveProperty("key_owner");
    expect(() => ownerThreadKeysSelect("")).toThrow();
  });

  it("re-own keeps the moved row's updated_at, so the move does not restart its retention period", () => {
    seed(db, threadRow("a1", "old"));
    seed(db, threadRow("b1", "bob"));
    const resealed = (id: string) => ({ id, projectId: "p", fromKeyOwner: "k-old", keyOwner: "k-new", name: "c2.n", historyJson: "c2.h", displayJson: "c2.d" });
    run(db, reownThreadStatements(resealed("a1"), "old", "new"));
    run(db, reownThreadStatements(resealed("b1"), "old", "new"));
    const row = (id: string) => db.prepare("SELECT owner_id, updated_at FROM chat_threads WHERE id = ?").get(id);
    expect(row("a1")).toEqual({ owner_id: "new", updated_at: "u" });
    expect(row("b1")).toEqual({ owner_id: "bob", updated_at: "u" });
  });

  it("re-own leaves a row saved again since it was read (another owner wrap) alone", () => {
    seed(db, { ...threadRow("a1", "old"), key_owner: "k-old-resaved" });
    run(db, reownThreadStatements(
      { id: "a1", projectId: "p", fromKeyOwner: "k-old", keyOwner: "k-new", name: "c2.n", historyJson: "c2.h", displayJson: "c2.d" },
      "old", "new",
    ));
    expect(db.prepare("SELECT owner_id, key_owner FROM chat_threads WHERE id = 'a1'").get())
      .toEqual({ owner_id: "old", key_owner: "k-old-resaved" });
  });

  it("re-own moves one row from the old owner with its re-sealed fields, keeping key_operator", () => {
    seed(db, threadRow("a1", "old"));
    seed(db, threadRow("b1", "bob"));
    const resealed = (id: string, projectId = "p") =>
      ({ id, projectId, fromKeyOwner: "k-old", keyOwner: "k-new", name: "c2.n", historyJson: "c2.h", displayJson: "c2.d" });
    run(db, reownThreadStatements(resealed("a1"), "old", "new"));
    // A row that is no longer the old owner's, or not in that project, is left alone.
    run(db, reownThreadStatements(resealed("b1"), "old", "new"));
    seed(db, threadRow("a2", "old"));
    run(db, reownThreadStatements(resealed("a2", "q"), "old", "new"));
    // Every row keeps its updated_at (pinned in the test above), the moved one included.
    const rows = db.prepare("SELECT * FROM chat_threads ORDER BY id").all() as Record<string, unknown>[];
    expect(rows).toEqual([
      { ...threadRow("a1", "new"), key_owner: "k-new", name: "c2.n", history_json: "c2.h", display_json: "c2.d" },
      threadRow("a2", "old"),
      threadRow("b1", "bob"),
    ]);
  });
});
