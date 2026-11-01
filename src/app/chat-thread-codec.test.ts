// src/app/chat-thread-codec.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encodeThreadRow, decodeThreadRows, type ChatIdentity } from "./chat-thread-codec";
import { generateChatKey, unwrapForOperator } from "./chat-crypto";
import type { StoredThreadRow } from "./chat-threads-schema";
import type { ChatThread } from "./chat-threads";
import type { PipelineResultLike } from "./turso-schema";

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const ROW_COLS: (keyof StoredThreadRow)[] = [
  "id", "project_id", "owner_id", "name", "created_at", "updated_at",
  "history_json", "display_json", "key_owner", "key_operator",
];

function asResult(rows: StoredThreadRow[]): PipelineResultLike {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: ROW_COLS.map((name) => ({ name })),
        rows: rows.map((r) => ROW_COLS.map((c) => ({ value: r[c] }))),
      },
    },
  };
}

const PROMPT = "What is the Q1 budget for the Falcon programme?";
const REPLY = "The Falcon Q1 budget is 120k.";
const NAME = "Falcon budget question";

const thread: ChatThread = {
  id: "t1",
  projectId: "p1",
  ownerId: null,
  name: NAME,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  history: [
    {
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAABBBB" } },
      ],
    },
    { role: "assistant", content: REPLY },
  ],
  display: [{ kind: "user", text: PROMPT }, { kind: "assistant", text: REPLY }],
} as ChatThread;

let spkiB64: string;
let privateKey: CryptoKey;
let alice: ChatIdentity;
let bob: ChatIdentity;

beforeAll(async () => {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  spkiB64 = bytesToB64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey)));
  privateKey = pair.privateKey;
  alice = { ownerId: "alice", chatKey: await generateChatKey() };
  bob = { ownerId: "bob", chatKey: await generateChatKey() };
});

describe("encodeThreadRow / decodeThreadRows", () => {
  it("round-trips a thread for the same identity, attachments stripped and owner set", async () => {
    const row = await encodeThreadRow(thread, alice, spkiB64);
    const [out] = await decodeThreadRows(asResult([row]), alice);
    expect(out).toEqual({
      ...thread,
      ownerId: "alice",
      history: [
        { role: "user", content: [{ type: "text", text: PROMPT }, { type: "text", text: "[attachment: image]" }] },
        { role: "assistant", content: REPLY },
      ],
    });
  });

  it("stores the row owned and encrypted: no prompt, reply or name in any column", async () => {
    const row = await encodeThreadRow(thread, alice, spkiB64);
    expect(row.owner_id).toBe("alice");
    expect(row.id).toBe("t1");
    expect(row.project_id).toBe("p1");
    expect(row.updated_at).toBe(thread.updatedAt);
    const all = JSON.stringify(row);
    for (const secret of [PROMPT, REPLY, NAME, "Falcon"]) expect(all).not.toContain(secret);
    expect(row.name.startsWith("c1.")).toBe(true);
    expect(row.history_json.startsWith("c1.")).toBe(true);
    expect(row.display_json.startsWith("c1.")).toBe(true);
    expect(row.key_owner.startsWith("c1.")).toBe(true);
    expect(row.key_operator.startsWith("r1.")).toBe(true);
  });

  it("uses a fresh thread key on every write, and the operator copy opens the same key", async () => {
    const a = await encodeThreadRow(thread, alice, spkiB64);
    const b = await encodeThreadRow(thread, alice, spkiB64);
    expect(a.key_owner).not.toBe(b.key_owner);
    const ka = await unwrapForOperator(privateKey, a.key_operator);
    const kb = await unwrapForOperator(privateKey, b.key_operator);
    expect(bytesToB64(ka)).not.toBe(bytesToB64(kb));
  });

  it("skips another person's row without throwing", async () => {
    const row = await encodeThreadRow(thread, alice, spkiB64);
    await expect(decodeThreadRows(asResult([row]), bob)).resolves.toEqual([]);
    await expect(decodeThreadRows(asResult([row]), null)).resolves.toEqual([]);
  });

  it("skips an owned row that fails to open (same owner id, wrong key)", async () => {
    const row = await encodeThreadRow(thread, alice, spkiB64);
    const impostor: ChatIdentity = { ownerId: "alice", chatKey: await generateChatKey() };
    await expect(decodeThreadRows(asResult([row]), impostor)).resolves.toEqual([]);
  });

  it("decodes a legacy plaintext row (owner NULL or empty) with ownerId null, for any identity", async () => {
    const legacy = (id: string, owner: string): StoredThreadRow => ({
      id, project_id: "p1", owner_id: owner, name: "Old chat", created_at: "c", updated_at: "u",
      history_json: JSON.stringify([{ role: "user", content: "hi" }]),
      display_json: JSON.stringify([{ kind: "user", text: "hi" }]),
      key_owner: "", key_operator: "",
    });
    const res = asResult([legacy("l1", ""), legacy("l2", "")]);
    // A NULL cell decodes to "" through rowObjects; pin that shape too.
    res.response!.result!.rows![1][2] = { value: null };
    for (const id of [alice, null]) {
      const out = await decodeThreadRows(res, id);
      expect(out.map((t) => [t.id, t.ownerId, t.name])).toEqual([["l1", null, "Old chat"], ["l2", null, "Old chat"]]);
      expect(out[0].history).toEqual([{ role: "user", content: "hi" }]);
    }
  });

  it("keeps legacy and own rows, drops others, in input order", async () => {
    const mine = await encodeThreadRow({ ...thread, id: "m" }, alice, spkiB64);
    const theirs = await encodeThreadRow({ ...thread, id: "x" }, bob, spkiB64);
    const legacy: StoredThreadRow = {
      id: "l", project_id: "p1", owner_id: "", name: "Old", created_at: "", updated_at: "",
      history_json: "[]", display_json: "[]", key_owner: "", key_operator: "",
    };
    const out = await decodeThreadRows(asResult([mine, theirs, legacy]), alice);
    expect(out.map((t) => t.id)).toEqual(["m", "l"]);
  });

  it("refuses to encode a thread owned by somebody else", async () => {
    await expect(encodeThreadRow({ ...thread, ownerId: "bob" }, alice, spkiB64)).rejects.toThrow();
  });
});
