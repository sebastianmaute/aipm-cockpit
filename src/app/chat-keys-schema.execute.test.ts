// src/app/chat-keys-schema.execute.test.ts — the chat_keys statement builders (and the adoption
// re-own UPDATE on chat_threads) EXECUTED against a real SQLite engine (`node:sqlite`), the way
// chat-threads-schema.execute.test.ts does. String-matching the SQL cannot show which rows change.
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CHAT_KEYS_DDL, upsertChatKeyStatements, deleteChatKeyStatements, chatKeyByCodeSelect,
  ownerThreadKeysSelect, reownThreadStatements, isUnlockCodeClash, type ChatKeyRow,
} from "./chat-keys-schema";
import { CHAT_THREADS_DDL, upsertThreadStatements, type StoredThreadRow } from "./chat-threads-schema";
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
    run(db, upsertThreadStatements(threadRow("a1", "old")));
    run(db, upsertThreadStatements({ ...threadRow("a2", "old"), project_id: "q" }));
    run(db, upsertThreadStatements(threadRow("b1", "bob")));
    const rows = query(db, ownerThreadKeysSelect("old")[0]);
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(rows[0]).toHaveProperty("key_owner");
    expect(() => ownerThreadKeysSelect("")).toThrow();
  });

  it("re-own moves one row from the old owner, keeping the payloads and key_operator", () => {
    run(db, upsertThreadStatements(threadRow("a1", "old")));
    run(db, upsertThreadStatements(threadRow("b1", "bob")));
    run(db, reownThreadStatements("a1", "old", "new", "k-new"));
    // A row that is no longer the old owner's is left alone.
    run(db, reownThreadStatements("b1", "old", "new", "k-new"));
    expect(db.prepare("SELECT * FROM chat_threads ORDER BY id").all()).toEqual([
      { ...threadRow("a1", "new"), key_owner: "k-new" },
      threadRow("b1", "bob"),
    ]);
  });
});
