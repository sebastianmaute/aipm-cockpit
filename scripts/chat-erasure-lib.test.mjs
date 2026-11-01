// scripts/chat-erasure-lib.test.mjs — the operator's erasure script against a FAKE Turso endpoint
// backed by a real SQLite engine (`node:sqlite`), with rows written by the app's own codec
// (`chat-thread-codec.ts`), so the script and the app are proven to share one format.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXIT, toHttpUrl, generateRecoveryKeyPair, importOperatorKey, unwrapOperatorKey, excerptAround,
  deleteStatements, expireStatements, writePrivateKeyFile, runCli, EXCERPT_MAX,
} from "./chat-erasure-lib.mjs";
import { encodeThreadRow } from "../src/app/chat-thread-codec";
import { generateChatKey, generateThreadKey, wrapForOperator } from "../src/app/chat-crypto";
import {
  CHAT_THREADS_DDL, expireThreadsStatements,
} from "../src/app/chat-threads-schema";
import { parseChatSettings, CHAT_RECOVERY_KEY_ENV } from "../src/app/ai-chat-retention-config";

const TOKEN = "secret-token-value";
const ENV = { CHAT_ERASURE_TURSO_URL: "libsql://db-org.turso.io", CHAT_ERASURE_TURSO_TOKEN: TOKEN };

// ── one 3072-bit operator key pair for the whole file (generation is slow) ──
const OPERATOR = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const OPERATOR_SPKI = Buffer.from(OPERATOR.publicKey).toString("base64");
const OPERATOR_PEM = OPERATOR.privateKey;
const OTHER = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const OTHER_SPKI = Buffer.from(OTHER.publicKey).toString("base64");

// ── fake Turso: /v2/pipeline over node:sqlite ──
function bindArg(arg) {
  if (!arg || arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer") return BigInt(arg.value);
  return arg.value;
}
function execStmt(db, stmt) {
  const args = (stmt.args ?? []).map(bindArg);
  if (/^\s*SELECT\b/i.test(stmt.sql)) {
    const rows = db.prepare(stmt.sql).all(...args);
    const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
    return {
      cols,
      rows: rows.map((r) => cols.map((c) => (r[c.name] == null ? { type: "null" } : { type: "text", value: String(r[c.name]) }))),
      affected_row_count: 0,
    };
  }
  if (!stmt.args || stmt.args.length === 0) {
    db.exec(stmt.sql);
    return { cols: [], rows: [], affected_row_count: 0 };
  }
  const info = db.prepare(stmt.sql).run(...args);
  return { cols: [], rows: [], affected_row_count: Number(info.changes) };
}
function evalCond(cond, ok) {
  if (!cond) return true;
  if (cond.type === "ok") return ok[cond.step] === true;
  if (cond.type === "not") return !evalCond(cond.cond, ok);
  throw new Error("unknown condition");
}
function makeFakeTurso(db, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (status !== 200) return { ok: false, status, text: async () => "boom" };
    const results = body.requests.map((req) => {
      if (req.type === "close") return { type: "ok", response: { type: "close" } };
      if (req.type === "execute") {
        try {
          return { type: "ok", response: { type: "execute", result: execStmt(db, req.stmt) } };
        } catch (e) {
          return { type: "error", error: { message: String(e.message) } };
        }
      }
      if (req.type === "batch") {
        const ok = [];
        const stepResults = [];
        const stepErrors = [];
        req.batch.steps.forEach((step, i) => {
          if (!evalCond(step.condition, ok)) { ok[i] = false; stepResults.push(null); stepErrors.push(null); return; }
          try {
            stepResults.push(execStmt(db, step.stmt));
            stepErrors.push(null);
            ok[i] = true;
          } catch (e) {
            stepResults.push(null);
            stepErrors.push({ message: String(e.message) });
            ok[i] = false;
          }
        });
        return { type: "ok", response: { type: "batch", result: { step_results: stepResults, step_errors: stepErrors } } };
      }
      return { type: "error", error: { message: "unknown request" } };
    });
    return { ok: true, status: 200, text: async () => JSON.stringify({ results }) };
  };
  return { fetchImpl, calls };
}

function insertRow(db, row) {
  db.prepare(
    `INSERT INTO chat_threads (id, project_id, owner_id, name, created_at, updated_at, history_json, display_json, key_owner, key_operator) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(row.id, row.project_id, row.owner_id, row.name, row.created_at, row.updated_at, row.history_json, row.display_json, row.key_owner, row.key_operator);
}

function thread(id, history, display = [], name = "Chat") {
  return { id, projectId: "p1", ownerId: null, name, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", history, display };
}

async function ownedRow(th, spki = OPERATOR_SPKI) {
  const identity = { ownerId: "owner-a", chatKey: await generateChatKey() };
  return encodeThreadRow(th, identity, spki);
}

function legacyRow(th) {
  return {
    id: th.id, project_id: th.projectId, owner_id: null, name: th.name, created_at: th.createdAt, updated_at: th.updatedAt,
    history_json: JSON.stringify(th.history), display_json: JSON.stringify(th.display), key_owner: null, key_operator: null,
  };
}

/** True when `text` holds a C0 or C1 control character (or DEL). */
function hasControl(text) {
  return [...text].some((ch) => {
    const c = ch.codePointAt(0);
    return c < 0x20 || (c >= 0x7f && c <= 0x9f);
  });
}

function ids(db) {
  return db.prepare("SELECT id FROM chat_threads ORDER BY id").all().map((r) => r.id);
}

let db;
let dir;
let keyPath;

function deps(fake, extra = {}) {
  const out = [];
  const err = [];
  return {
    out, err,
    deps: {
      env: ENV,
      fetchImpl: fake.fetchImpl,
      readTextFile: (p) => readFileSync(p, "utf8"),
      writePrivateKey: writePrivateKeyFile,
      isTTY: false,
      confirm: async () => "no",
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...extra,
    },
  };
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const sql of CHAT_THREADS_DDL) db.exec(sql);
  dir = mkdtempSync(join(tmpdir(), "chat-erasure-test-"));
  keyPath = join(dir, "operator.pem");
  writeFileSync(keyPath, OPERATOR_PEM);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("EXIT", () => {
  it("is 0 done, 1 found or refused, 2 could not run", () => {
    expect(EXIT).toEqual({ DONE: 0, FOUND: 1, UNUSABLE: 2 });
  });
});

describe("toHttpUrl", () => {
  it("turns libsql:// into https and keeps only the origin", () => {
    expect(toHttpUrl("libsql://db-org.turso.io")).toBe("https://db-org.turso.io");
    expect(toHttpUrl("https://user:pw@db.turso.io/path")).toBe("https://db.turso.io");
  });
  it("refuses plain http except loopback, and garbage", () => {
    expect(toHttpUrl("http://db.turso.io")).toBeNull();
    expect(toHttpUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(toHttpUrl("not a url")).toBeNull();
  });
});

describe("keygen", () => {
  it("prints a 3072-bit RSA-OAEP SPKI the app accepts, and a private key that opens what the app wraps", async () => {
    const pair = await generateRecoveryKeyPair();
    const pub = createPublicKey({ key: Buffer.from(pair.publicSpkiB64, "base64"), type: "spki", format: "der" });
    expect(pub.asymmetricKeyDetails?.modulusLength).toBe(3072);
    await expect(
      globalThis.crypto.subtle.importKey("spki", Buffer.from(pair.publicSpkiB64, "base64"), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]),
    ).resolves.toBeDefined();
    expect(parseChatSettings({ [CHAT_RECOVERY_KEY_ENV]: pair.publicSpkiB64 }).recoveryKey).toBe(pair.publicSpkiB64);
    expect(pair.privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/);

    const threadKey = await generateThreadKey();
    const wrapped = await wrapForOperator(pair.publicSpkiB64, threadKey);
    const priv = await importOperatorKey(pair.privatePem);
    expect(Array.from(await unwrapOperatorKey(priv, wrapped))).toEqual(Array.from(threadKey));
  }, 60_000);

  it("keygen --out writes the key with mode 0600 and prints the public key; refuses an existing file", async () => {
    const fake = makeFakeTurso(db);
    const out = join(dir, "new.pem");
    const a = deps(fake, { generateKeyPair: async () => ({ privatePem: OPERATOR_PEM, publicSpkiB64: OPERATOR_SPKI }) });
    expect(await runCli(["keygen", "--out", out], a.deps)).toBe(EXIT.DONE);
    expect(readFileSync(out, "utf8")).toBe(OPERATOR_PEM);
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(a.out.join("\n")).toContain(OPERATOR_SPKI);
    expect(a.out.join("\n")).not.toContain("PRIVATE KEY");

    const b = deps(fake, { generateKeyPair: async () => ({ privatePem: "other", publicSpkiB64: "x" }) });
    expect(await runCli(["keygen", "--out", out], b.deps)).toBe(EXIT.UNUSABLE);
    expect(readFileSync(out, "utf8")).toBe(OPERATOR_PEM);
  });

  it("keygen without --out cannot run", async () => {
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["keygen"], a.deps)).toBe(EXIT.UNUSABLE);
  });
});

describe("excerptAround", () => {
  it("stays within the limit and centres on the match, on one line", () => {
    const text = `${"a".repeat(200)}\nMüller said\n${"b".repeat(200)}`;
    const ex = excerptAround(text, "müller");
    expect(ex.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(ex).toContain("Müller said");
    expect(ex).not.toContain("\n");
  });
});

describe("search", () => {
  async function seed() {
    insertRow(db, await ownedRow(thread("t-owned-hit", [{ role: "user", content: "Please write to Erika Müller about the budget" }])));
    insertRow(db, await ownedRow(thread("t-owned-miss", [{ role: "user", content: "Nothing relevant here" }])));
    insertRow(db, legacyRow(thread("t-legacy-hit", [], [{ kind: "assistant", text: "I have told erika müller." }])));
    insertRow(db, legacyRow(thread("t-legacy-miss", [{ role: "user", content: "Unrelated" }])));
    insertRow(db, await ownedRow(thread("t-tool-hit", [{
      role: "assistant", content: [{ type: "tool_use", id: "u1", name: "create_task", input: { assignee: "Erika Müller" } }],
    }])));
  }

  it("finds the name in owned and legacy threads, case- and composition-insensitively, not in the others", async () => {
    await seed();
    const fake = makeFakeTurso(db);
    const a = deps(fake, { pageSize: 2 });
    // decomposed "u + combining diaeresis", upper case
    const code = await runCli(["search", "--key", keyPath, "ERIKA MÜLLER"], a.deps);
    expect(code).toBe(EXIT.FOUND);
    const text = a.out.join("\n");
    expect(text).toContain("t-owned-hit");
    expect(text).toContain("t-legacy-hit");
    expect(text).toContain("t-tool-hit");
    expect(text).not.toContain("t-owned-miss");
    expect(text).not.toContain("t-legacy-miss");
    expect(text).toContain("unreadable: 0");
    expect(text).toContain("3 matches");
    const hit = a.out.find((l) => l.startsWith("t-owned-hit"));
    expect(hit.split("\t")).toEqual(["t-owned-hit", "p1", "2026-10-20T00:00:00.000Z", expect.any(String)]);
    expect(hit.split("\t")[3].length).toBeLessThanOrEqual(EXCERPT_MAX);
    // read in pages, ordered by id, never the whole table at once
    const selects = fake.calls.flatMap((c) => c.body.requests).filter((r) => r.type === "execute" && /SELECT/.test(r.stmt.sql));
    expect(selects.length).toBeGreaterThanOrEqual(3);
    expect(selects[0].stmt.sql).toMatch(/WHERE id > \? ORDER BY id LIMIT \?$/);
    // credentials go in the header, never in output
    expect(fake.calls[0].url).toBe("https://db-org.turso.io/v2/pipeline");
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect([...a.out, ...a.err].join("\n")).not.toContain(TOKEN);
  }, 30_000);

  it("pages by id, so rows deleted between pages never make it skip a later row", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) {
      insertRow(db, legacyRow(thread(id, [{ role: "user", content: "about Erika Müller" }])));
    }
    const fake = makeFakeTurso(db);
    let pages = 0;
    const deletingBetweenPages = async (url, init) => {
      const res = await fake.fetchImpl(url, init);
      // Another operator (or the app) deletes the first page's rows right after it was read.
      if (JSON.parse(init.body).requests.some((r) => r.type === "execute" && /SELECT/.test(r.stmt.sql)) && ++pages === 1) {
        db.prepare("DELETE FROM chat_threads WHERE id IN ('a', 'b')").run();
      }
      return res;
    };
    const a = deps({ ...fake, fetchImpl: deletingBetweenPages }, { pageSize: 2 });
    expect(await runCli(["search", "--key", keyPath, "Erika"], a.deps)).toBe(EXIT.FOUND);
    const found = a.out.filter((l) => l.includes("\t")).map((l) => l.split("\t")[0]);
    expect(found).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("prints every field without control characters: no terminal escape from a stored row reaches the screen", async () => {
    const th = thread("t-\x1b[2Jid", [], [], "Erika \x1b[31mMüller\x1b]0;owned\x07 notes\x9b1m");
    insertRow(db, { ...legacyRow(th), project_id: "p\x1b[0m1", updated_at: "2026-10-20T00:00:00.000Z\x07" });
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["search", "--key", keyPath, "Erika"], a.deps)).toBe(EXIT.FOUND);
    const hit = a.out.find((l) => l.startsWith("t-"));
    expect(hit.split("\t")).toHaveLength(4);
    for (const field of hit.split("\t")) expect(hasControl(field)).toBe(false);
    expect(hit).toContain("Müller");
  });

  it("strips control characters from a Turso error before printing it", async () => {
    const turso = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ results: [{ type: "error", error: { message: "no such table \x1b]0;pwned\x07\x1b[31m" } }] }),
    });
    const a = deps({ fetchImpl: turso, calls: [] });
    expect(await runCli(["expire"], a.deps)).toBe(EXIT.UNUSABLE);
    expect(a.err.join("\n")).toContain("no such table");
    for (const line of a.err) expect(hasControl(line)).toBe(false);
  });

  it("searches a table from before the owner columns as legacy rows", async () => {
    db.exec("DROP TABLE chat_threads");
    db.exec("CREATE TABLE chat_threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, history_json TEXT, display_json TEXT)");
    const th = thread("t-old", [{ role: "user", content: "Erika Müller asked" }]);
    db.prepare("INSERT INTO chat_threads (id, project_id, name, created_at, updated_at, history_json, display_json) VALUES (?,?,?,?,?,?,?)")
      .run(th.id, th.projectId, th.name, th.createdAt, th.updatedAt, JSON.stringify(th.history), JSON.stringify(th.display));
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["search", "--key", keyPath, "Erika"], a.deps)).toBe(EXIT.FOUND);
    expect(a.out.some((l) => l.startsWith("t-old\t"))).toBe(true);
    expect(a.out.join("\n")).toContain("unreadable: 0");
  });

  it("prints 0 matches and exits 0 when every row was read and none matches", async () => {
    await seed();
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["search", "--key", keyPath, "Nobody Atall"], a.deps)).toBe(EXIT.DONE);
    expect(a.out.join("\n")).toContain("0 matches");
    expect(a.out.join("\n")).toContain("unreadable: 0");
  });

  it("counts rows wrapped for another key as unreadable, and never reports a clean 0 matches", async () => {
    insertRow(db, await ownedRow(thread("t-x1", [{ role: "user", content: "Erika Müller" }]), OTHER_SPKI));
    insertRow(db, await ownedRow(thread("t-x2", [{ role: "user", content: "something" }]), OTHER_SPKI));
    const a = deps(makeFakeTurso(db));
    const code = await runCli(["search", "--key", keyPath, "Müller"], a.deps);
    expect(code).toBe(EXIT.FOUND);
    const text = [...a.out, ...a.err].join("\n");
    expect(text).toContain("unreadable: 2");
    expect(text).not.toMatch(/^0 matches$/m);
  });

  it("counts a row whose fields were moved to another id, project, owner or field as unreadable", async () => {
    const row = await ownedRow(thread("t-orig", [{ role: "user", content: "Erika Müller" }], [{ kind: "user", text: "Erika Müller" }]));
    const search = async () => {
      const a = deps(makeFakeTurso(db));
      expect(await runCli(["search", "--key", keyPath, "Müller"], a.deps)).toBe(EXIT.FOUND);
      return a.out.join("\n");
    };
    // Control: the row as written opens and matches.
    insertRow(db, row);
    expect(await search()).toContain("unreadable: 0");
    // Each change alone, on a table holding only that row (the id is the primary key).
    const moved = [
      { ...row, id: "t-other" },
      { ...row, project_id: "p2" },
      { ...row, owner_id: "owner-b" },
      { ...row, display_json: row.history_json },
    ];
    for (const variant of moved) {
      db.exec("DELETE FROM chat_threads");
      insertRow(db, variant);
      const text = await search();
      expect(text).toContain("unreadable: 1");
      expect(text).not.toContain(`${variant.id}\t`);
    }
  });

  it("still opens a row an earlier release wrote (c1 envelopes, no additional data)", async () => {
    const threadKey = await generateThreadKey();
    const seal = async (text) => {
      const aes = await globalThis.crypto.subtle.importKey("raw", threadKey, "AES-GCM", false, ["encrypt"]);
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(text)));
      return `c1.${Buffer.from(iv).toString("base64")}.${Buffer.from(ct).toString("base64")}`;
    };
    const th = thread("t-c1", [{ role: "user", content: "Erika Müller" }]);
    insertRow(db, {
      id: th.id, project_id: th.projectId, owner_id: "owner-a", created_at: th.createdAt, updated_at: th.updatedAt,
      name: await seal(th.name), history_json: await seal(JSON.stringify(th.history)), display_json: await seal("[]"),
      key_owner: "c1.unused", key_operator: await wrapForOperator(OPERATOR_SPKI, threadKey),
    });
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["search", "--key", keyPath, "Müller"], a.deps)).toBe(EXIT.FOUND);
    expect(a.out.join("\n")).toContain("t-c1\t");
    expect(a.out.join("\n")).toContain("unreadable: 0");
  });

  it("counts an owned row without key_operator as unreadable", async () => {
    const row = await ownedRow(thread("t-nokey", [{ role: "user", content: "hi" }]));
    insertRow(db, { ...row, key_operator: "" });
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["search", "--key", keyPath, "hi"], a.deps)).toBe(EXIT.FOUND);
    expect(a.out.join("\n")).toContain("unreadable: 1");
  });

  it("cannot run without credentials, with a bad key file, or on a Turso HTTP error", async () => {
    const fake = makeFakeTurso(db);
    const noCreds = deps(fake, { env: {} });
    expect(await runCli(["search", "--key", keyPath, "x"], noCreds.deps)).toBe(EXIT.UNUSABLE);
    expect(fake.calls).toHaveLength(0);

    const noToken = deps(fake, { env: { CHAT_ERASURE_TURSO_URL: ENV.CHAT_ERASURE_TURSO_URL } });
    expect(await runCli(["search", "--key", keyPath, "x"], noToken.deps)).toBe(EXIT.UNUSABLE);

    writeFileSync(join(dir, "bad.pem"), "not a key");
    const badKey = deps(fake);
    expect(await runCli(["search", "--key", join(dir, "bad.pem"), "x"], badKey.deps)).toBe(EXIT.UNUSABLE);
    const missingKey = deps(fake);
    expect(await runCli(["search", "--key", join(dir, "nope.pem"), "x"], missingKey.deps)).toBe(EXIT.UNUSABLE);
    const noKeyFlag = deps(fake);
    expect(await runCli(["search", "x"], noKeyFlag.deps)).toBe(EXIT.UNUSABLE);

    const failing = makeFakeTurso(db, { status: 500 });
    const http = deps(failing);
    expect(await runCli(["search", "--key", keyPath, "x"], http.deps)).toBe(EXIT.UNUSABLE);
    expect([...http.out, ...http.err].join("\n")).not.toContain(TOKEN);
    expect([...http.out, ...http.err].join("\n")).not.toContain("db-org");
  });
});

describe("delete", () => {
  it("issues DELETE … WHERE id = ? per id inside BEGIN … COMMIT", () => {
    expect(deleteStatements(["a", "b", "a"])).toEqual([
      { sql: "BEGIN" },
      { sql: "DELETE FROM chat_threads WHERE id = ?", args: [{ type: "text", value: "a" }] },
      { sql: "DELETE FROM chat_threads WHERE id = ?", args: [{ type: "text", value: "b" }] },
      { sql: "COMMIT" },
    ]);
  });

  async function seedThree() {
    insertRow(db, legacyRow(thread("a", [{ role: "user", content: "Erika Müller" }])));
    insertRow(db, await ownedRow(thread("b", [{ role: "user", content: "erika müller" }])));
    insertRow(db, legacyRow(thread("c", [{ role: "user", content: "nobody" }])));
  }

  it("deletes the named ids with --yes, as one atomic batch", async () => {
    await seedThree();
    const fake = makeFakeTurso(db);
    const a = deps(fake);
    expect(await runCli(["delete", "a", "c", "--yes"], a.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["b"]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].body.requests[0].type).toBe("batch");
    expect(a.out.join("\n")).toContain("deleted: 2");
  });

  it("refuses without a TTY and without --yes, deleting nothing", async () => {
    await seedThree();
    const fake = makeFakeTurso(db);
    const a = deps(fake);
    expect(await runCli(["delete", "a"], a.deps)).toBe(EXIT.FOUND);
    expect(ids(db)).toEqual(["a", "b", "c"]);
    expect(fake.calls).toHaveLength(0);
  });

  it("on a TTY deletes only when the operator types yes", async () => {
    await seedThree();
    const no = deps(makeFakeTurso(db), { isTTY: true, confirm: async () => "y" });
    expect(await runCli(["delete", "a"], no.deps)).toBe(EXIT.FOUND);
    expect(ids(db)).toEqual(["a", "b", "c"]);
    const yes = deps(makeFakeTurso(db), { isTTY: true, confirm: async () => "yes\n" });
    expect(await runCli(["delete", "a"], yes.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["b", "c"]);
  });

  it("--all-matches deletes every thread that mentions the text, and nothing else", async () => {
    await seedThree();
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["delete", "--all-matches", "--key", keyPath, "--yes", "Erika Müller"], a.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["c"]);
    expect(a.out.join("\n")).toContain("deleted: 2");
  });

  it("--all-matches with nothing matching deletes nothing and exits 0", async () => {
    await seedThree();
    const fake = makeFakeTurso(db);
    const a = deps(fake);
    expect(await runCli(["delete", "--all-matches", "--key", keyPath, "--yes", "Zebra"], a.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["a", "b", "c"]);
    expect(fake.calls.flatMap((c) => c.body.requests).some((r) => r.type === "batch")).toBe(false);
  });

  it("--all-matches still exits 1 when unreadable rows hide part of the data", async () => {
    await seedThree();
    insertRow(db, await ownedRow(thread("d", [{ role: "user", content: "Erika Müller" }]), OTHER_SPKI));
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["delete", "--all-matches", "--key", keyPath, "--yes", "Erika Müller"], a.deps)).toBe(EXIT.FOUND);
    expect(ids(db)).toEqual(["c", "d"]);
    expect(a.out.join("\n")).toContain("unreadable: 1");
  });

  it("delete with no ids cannot run", async () => {
    const a = deps(makeFakeTurso(db));
    expect(await runCli(["delete", "--yes"], a.deps)).toBe(EXIT.UNUSABLE);
  });
});

describe("expire", () => {
  it("uses exactly the app's whole-database expiry statement", () => {
    expect(expireStatements(30)).toEqual(expireThreadsStatements(30));
    expect(expireStatements(7)).toEqual(expireThreadsStatements(7));
  });

  it("deletes threads older than --days (default 30) and malformed dates, keeps the rest", async () => {
    // The cutoff is the DATABASE's clock, so the rows are dated from the real one.
    const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
    insertRow(db, { ...legacyRow(thread("old", [])), updated_at: ago(61) });
    insertRow(db, { ...legacyRow(thread("fresh", [])), updated_at: ago(2) });
    insertRow(db, { ...legacyRow(thread("bad", [])), updated_at: "garbage" });
    insertRow(db, { ...legacyRow(thread("mid", [])), updated_at: ago(12) });
    const fake = makeFakeTurso(db);
    const a = deps(fake);
    expect(await runCli(["expire"], a.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["fresh", "mid"]);
    const stmt = fake.calls[0].body.requests[0].stmt;
    expect(stmt).toEqual(expireThreadsStatements(30)[0]);
    expect(a.out.join("\n")).toContain("expired: 2");

    const b = deps(makeFakeTurso(db));
    expect(await runCli(["expire", "--days", "5"], b.deps)).toBe(EXIT.DONE);
    expect(ids(db)).toEqual(["fresh"]);
  });

  it("without --days uses AIPM_AI_CHAT_RETENTION_DAYS when it is valid, else 30 when unset, and prints the value used", async () => {
    const fake = makeFakeTurso(db);
    const a = deps(fake, { env: { ...ENV, AIPM_AI_CHAT_RETENTION_DAYS: "7" } });
    expect(await runCli(["expire"], a.deps)).toBe(EXIT.DONE);
    expect(fake.calls[0].body.requests[0].stmt).toEqual(expireThreadsStatements(7)[0]);
    expect(a.out.join("\n")).toContain("not updated for 7 days");

    for (const unset of [undefined, "", "  "]) {
      const other = makeFakeTurso(db);
      const b = deps(other, { env: { ...ENV, AIPM_AI_CHAT_RETENTION_DAYS: unset } });
      expect(await runCli(["expire"], b.deps)).toBe(EXIT.DONE);
      expect(other.calls[0].body.requests[0].stmt).toEqual(expireThreadsStatements(30)[0]);
      expect(b.out.join("\n")).toContain("not updated for 30 days");
    }

    const flag = makeFakeTurso(db);
    const c = deps(flag, { env: { ...ENV, AIPM_AI_CHAT_RETENTION_DAYS: "7" } });
    expect(await runCli(["expire", "--days", "12"], c.deps)).toBe(EXIT.DONE);
    expect(flag.calls[0].body.requests[0].stmt).toEqual(expireThreadsStatements(12)[0]);
  });

  it("without --days refuses while AIPM_AI_CHAT_RETENTION_DAYS is set but invalid, naming the setting, not its value", async () => {
    insertRow(db, { ...legacyRow(thread("old", [])), updated_at: "garbage" });
    for (const bad of ["abc", "0", "3651", "seven-days"]) {
      const fake = makeFakeTurso(db);
      const a = deps(fake, { env: { ...ENV, AIPM_AI_CHAT_RETENTION_DAYS: bad } });
      expect(await runCli(["expire"], a.deps)).toBe(1);
      expect(fake.calls).toHaveLength(0);
      const printed = [...a.out, ...a.err].join("\n");
      expect(printed).toContain("AIPM_AI_CHAT_RETENTION_DAYS");
      expect(printed).toContain("paused");
      if (bad !== "0") expect(printed).not.toContain(bad);
    }
    expect(ids(db)).toEqual(["old"]);
    // An explicit --days still works.
    const flag = makeFakeTurso(db);
    const b = deps(flag, { env: { ...ENV, AIPM_AI_CHAT_RETENTION_DAYS: "seven-days" } });
    expect(await runCli(["expire", "--days", "12"], b.deps)).toBe(EXIT.DONE);
    expect(flag.calls[0].body.requests[0].stmt).toEqual(expireThreadsStatements(12)[0]);
  });

  it("refuses a days value that is not a whole number from 1 to 3650", async () => {
    for (const days of ["0", "-3", "1.5", "abc", "3651"]) {
      const a = deps(makeFakeTurso(db));
      expect(await runCli(["expire", "--days", days], a.deps)).toBe(EXIT.UNUSABLE);
    }
  });
});

describe("usage", () => {
  it("an unknown command or option cannot run", async () => {
    expect(await runCli(["frobnicate"], deps(makeFakeTurso(db)).deps)).toBe(EXIT.UNUSABLE);
    expect(await runCli(["search", "--nope", "x"], deps(makeFakeTurso(db)).deps)).toBe(EXIT.UNUSABLE);
    expect(await runCli([], deps(makeFakeTurso(db)).deps)).toBe(EXIT.UNUSABLE);
  });
});
