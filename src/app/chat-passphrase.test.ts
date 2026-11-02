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
  /** When set, the next statement list it matches fails (once), as a dropped connection would. */
  failNext: null as null | ((stmts: SqlStmt[]) => boolean),
}));

vi.mock("./turso-pipeline", () => ({
  runTursoPipeline: vi.fn(async (_config: unknown, stmts: SqlStmt[]) => execute(stmts)),
}));

import {
  setChatPassphrase, removeChatPassphrase, unlockWithPassphrase, normaliseUnlockCode,
  UNLOCK_CODE_ALPHABET, MIN_CHAT_PASSPHRASE_LENGTH, ChatPassphraseError,
} from "./chat-passphrase";
import { ensureChatIdentity, getChatIdentity, storedChatOwnerIds } from "./chat-key-vault";
import { runTursoPipeline } from "./turso-pipeline";
import { readDiagLog } from "./diagnostics";
import { loadThreads, saveThread, __resetChatThreadsHealForTests } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import { threadFieldAd, type ChatIdentity } from "./chat-thread-codec";
import { openText, unwrapForOperator, wrapForOperator } from "./chat-crypto";

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
  if (server.failNext?.(stmts)) {
    server.failNext = null;
    throw new Error("Turso error: connection dropped");
  }
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
let operatorKey: CryptoKey;
beforeAll(async () => {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  spki = bytesToB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey)));
  operatorKey = pair.privateKey;
});

/** An unbound "c1." envelope (AES-GCM without additional data): not a format the app accepts. */
async function sealC1(key: Uint8Array, plaintext: string): Promise<string> {
  const aes = await globalThis.crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(plaintext)));
  return `c1.${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

beforeEach(() => {
  server.db = new DatabaseSync(":memory:");
  server.log = [];
  server.failNext = null;
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

  it("the move re-seals the fields for the new owner, keeps the operator wrap, and runs as one transaction", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    type Row = { name: string; history_json: string; display_json: string; key_operator: string };
    const read = () => server.db.prepare("SELECT name, history_json, display_json, key_operator FROM chat_threads WHERE id = 'tb'").get() as Row;
    const before = read();
    const from = server.log.length;
    await unlockWithPassphrase(cfg, URL, code, PASS);
    const after = read();
    expect(after.key_operator).toBe(before.key_operator);
    expect(after.name).not.toBe(before.name);
    expect(after.name.startsWith("c2.")).toBe(true);
    // The operator still opens it, under the new owner's binding only.
    const threadKey = await unwrapForOperator(operatorKey, after.key_operator);
    expect(await openText(threadKey, after.name, threadFieldAd("tb", "p", a.ownerId, "name"))).toBe("From B");
    await expect(openText(threadKey, after.name, threadFieldAd("tb", "p", b.ownerId, "name"))).rejects.toThrow();
    const updates = server.log.slice(from).filter((list) => list.some((s) => /^\s*UPDATE chat_threads\b/i.test(s.sql)));
    expect(updates).toHaveLength(1);
    expect(updates[0][0].sql).toMatch(/^BEGIN/);
    expect(updates[0].at(-1)!.sql).toMatch(/^COMMIT/);
  });

  it("a row sealed in unbound c1 envelopes is not moved and is counted as skipped", async () => {
    const { code } = await browserA();
    const b = await browserB();
    const threadKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
    server.db.prepare(
      "INSERT INTO chat_threads (id, project_id, owner_id, name, created_at, updated_at, history_json, display_json, key_owner, key_operator) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "told", "p", b.ownerId, await sealC1(threadKey, "Old one"), "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z",
      await sealC1(threadKey, JSON.stringify([{ role: "user", content: "x" }])), await sealC1(threadKey, "[]"),
      await sealC1(b.chatKey, bytesToB64(threadKey)), await wrapForOperator(spki, threadKey),
    );
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 1, skipped: 1 });
    const loaded = await loadThreads(cfg, "p", (await getChatIdentity(URL))!);
    expect(loaded.map((t) => t.name).sort()).toEqual(["From A", "From B"]);
    expect(server.db.prepare("SELECT owner_id FROM chat_threads WHERE id = 'told'").get()).toEqual({ owner_id: b.ownerId });
  });

  it("a thread whose owner wrap will not open is left with the old owner and counted", async () => {
    const { code } = await browserA();
    const b = await browserB();
    await saveThread(cfg, thread("tb2", "Broken"), b, spki);
    server.db.prepare("UPDATE chat_threads SET key_owner = 'c2.AAAA.AAAA' WHERE id = 'tb2'").run();
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

  it("an unlock reads exactly one chat_keys row, by its code, and then deletes only the replaced owner's row", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    const { unlockCode: codeB } = await setChatPassphrase(cfg, b, "another long passphrase");
    const from = server.log.length;
    await unlockWithPassphrase(cfg, URL, code, PASS);
    const touched = keyStatements(from);
    expect(touched).toHaveLength(2);
    expect(touched[0].sql).toMatch(/^SELECT .+ FROM chat_keys WHERE unlock_code = \?$/);
    expect(touched[0].args?.map((x) => x.value)).toEqual([code]);
    expect(touched[1].sql).toBe("DELETE FROM chat_keys WHERE owner_id = ?");
    expect(touched[1].args?.map((x) => x.value)).toEqual([b.ownerId]);
    // The adopted owner's row stays; the replaced owner's code no longer opens anything.
    expect(server.db.prepare("SELECT owner_id FROM chat_keys").all()).toEqual([{ owner_id: a.ownerId }]);
    window.localStorage.clear();
    expect(await unlockWithPassphrase(cfg, URL, codeB, "another long passphrase")).toEqual({ outcome: "unknown-code" });
  });

  it("a failed delete of the replaced owner's row is logged by code only and keeps the adoption", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    const pipeline = vi.mocked(runTursoPipeline);
    pipeline.mockImplementation(async (_config: unknown, stmts: SqlStmt[]) => {
      if (stmts.some((s) => /^DELETE FROM chat_keys/.test(s.sql))) throw new Error(`boom ${b.ownerId}`);
      return execute(stmts);
    });
    try {
      expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toMatchObject({ outcome: "adopted" });
    } finally {
      pipeline.mockImplementation(async (_config: unknown, stmts: SqlStmt[]) => execute(stmts));
    }
    expect((await getChatIdentity(URL))!.ownerId).toBe(a.ownerId);
    const logged = readDiagLog().filter((e) => e.code === "chat.replacedKeyDeleteFailed");
    expect(logged).toHaveLength(1);
    expect(logged[0].fields).toBeUndefined();
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

  it("the adopted identity is stored before the move; a failed move keeps the old rows and is finished by unlocking again", async () => {
    const { a, code } = await browserA();
    const b = await browserB();
    await setChatPassphrase(cfg, b, PASS);
    server.failNext = (stmts) => /^BEGIN/.test(stmts[0]?.sql ?? "") && stmts.some((s) => /^UPDATE chat_threads\b/.test(s.sql));
    await expect(unlockWithPassphrase(cfg, URL, code, PASS)).rejects.toThrow();
    expect((await getChatIdentity(URL))!.ownerId).toBe(a.ownerId);
    expect(server.db.prepare("SELECT owner_id FROM chat_threads WHERE id = 'tb'").get()).toEqual({ owner_id: b.ownerId });
    // The old owner id is kept, so a delete-all can still erase its rows.
    expect(storedChatOwnerIds(URL)).toEqual([a.ownerId, b.ownerId]);
    // Its passphrase row is not deleted before its threads have moved.
    const keyOwners = () => (server.db.prepare("SELECT owner_id FROM chat_keys").all() as { owner_id: string }[]).map((r) => r.owner_id).sort();
    expect(keyOwners()).toEqual([a.ownerId, b.ownerId].sort());

    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 1, skipped: 0 });
    expect(server.db.prepare("SELECT owner_id FROM chat_threads WHERE id = 'tb'").get()).toEqual({ owner_id: a.ownerId });
    const loaded = await loadThreads(cfg, "p", (await getChatIdentity(URL))!);
    expect(loaded.map((t) => t.name).sort()).toEqual(["From A", "From B"]);
    expect(keyOwners()).toEqual([a.ownerId]);
    // Finished: a third unlock has nothing left to move.
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 0, skipped: 0 });
  });

  it("an unlock over a locked identity keeps the locked owner id for a later delete-all", async () => {
    const { a, code } = await browserA();
    const sealed = { iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
    window.localStorage.setItem("aipm-cockpit:chat-identity", JSON.stringify({ [URL]: { ownerId: "o-locked", sealed } }));
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 0, skipped: 0 });
    expect(storedChatOwnerIds(URL)).toEqual([a.ownerId, "o-locked"]);
  });

  it("a browser without an identity adopts without moving anything", async () => {
    const { a, code } = await browserA();
    window.localStorage.clear();
    expect(await unlockWithPassphrase(cfg, URL, code, PASS)).toEqual({ outcome: "adopted", moved: 0, skipped: 0 });
    expect((await getChatIdentity(URL))!.ownerId).toBe(a.ownerId);
  });
});
