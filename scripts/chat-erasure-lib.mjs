// scripts/chat-erasure-lib.mjs — core of the operator's chat erasure script (scripts/chat-erasure.mjs).
//
// Saved AI chats (Turso table `chat_threads`) are encrypted per person, but every owned row's thread
// key is ALSO wrapped for the operator (`key_operator`, RSA-OAEP to the recovery public key). With
// the matching PRIVATE key this script can open every row, so a request about one named person can
// be answered across the whole database: find the chats that mention them, erase them, and expire
// chats past the retention period.
//
// Formats mirror the app and must stay identical (the test builds rows with the app's own codec):
//   envelope          "c1." + b64(iv) + "." + b64(AES-256-GCM ciphertext)   — src/app/chat-crypto.ts
//   operator wrap     "r1." + b64(RSA-OAEP-SHA-256 ciphertext of the 32-byte thread key)
//   legacy row        owner_id NULL or '' — name / history_json / display_json are plain text
//   recovery key      base64 DER SPKI, RSA-OAEP, ≥ 3072 bits — src/app/ai-chat-retention-config.ts
// The search mirrors src/app/chat-thread-mentions.ts so the operator and the user find the same chats.
//
// ★★ Never writes chat plaintext anywhere: output is ids, dates and one ≤ 80-character excerpt per
//    match. Never prints the token or the database URL.
// ★ Everything with a side effect (network, files, clock, prompt, output) is injected through
//   `deps`, so the whole command path is testable without a real database.
import { createPrivateKey, generateKeyPair } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs, promisify } from "node:util";

/** 0 done · 1 matches found, refused, or unreadable rows hide part of the data · 2 could not run. */
export const EXIT = Object.freeze({ DONE: 0, FOUND: 1, UNUSABLE: 2 });

export const URL_ENV = "CHAT_ERASURE_TURSO_URL";
export const TOKEN_ENV = "CHAT_ERASURE_TURSO_TOKEN";
export const EXCERPT_MAX = 80;
export const PAGE_SIZE = 200;
export const DEFAULT_DAYS = 30;
const MAX_DAYS = 3650;
const RECOVERY_KEY_BITS = 3072;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const DAY_MS = 86_400_000;
const PIPELINE_TIMEOUT_MS = 30_000;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const USAGE = [
  "usage: npm run chats:erase -- <command>",
  "  keygen --out <file>                         new recovery key pair; prints the public key",
  "  search --key <file> <text>                  find chats mentioning <text>",
  "  delete [--yes] <id…>                        delete chats by id",
  "  delete --all-matches --key <file> [--yes] <text>   delete every chat mentioning <text>",
  "  expire [--days <n>]                         delete chats not updated for n days (default 30)",
  `environment: ${URL_ENV}, ${TOKEN_ENV}`,
].join("\n");

/** A failure the script reports and exits 2 on. The message is safe to print. */
class UnusableError extends Error {}

// ── Turso HTTP ──────────────────────────────────────────────────────────────

/** `libsql://` → `https://`, origin only (no credentials, no path). Plain http only for loopback. */
export function toHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw).trim().replace(/^libsql:\/\//, "https://"));
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;
  if (parsed.protocol === "https:") return parsed.origin;
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && loopback) return parsed.origin;
  return null;
}

const txt = (value) => ({ type: "text", value: String(value) });
const int = (value) => ({ type: "integer", value: String(value) });

function readConfig(env) {
  const rawUrl = (env[URL_ENV] ?? "").trim();
  const token = (env[TOKEN_ENV] ?? "").trim();
  if (rawUrl === "" || token === "") throw new UnusableError(`set ${URL_ENV} and ${TOKEN_ENV}`);
  const httpUrl = toHttpUrl(rawUrl);
  if (httpUrl === null) throw new UnusableError(`${URL_ENV} is not a usable https or libsql URL`);
  return { httpUrl, token };
}

const isTransactional = (stmts) =>
  /^\s*BEGIN\b/i.test(stmts[0]?.sql ?? "") && /^\s*COMMIT\b/i.test(stmts[stmts.length - 1]?.sql ?? "");

/** A BEGIN…COMMIT list as ONE batch whose steps each run only if the previous one succeeded, with a
 *  ROLLBACK when COMMIT did not — the shape `runTursoPipeline` (src/app/turso-pipeline.ts) sends. A
 *  pipeline of separate executes would keep going past a failed statement and COMMIT the rest. */
function atomicBatch(stmts) {
  const steps = stmts.map((stmt, i) => (i === 0 ? { stmt } : { stmt, condition: { type: "ok", step: i - 1 } }));
  steps.push({ stmt: { sql: "ROLLBACK" }, condition: { type: "not", cond: { type: "ok", step: stmts.length - 1 } } });
  return { type: "batch", batch: { steps } };
}

/** One result per statement (`{ cols, rows, affected_row_count }`). Throws `UnusableError` on any failure. */
async function runPipeline(config, fetchImpl, stmts) {
  const transactional = isTransactional(stmts);
  const requests = transactional ? [atomicBatch(stmts)] : stmts.map((stmt) => ({ type: "execute", stmt }));
  requests.push({ type: "close" });
  let res;
  let text;
  try {
    res = await fetchImpl(`${config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS),
    });
    text = await res.text();
  } catch {
    throw new UnusableError("could not reach the Turso database");
  }
  if (res.status === 401 || res.status === 403) throw new UnusableError("Turso refused the token");
  if (!res.ok) throw new UnusableError(`Turso returned HTTP ${res.status}`);
  let results;
  try {
    results = JSON.parse(text).results;
  } catch {
    results = undefined;
  }
  if (!Array.isArray(results)) throw new UnusableError("Turso returned an unexpected response");
  if (!transactional) {
    return stmts.map((_, i) => {
      const r = results[i];
      if (r?.type === "error") throw new UnusableError(`Turso error: ${r.error?.message ?? "unknown"}`);
      const result = r?.response?.result;
      if (r?.type !== "ok" || !result) throw new UnusableError("Turso returned an unexpected response");
      return result;
    });
  }
  const only = results[0];
  if (only?.type === "error") throw new UnusableError(`Turso error: ${only.error?.message ?? "unknown"}`);
  const answer = only?.response?.result;
  if (only?.response?.type !== "batch" || !Array.isArray(answer?.step_results)) {
    throw new UnusableError("Turso returned an unexpected response");
  }
  const failed = (answer.step_errors ?? []).slice(0, stmts.length).find((e) => e);
  if (failed) throw new UnusableError(`Turso error: ${failed.message ?? "unknown"} (nothing was changed)`);
  return stmts.map((_, i) => {
    const result = answer.step_results[i];
    if (!result) throw new UnusableError("Turso returned an unexpected response");
    return result;
  });
}

/** Row objects of one result, every cell as a string ('' for NULL) — as `rowObjects` in turso-schema.ts. */
function rowObjects(result) {
  const names = (result?.cols ?? []).map((c) => c?.name ?? "");
  return (result?.rows ?? []).map((row) => {
    const obj = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

// ── keys and envelopes ──────────────────────────────────────────────────────

const subtle = () => globalThis.crypto.subtle;

function fromB64(b64) {
  if (typeof b64 !== "string" || b64 === "" || !BASE64_RE.test(b64)) throw new Error("bad-base64");
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** A new recovery key pair: the PKCS#8 private key as PEM, and the public key as base64 DER SPKI —
 *  the exact form `AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY` takes. */
export async function generateRecoveryKeyPair() {
  const { publicKey, privateKey } = await promisify(generateKeyPair)("rsa", {
    modulusLength: RECOVERY_KEY_BITS,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privatePem: privateKey, publicSpkiB64: Buffer.from(publicKey).toString("base64") };
}

/** Write the private key; refuses an existing file. Mode 0600 where the platform supports it. */
export function writePrivateKeyFile(path, pem) {
  writeFileSync(path, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

/** Import a PKCS#8 PEM RSA private key as a Web Crypto RSA-OAEP (SHA-256) decryption key. */
export async function importOperatorKey(pem) {
  const key = createPrivateKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "rsa") throw new Error("not-rsa");
  const der = key.export({ type: "pkcs8", format: "der" });
  return subtle().importKey("pkcs8", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

/** Reverse of the app's `wrapForOperator`: the raw 32-byte thread key. Throws on anything else. */
export async function unwrapOperatorKey(privateKey, wrapped) {
  const parts = typeof wrapped === "string" ? wrapped.split(".") : [];
  if (parts.length !== 2 || parts[0] !== "r1") throw new Error("bad-wrap");
  const raw = new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(parts[1])));
  if (raw.length !== KEY_BYTES) throw new Error("bad-thread-key");
  return raw;
}

async function openText(threadKey, envelope) {
  const parts = typeof envelope === "string" ? envelope.split(".") : [];
  if (parts.length !== 3 || parts[0] !== "c1") throw new Error("bad-envelope");
  const iv = fromB64(parts[1]);
  if (iv.length !== IV_BYTES) throw new Error("bad-envelope");
  const aes = await subtle().importKey("raw", threadKey, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv }, aes, fromB64(parts[2]));
  return new TextDecoder("utf-8", { fatal: true }).decode(pt);
}

/** `{ name, history, display }` as text, or null when an owned row cannot be opened with this key. */
async function readRowTexts(r, privateKey) {
  if (!r.owner_id) return { name: r.name, history: r.history_json, display: r.display_json };
  if (!r.key_operator) return null;
  try {
    const threadKey = await unwrapOperatorKey(privateKey, r.key_operator);
    const [name, history, display] = await Promise.all([
      openText(threadKey, r.name), openText(threadKey, r.history_json), openText(threadKey, r.display_json),
    ]);
    return { name, history, display };
  } catch {
    return null;
  }
}

// ── search ──────────────────────────────────────────────────────────────────

/** Case- and composition-insensitive form, as chat-thread-mentions.ts `fold`. */
const fold = (text) => text.normalize("NFC").toLowerCase();

function messageTexts(message) {
  if (!message || typeof message !== "object") return [];
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  const texts = [];
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "tool_result") texts.push(block.content);
    else if (block.type === "tool_use") texts.push(JSON.stringify(block.input ?? null));
  }
  return texts;
}

function displayTexts(item) {
  if (!item || typeof item !== "object") return [];
  if (item.kind === "tool") return [JSON.stringify(item.input ?? null), item.result];
  if (item.kind === "proposal") return [];
  return [item.text];
}

/** The texts of a stored JSON array; a value that is not a JSON array is searched as raw text, so a
 *  malformed row can still be found (the app would show it as empty). */
function jsonTexts(raw, pick) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.flatMap(pick);
  } catch {
    // fall through to the raw text
  }
  return [raw];
}

/** ≤ EXCERPT_MAX characters of `text` around the first occurrence of the folded `needle`, on one line. */
export function excerptAround(text, needle) {
  const folded = fold(text);
  const idx = folded.indexOf(needle);
  if (idx < 0) return "";
  const nfc = text.normalize("NFC");
  // Lower-casing can change the length of a few characters; then index into the folded form.
  const source = nfc.length === folded.length ? nfc : folded;
  const start = Math.max(0, idx - Math.max(0, Math.floor((EXCERPT_MAX - needle.length) / 2)));
  return source.slice(start, start + EXCERPT_MAX).replace(/\s+/g, " ").trim();
}

function firstExcerpt(texts, needle) {
  for (const text of texts) {
    if (typeof text === "string" && fold(text).includes(needle)) return excerptAround(text, needle);
  }
  return null;
}

const PAGE_SQL =
  "SELECT id, project_id, owner_id, name, updated_at, history_json, display_json, key_operator " +
  "FROM chat_threads ORDER BY id LIMIT ? OFFSET ?";

/** Every row of the database, in pages: `{ matches: [{ id, projectId, updatedAt, excerpt }], unreadable, readable }`. */
async function searchDatabase(run, privateKey, query, pageSize) {
  const needle = fold(query.trim());
  const matches = [];
  let unreadable = 0;
  let readable = 0;
  for (let offset = 0; ; offset += pageSize) {
    const [page] = await run([{ sql: PAGE_SQL, args: [int(pageSize), int(offset)] }]);
    const rows = rowObjects(page);
    for (const r of rows) {
      const texts = await readRowTexts(r, privateKey);
      if (texts === null) {
        unreadable += 1;
        continue;
      }
      readable += 1;
      const excerpt = firstExcerpt(
        [texts.name, ...jsonTexts(texts.history, messageTexts), ...jsonTexts(texts.display, displayTexts)],
        needle,
      );
      if (excerpt !== null) matches.push({ id: r.id, projectId: r.project_id, updatedAt: r.updated_at, excerpt });
    }
    if (rows.length < pageSize) break;
  }
  return { matches, unreadable, readable };
}

function reportSearch(result, out) {
  for (const m of result.matches) out(`${m.id}\t${m.projectId}\t${m.updatedAt}\t${m.excerpt}`);
  const n = result.matches.length;
  if (n > 0) out(`${n} ${n === 1 ? "match" : "matches"}`);
  else if (result.unreadable > 0) out(`no match in the ${result.readable} readable rows`);
  else out("0 matches");
  out(`unreadable: ${result.unreadable}`);
  if (result.unreadable > 0) out("rows this key cannot open may also mention the text; use the key they were wrapped for");
}

// ── statements ──────────────────────────────────────────────────────────────

/** One atomic BEGIN … COMMIT deleting each id once. */
export function deleteStatements(ids) {
  return [
    { sql: "BEGIN" },
    ...[...new Set(ids)].map((id) => ({ sql: "DELETE FROM chat_threads WHERE id = ?", args: [txt(id)] })),
    { sql: "COMMIT" },
  ];
}

/** The app's whole-database expiry rule (`expireThreadsStatements` in chat-threads-schema.ts): rows
 *  last updated before the cutoff, plus any without a usable `updated_at`. */
export function expireStatements(cutoffIso) {
  const stale = `(updated_at < ? OR updated_at IS NULL OR updated_at = '' OR julianday(updated_at) IS NULL)`;
  return [{ sql: `DELETE FROM chat_threads WHERE ${stale}`, args: [txt(cutoffIso)] }];
}

// ── commands ────────────────────────────────────────────────────────────────

async function loadKey(path, deps) {
  if (!path) throw new UnusableError("--key <private key file> is required");
  let pem;
  try {
    pem = deps.readTextFile(path);
  } catch {
    throw new UnusableError("could not read the key file");
  }
  try {
    return await importOperatorKey(pem);
  } catch {
    throw new UnusableError("the key file is not an RSA private key in PKCS#8 PEM form");
  }
}

async function confirmed(count, values, deps) {
  if (values.yes) return true;
  if (!deps.isTTY) {
    deps.err("refused: not a terminal; pass --yes to delete without a prompt");
    return false;
  }
  const answer = await deps.confirm(`Delete ${count} chat${count === 1 ? "" : "s"}? Type yes to confirm: `);
  if (String(answer ?? "").trim() === "yes") return true;
  deps.err("refused: nothing was deleted");
  return false;
}

async function deleteIds(ids, run, deps) {
  const results = await run(deleteStatements(ids));
  const deleted = results.slice(1, -1).reduce((sum, r) => sum + Number(r.affected_row_count ?? 0), 0);
  deps.out(`deleted: ${deleted}`);
}

async function cmdKeygen(values, deps) {
  if (!values.out) throw new UnusableError("--out <file> is required");
  const pair = await (deps.generateKeyPair ?? generateRecoveryKeyPair)();
  try {
    deps.writePrivateKey(values.out, pair.privatePem);
  } catch (e) {
    throw new UnusableError(e?.code === "EEXIST" ? "refused: the --out file already exists" : "could not write the --out file");
  }
  deps.out("private key written; keep it offline and never commit it");
  deps.out("set this as AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY:");
  deps.out(pair.publicSpkiB64);
  return EXIT.DONE;
}

async function cmdSearch(values, positionals, run, deps) {
  const query = positionals.join(" ");
  if (query.trim() === "") throw new UnusableError("search text is required");
  const key = await loadKey(values.key, deps);
  const result = await searchDatabase(run, key, query, deps.pageSize ?? PAGE_SIZE);
  reportSearch(result, deps.out);
  return result.matches.length > 0 || result.unreadable > 0 ? EXIT.FOUND : EXIT.DONE;
}

async function cmdDelete(values, positionals, run, deps) {
  if (!values["all-matches"]) {
    if (positionals.length === 0) throw new UnusableError("at least one thread id is required");
    if (!(await confirmed(new Set(positionals).size, values, deps))) return EXIT.FOUND;
    await deleteIds(positionals, run, deps);
    return EXIT.DONE;
  }
  const query = positionals.join(" ");
  if (query.trim() === "") throw new UnusableError("search text is required");
  const key = await loadKey(values.key, deps);
  const result = await searchDatabase(run, key, query, deps.pageSize ?? PAGE_SIZE);
  reportSearch(result, deps.out);
  if (result.matches.length > 0) {
    if (!(await confirmed(result.matches.length, values, deps))) return EXIT.FOUND;
    await deleteIds(result.matches.map((m) => m.id), run, deps);
  }
  return result.unreadable > 0 ? EXIT.FOUND : EXIT.DONE;
}

function parseDays(raw) {
  if (raw === undefined) return DEFAULT_DAYS;
  const days = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new UnusableError(`--days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  return days;
}

async function cmdExpire(values, run, deps) {
  const days = parseDays(values.days);
  const cutoff = new Date(deps.now().getTime() - days * DAY_MS).toISOString();
  const [result] = await run(expireStatements(cutoff));
  deps.out(`expired: ${Number(result.affected_row_count ?? 0)} (not updated since ${cutoff})`);
  return EXIT.DONE;
}

const OPTIONS = {
  key: { type: "string" },
  out: { type: "string" },
  days: { type: "string" },
  yes: { type: "boolean" },
  "all-matches": { type: "boolean" },
};

/** Run one command; resolves to the exit code. Never throws. */
export async function runCli(argv, deps) {
  try {
    const [command, ...rest] = argv;
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
    } catch {
      throw new UnusableError(USAGE);
    }
    const { values, positionals } = parsed;
    if (command === "keygen") return await cmdKeygen(values, deps);
    if (command !== "search" && command !== "delete" && command !== "expire") throw new UnusableError(USAGE);
    // Arguments are checked before the database is touched; credentials before anything is sent.
    if (command === "expire") parseDays(values.days);
    const config = readConfig(deps.env);
    const run = (stmts) => runPipeline(config, deps.fetchImpl, stmts);
    if (command === "search") return await cmdSearch(values, positionals, run, deps);
    if (command === "delete") return await cmdDelete(values, positionals, run, deps);
    return await cmdExpire(values, run, deps);
  } catch (e) {
    deps.err(e instanceof UnusableError ? e.message : `failed unexpectedly (${e?.name ?? "error"})`);
    return EXIT.UNUSABLE;
  }
}
