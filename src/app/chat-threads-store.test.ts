// src/app/chat-threads-store.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import {
  loadThreads, saveThread, deleteThread, deleteOwnerThreads, expireThreads,
  __resetChatThreadsHealForTests,
} from "./chat-threads-store";
import { TABLE_NAMES, type SqlStmt } from "./turso-schema";
import { generateChatKey } from "./chat-crypto";
import type { ChatIdentity } from "./chat-thread-codec";
import type { ChatThread } from "./chat-threads";

const pipe = runTursoPipeline as unknown as ReturnType<typeof vi.fn>;
const cfg = { httpUrl: "https://db.example", authToken: "t" } as never;
const th: ChatThread = {
  id: "t1",
  projectId: "p",
  ownerId: null,
  name: "Q1 budget",
  createdAt: "c",
  updatedAt: "u",
  history: [{ role: "user", content: "hi" }],
  display: [{ kind: "user", text: "hi" }],
};

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

let alice: ChatIdentity;
let spkiB64: string;
beforeAll(async () => {
  alice = { ownerId: "alice", chatKey: await generateChatKey() };
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  spkiB64 = bytesToB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey)));
});

beforeEach(() => {
  pipe.mockReset();
  pipe.mockResolvedValue([]);
  __resetChatThreadsHealForTests();
});

const lastStmts = (): SqlStmt[] => pipe.mock.calls.at(-1)![1] as SqlStmt[];
const values = (s: SqlStmt | undefined): string[] => (s?.args ?? []).map((a) => a.value as string);

const ROW_COLS = ["id", "project_id", "owner_id", "name", "created_at", "updated_at", "history_json", "display_json", "key_owner", "key_operator"];
function selectResult(rows: string[][]) {
  return {
    type: "ok",
    response: { type: "execute", result: { cols: ROW_COLS.map((name) => ({ name })), rows: rows.map((r) => r.map((value) => ({ value }))) } },
  };
}

describe("chat-threads-store", () => {
  it("chat_threads is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("chat_threads");
  });

  it("saveThread prepends DDL, upserts an owned encrypted row atomically, and prunes the owner's group", async () => {
    await saveThread(cfg, th, alice, spkiB64);
    const stmts = lastStmts();
    expect(stmts.some((s) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);

    const insert = stmts.find((s) => /^INSERT INTO chat_threads .* ON CONFLICT\(id\) DO UPDATE SET /i.test(s.sql));
    expect(insert).toBeTruthy();
    const v = values(insert);
    expect(v.slice(0, 3)).toEqual(["t1", "p", "alice"]);
    expect(JSON.stringify(v)).not.toContain("Q1 budget");
    expect(JSON.stringify(v)).not.toContain("hi");

    const prune = stmts.find((s) => /^DELETE FROM chat_threads WHERE project_id = \? AND owner_id = \? AND id NOT IN/i.test(s.sql));
    expect(prune).toBeTruthy();
    expect(values(prune)).toEqual(["p", "alice", "p", "alice", "50"]);
  });

  it("saveThread emits no standalone row-delete — the upsert must be one atomic statement", async () => {
    await saveThread(cfg, th, alice, spkiB64);
    expect(lastStmts().some((s) => /^DELETE FROM chat_threads WHERE id = \?$/i.test(s.sql))).toBe(false);
  });

  it("saveThread refuses without an identity or a recovery key and writes nothing", async () => {
    await expect(saveThread(cfg, th, null, spkiB64)).rejects.toThrow();
    await expect(saveThread(cfg, th, alice, null)).rejects.toThrow();
    await expect(saveThread(cfg, th, alice, "")).rejects.toThrow();
    expect(pipe).not.toHaveBeenCalled();
  });

  it("deleteThread prepends DDL and deletes scoped by id, project AND owner (never id alone)", async () => {
    await deleteThread(cfg, "t1", "p", "alice");
    const stmts = lastStmts();
    expect(stmts.some((s) => /CREATE TABLE IF NOT EXISTS chat_threads/i.test(s.sql))).toBe(true);
    const del = stmts.find((s) => /^DELETE FROM chat_threads WHERE id = \? AND project_id = \? AND \(owner_id = \? OR owner_id IS NULL OR owner_id = ''\)$/i.test(s.sql));
    expect(del).toBeTruthy();
    expect(values(del)).toEqual(["t1", "p", "alice"]);
  });

  it("deleteThread refuses without an owner and writes nothing", async () => {
    await expect(deleteThread(cfg, "t1", "p", null)).rejects.toThrow();
    await expect(deleteThread(cfg, "t1", "p", "")).rejects.toThrow();
    expect(pipe).not.toHaveBeenCalled();
  });

  it("deleteOwnerThreads deletes every row of one owner", async () => {
    await deleteOwnerThreads(cfg, "alice");
    const del = lastStmts().find((s) => /^DELETE FROM chat_threads WHERE owner_id = \?$/i.test(s.sql));
    expect(values(del)).toEqual(["alice"]);
  });

  it("expireThreads deletes by cutoff, optionally scoped to a project", async () => {
    await expireThreads(cfg, "2026-10-01T00:00:00.000Z");
    const all = lastStmts().find((s) => /^DELETE FROM chat_threads WHERE/i.test(s.sql));
    expect(values(all)).toEqual(["2026-10-01T00:00:00.000Z"]);
    await expireThreads(cfg, "2026-10-01T00:00:00.000Z", "p");
    const scoped = lastStmts().find((s) => /^DELETE FROM chat_threads WHERE/i.test(s.sql));
    expect(values(scoped)).toEqual(["2026-10-01T00:00:00.000Z", "p"]);
  });

  it("loadThreads selects the owner's and legacy rows newest-first and decodes them", async () => {
    pipe.mockImplementation(async (_c: unknown, stmts: SqlStmt[]) =>
      stmts.some((s) => /^SELECT \* FROM chat_threads/.test(s.sql))
        ? [{ type: "ok" }, selectResult([
          ["t2", "p", "", "Later", "c2", "u2", "[]", "[]", "", ""],
          ["t1", "p", "", "Earlier", "c1", "u1", JSON.stringify(th.history), JSON.stringify(th.display), "", ""],
        ])]
        : []);
    const out = await loadThreads(cfg, "p", alice);
    const select = lastStmts().find((s) => /SELECT \* FROM chat_threads/i.test(s.sql))!;
    expect(select.sql).toMatch(/WHERE project_id = \? AND \(owner_id = \? OR owner_id IS NULL OR owner_id = ''\) ORDER BY updated_at DESC/i);
    expect(values(select)).toEqual(["p", "alice"]);
    expect(out).toEqual([
      { id: "t2", projectId: "p", ownerId: null, name: "Later", createdAt: "c2", updatedAt: "u2", history: [], display: [] },
      { id: "t1", projectId: "p", ownerId: null, name: "Earlier", createdAt: "c1", updatedAt: "u1", history: th.history, display: th.display },
    ]);
  });

  it("loadThreads with no identity selects legacy rows only", async () => {
    await loadThreads(cfg, "p", null);
    const select = lastStmts().find((s) => /SELECT \* FROM chat_threads/i.test(s.sql))!;
    expect(select.sql).toMatch(/WHERE project_id = \? AND \(owner_id IS NULL OR owner_id = ''\)/i);
    expect(values(select)).toEqual(["p"]);
  });

  it("a malformed legacy JSON column falls back to []", async () => {
    pipe.mockImplementation(async (_c: unknown, stmts: SqlStmt[]) =>
      stmts.some((s) => /^SELECT \* FROM chat_threads/.test(s.sql))
        ? [{ type: "ok" }, selectResult([["t1", "p", "", "N", "c", "u", "not json", "[]", "", ""]])]
        : []);
    const out = await loadThreads(cfg, "p", null);
    expect(out[0].history).toEqual([]);
    expect(out[0].display).toEqual([]);
  });

  describe("heal", () => {
    const OLD_PRAGMA = {
      type: "ok",
      response: {
        type: "execute",
        result: {
          cols: [{ name: "cid" }, { name: "name" }],
          rows: ["id", "project_id", "name", "created_at", "updated_at", "history_json", "display_json"]
            .map((n, i) => [{ value: String(i) }, { value: n }]),
        },
      },
    };
    const isPragma = (stmts: SqlStmt[]) => stmts.some((s) => /^PRAGMA table_info\("chat_threads"\)$/.test(s.sql));

    it("adds the missing columns in one transaction, once per database", async () => {
      pipe.mockImplementation(async (_c: unknown, stmts: SqlStmt[]) => (isPragma(stmts) ? [{ type: "ok" }, OLD_PRAGMA] : []));
      await deleteThread(cfg, "t1", "p", "alice");
      await deleteThread(cfg, "t2", "p", "alice");
      const calls = pipe.mock.calls.map((c) => c[1] as SqlStmt[]);
      expect(calls.filter(isPragma)).toHaveLength(1);
      const alter = calls.find((s) => s[0]?.sql === "BEGIN")!;
      expect(alter.map((s) => s.sql)).toEqual([
        "BEGIN",
        `ALTER TABLE "chat_threads" ADD COLUMN "owner_id" TEXT`,
        `ALTER TABLE "chat_threads" ADD COLUMN "key_owner" TEXT`,
        `ALTER TABLE "chat_threads" ADD COLUMN "key_operator" TEXT`,
        "COMMIT",
      ]);
      // The PRAGMA runs after the DDL, so a brand-new table exists before it is inspected.
      const pragmaCall = calls.find(isPragma)!;
      expect(pragmaCall[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_threads/);
    });

    it("runs again for a different database", async () => {
      await deleteThread(cfg, "t1", "p", "alice");
      await deleteThread({ httpUrl: "https://other.example", authToken: "t" } as never, "t1", "p", "alice");
      expect(pipe.mock.calls.map((c) => c[1] as SqlStmt[]).filter(isPragma)).toHaveLength(2);
    });

    it("a failed heal is not remembered: the call fails and the next one retries", async () => {
      pipe.mockRejectedValueOnce(new Error("network down"));
      await expect(deleteThread(cfg, "t1", "p", "alice")).rejects.toThrow("network down");
      await deleteThread(cfg, "t1", "p", "alice");
      expect(pipe.mock.calls.map((c) => c[1] as SqlStmt[]).filter(isPragma)).toHaveLength(2);
    });
  });
});
