// src/app/chat-passphrase.test.ts — opening your chats on another browser. A real SQLite engine
// (`node:sqlite`) plays the Turso database both "browsers" share; the vault is the real one over
// fake IndexedDB, and a second browser is simulated by clearing this browser's localStorage.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

const server = vi.hoisted(() => ({
  db: null as unknown as import("node:sqlite").DatabaseSync,
  log: [] as { sql: string; args?: { type: string; value?: string }[] }[][],
}));

vi.mock("./turso-pipeline", () => ({
  runTursoPipeline: vi.fn(async (_config: unknown, stmts: SqlStmt[]) => execute(stmts)),
}));

import {
  setChatPassphrase, removeChatPassphrase, unlockWithPassphrase, normaliseUnlockCode,
  UNLOCK_CODE_ALPHABET, MIN_CHAT_PASSPHRASE_LENGTH, ChatPassphraseError,
} from "./chat-passphrase";
import { ensureChatIdentity, getChatIdentity } from "./chat-key-vault";
import { loadThreads, saveThread, __resetChatThreadsHealForTests } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import type { ChatIdentity } from "./chat-thread-codec";

const URL = "https://db.example";
const cfg = { httpUrl: URL, authToken: "t" } as never;
const PASS = "correct horse battery";

function bind(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function one(s: SqlStmt): PipelineResultLike {
  const stmt = server.db.prepare(s.sql);
  const args = (s.args ?? []).map(bind);
  if (/^\s*(SELECT|PRAGMA)\b/i.test(s.sql)) {
    const rows = stmt.all(...args) as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
    return {
      type: "ok",
      response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } },
    };
  }
  const changes = Number(stmt.run(...args).changes);
  return { type: "ok", response: { type: "execute", result: { cols: [], rows: [], affected_row_count: changes } } };
}

/** The server: a BEGIN…COMMIT list runs atomically (rolled back on any error); any other list runs
 *  statement by statement and throws on the first error, as `runTursoPipeline` does. */
function execute(stmts: SqlStmt[]): PipelineResultLike[] {
  server.log.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
  const tx = /^\s*BEGIN\b/i.test(stmts[0]?.sql ?? "") && /^\s*COMMIT\b/i.test(stmts.at(-1)?.sql ?? "");
  const out: PipelineResultLike[] = [];
  try {
    for (const s of stmts) out.push(one(s));
  } catch (e) {
    if (tx && server.db.isTransaction) server.db.exec("ROLLBACK");
    throw new Error(`Turso error: ${(e as Error).message}`);
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

let spki: string;
beforeAll(async () => {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  spki = bytesToB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey)));
});

beforeEach(() => {
  server.db = new DatabaseSync(":memory:");
  server.log = [];
  window.localStorage.clear();
  __resetChatThreadsHealForTests();
});

function thread(id: string, name: string): ChatThread {
  return {
    id, projectId: "p", ownerId: null, name, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    history: [{ role: "user", content: name }], display: [{ kind: "user", text: name }],
  };
}

/** Browser A: an identity, one saved thread, a passphrase. Returns A's identity and unlock code. */
async function browserA(): Promise<{ a: ChatIdentity; code: string }> {
  const a = (await ensureChatIdentity(URL))!;
  await saveThread(cfg, thread("ta", "From A"), a, spki);
  const { unlockCode } = await setChatPassphrase(cfg, a, PASS);
  return { a, code: unlockCode };
}

/** Switch to browser B: a fresh localStorage, its own identity and one saved thread. */
async function browserB(): Promise<ChatIdentity> {
  window.localStorage.clear();
  const b = (await ensureChatIdentity(URL))!;
  await saveThread(cfg, thread("tb", "From B"), b, spki);
  return b;
}

const keyStatements = (from: number): { sql: string; args?: { value?: string }[] }[] =>
  server.log.slice(from).flat().filter((s) => /\bchat_keys\b/.test(s.sql) && !/^\s*CREATE\b/i.test(s.sql));

describe("chat passphrase", () => {
  it("an unlock code is 8 characters from the unambiguous alphabet", async () => {
    const { code } = await browserA();
    expect(code).toHaveLength(8);
    for (const ch of code) expect(UNLOCK_CODE_ALPHABET).toContain(ch);
    expect(UNLOCK_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  });

  it("set on one browser, unlock on another: the same owner id, its threads open, and the second browser's own threads move over and still open", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    expect(b.ownerId).not.toBe(a.ownerId);

    const result = await unlockWithPassphrase(cfg, URL, code, PASS);
    expect(result).toEqual({ outcome: "adopted", moved: 1, skipped: 0 });

    const now = (await getChatIdentity(URL))!;
    expect(now.ownerId).toBe(a.ownerId);
    expect(Array.from(now.chatKey)).toEqual(Array.from(a.chatKey));
    const loaded = await loadThreads(cfg, "p", now);
    expect(loaded.map((t) => t.name).sort()).toEqual(["From A", "From B"]);
    expect(loaded.every((t) => t.ownerId === a.ownerId)).toBe(true);
  });

  it("the move keeps the encrypted payloads and the operator wrap, and runs as one transaction", async () => {
    const { code } = await browserA();
    await browserB();
    const before = server.db.prepare("SELECT name, history_json, display_json, key_operator FROM chat_threads WHERE id = 'tb'").get();
    const from = server.log.length;
    await unlockWithPassphrase(cfg, URL, code, PASS);
    const after = server.db.prepare("SELECT name, history_json, display_json, key_operator FROM chat_threads WHERE id = 'tb'").get();
    expect(after).toEqual(before);
    const updates = server.log.slice(from).filter((list) => list.some((s) => /^\s*UPDATE chat_threads\b/i.test(s.sql)));
    expect(updates).toHaveLength(1);
    expect(updates[0][0].sql).toMatch(/^BEGIN/);
    expect(updates[0].at(-1)!.sql).toMatch(/^COMMIT/);
  });

  it("a thread whose owner wrap will not open is left with the old owner and counted", async () => {
    const { code } = await browserA();
    const b = await browserB();
    await saveThread(cfg, thread("tb2", "Broken"), b, spki);
    server.db.prepare("UPDATE chat_threads SET key_owner = 'c1.AAAA.AAAA' WHERE id = 'tb2'").run();
    const result = await unlockWithPassphrase(cfg, URL, code, PASS);
    expect(result).toEqual({ outcome: "adopted", moved: 1, skipped: 1 });
    expect(server.db.prepare("SELECT owner_id FROM chat_threads WHERE id = 'tb2'").get()).toEqual({ owner_id: b.ownerId });
  });

  it("a wrong passphrase answers \"wrong\" and changes nothing", async () => {
    const { code } = await browserA();
    const b = await browserB();
    const rows = server.db.prepare("SELECT * FROM chat_threads ORDER BY id").all();
    expect(await unlockWithPassphrase(cfg, URL, code, "not the passphrase")).toEqual({ outcome: "wrong" });
    expect((await getChatIdentity(URL))!.ownerId).toBe(b.ownerId);
    expect(server.db.prepare("SELECT * FROM chat_threads ORDER BY id").all()).toEqual(rows);
  });

  it("an unknown or malformed code answers \"unknown-code\" and changes nothing", async () => {
    await browserA();
    const b = await browserB();
    expect(await unlockWithPassphrase(cfg, URL, "ZZZZ-ZZZZ", PASS)).toEqual({ outcome: "unknown-code" });
    expect(await unlockWithPassphrase(cfg, URL, "short", PASS)).toEqual({ outcome: "unknown-code" });
    expect((await getChatIdentity(URL))!.ownerId).toBe(b.ownerId);
  });

  it("the typed code is read case-insensitively, without spaces or hyphens", async () => {
    const { a, code } = await browserA();
    await browserB();
    const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    expect(normaliseUnlockCode(typed)).toBe(code);
    expect(await unlockWithPassphrase(cfg, URL, typed, PASS)).toMatchObject({ outcome: "adopted" });
    expect((await getChatIdentity(URL))!.ownerId).toBe(a.ownerId);
  });

  it("an unlock reads exactly one chat_keys row, by its code, and writes none", async () => {
    const { code } = await browserA();
    await browserB();
    const from = server.log.length;
    await unlockWithPassphrase(cfg, URL, code, PASS);
    const touched = keyStatements(from);
    expect(touched).toHaveLength(1);
    expect(touched[0].sql).toMatch(/^SELECT .+ FROM chat_keys WHERE unlock_code = \?$/);
    expect(touched[0].args?.map((x) => x.value)).toEqual([code]);
  });

  it("a passphrase shorter than 12 characters is refused before anything is sent", async () => {
    const a = (await ensureChatIdentity(URL))!;
    const from = server.log.length;
    await expect(setChatPassphrase(cfg, a, "x".repeat(MIN_CHAT_PASSPHRASE_LENGTH - 1))).rejects.toBeInstanceOf(ChatPassphraseError);
    expect(server.log.length).toBe(from);
  });

  it("setting again replaces the row with a new code; the old code no longer opens", async () => {
    const { a, code } = await browserA();
    const { unlockCode: second } = await setChatPassphrase(cfg, a, "another long passphrase", { newCode: () => "NEWCODE2" });
    expect(second).toBe("NEWCODE2");
    expect(server.db.prepare("SELECT owner_id, unlock_code FROM chat_keys").all()).toEqual([{ owner_id: a.ownerId, unlock_code: "NEWCODE2" }]);
    expect(code).not.toBe(second);
    await browserB();
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "unknown-code" });
  });

  it("a code clash is retried, and five clashes in a row fail", async () => {
    await browserA();
    const taken = (server.db.prepare("SELECT unlock_code FROM chat_keys").get() as { unlock_code: string }).unlock_code;
    const b = await browserB();
    const codes = [taken, taken, "FRESHONE"];
    const { unlockCode } = await setChatPassphrase(cfg, b, PASS, { newCode: () => codes.shift()! });
    expect(unlockCode).toBe("FRESHONE");
    window.localStorage.clear();
    const c = (await ensureChatIdentity(URL))!;
    let calls = 0;
    await expect(setChatPassphrase(cfg, c, PASS, { newCode: () => { calls += 1; return taken; } }))
      .rejects.toBeInstanceOf(ChatPassphraseError);
    expect(calls).toBe(5);
  });

  it("remove deletes only the caller's own row; its code then answers \"unknown-code\"", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    await setChatPassphrase(cfg, b, PASS);
    await removeChatPassphrase(cfg, a.ownerId);
    expect(server.db.prepare("SELECT owner_id FROM chat_keys").all()).toEqual([{ owner_id: b.ownerId }]);
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "unknown-code" });
  });

  it("a browser without an identity adopts without moving anything", async () => {
    const { a, code } = await browserA();
    window.localStorage.clear();
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 0, skipped: 0 });
    expect((await getChatIdentity(URL))!.ownerId).toBe(a.ownerId);
  });
});
