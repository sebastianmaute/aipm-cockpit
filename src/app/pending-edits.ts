// src/app/pending-edits.ts
//
// §626 — the pending-edits outbox: a synchronous localStorage record of text the user typed into an
// async-commit editor (chat-thread rename, template name, template body) whose durable write had not
// landed when the page went away. A commit to Turso is a network round trip, so a window closed
// mid-draft or mid-commit otherwise loses the typing. See
// docs/superpowers/specs/2026-09-29-pending-edits-outbox-design.md.
//
// Live edits are held in memory and written only from one `pagehide` listener — `setItem` is
// synchronous, which is the whole mechanism. Nothing here ever throws: a caller in an unload handler
// cannot afford a thrown error to abort the page teardown.

import { logDiag } from "./diagnostics";
import { UNLOAD_JOURNAL_MAX_AGE_MS, UNLOAD_JOURNAL_MAX_CHARS, hashForStorageKey } from "./unload-journal";

/** localStorage key prefix. The suffix is a `pendingEditScope` (a hash, never the URL or token). */
export const PENDING_EDITS_PREFIX = "aipm-cockpit:pending-edits:";

export type PendingEditKind = "chat-thread-name" | "template-name" | "template-body";

const PENDING_EDIT_KINDS: readonly PendingEditKind[] = ["chat-thread-name", "template-name", "template-body"];

export type PendingEdit = {
  v: 1;
  kind: PendingEditKind;
  /** Thread id or template id. */
  id: string;
  /** The stored value the draft started from — replay only applies when it still matches. */
  base: string;
  /** The draft. */
  value: string;
  /** Epoch ms, stamped at flush time. */
  savedAt: number;
};

/** Live edits per scope, keyed `kind:id`. A scope stays in the map once seen, even when emptied, so
 *  the next flush removes a key an earlier flush wrote. */
const liveEdits = new Map<string, Map<string, PendingEdit>>();
/** Scopes `takePendingEdits` has already read in this page's lifetime. Stored edits are replayed on
 *  the next START only: a later take (a bfcache restore leaves the record in place) would apply a
 *  draft the user has since cancelled. */
const takenScopes = new Set<string>();
let listenerInstalled = false;

function storageKeyFor(scope: string): string {
  return `${PENDING_EDITS_PREFIX}${scope}`;
}

function editKey(kind: PendingEditKind, id: string): string {
  return `${kind}:${id}`;
}

/** `part` is the project id for chat threads or `"templates"` for templates. The hash keeps the Turso
 *  URL (which can carry a token) out of the storage key. */
export function pendingEditScope(httpUrl: string, part: string): string {
  return `${hashForStorageKey(httpUrl)}:${part}`;
}

function onPageHide(): void {
  flushPendingEdits(Date.now());
}

/** Records (or replaces, by `kind` + `id`) a live edit. Installs the module's `pagehide` listener on
 *  first use. Never throws. */
export function trackPendingEdit(scope: string, edit: Omit<PendingEdit, "v" | "savedAt">): void {
  try {
    if (typeof window === "undefined") return;
    if (!listenerInstalled) {
      window.addEventListener("pagehide", onPageHide);
      listenerInstalled = true;
    }
    let edits = liveEdits.get(scope);
    if (!edits) {
      edits = new Map();
      liveEdits.set(scope, edits);
    }
    edits.set(editKey(edit.kind, edit.id), { v: 1, ...edit, savedAt: 0 });
  } catch (err) {
    logDiag("warn", "storage.pendingEditsWriteFailed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/** The edit's durable write resolved (or the draft was cancelled): it no longer needs the outbox.
 *  With `value`, settles only while the live entry still carries that value: a save that resolves
 *  after the user typed a newer draft into the same field must not delete the newer draft. */
export function settlePendingEdit(scope: string, kind: PendingEditKind, id: string, value?: string): void {
  const edits = liveEdits.get(scope);
  const key = editKey(kind, id);
  if (value !== undefined && edits?.get(key)?.value !== value) return;
  edits?.delete(key);
}

function logTooLarge(edit: PendingEdit, size: number): void {
  // Kind and id only, never the draft, which is the user's own content.
  logDiag("warn", "storage.pendingEditsWriteFailed", { reason: "too-large", kind: edit.kind, id: edit.id, size });
}

/** The edits that fit `UNLOAD_JOURNAL_MAX_CHARS`: each on its own first (one huge template body must
 *  not stop a small rename in the same scope being written), then, while the array is still over the
 *  cap together, the largest goes. Every drop is logged. */
function fittingEdits(edits: PendingEdit[]): PendingEdit[] {
  const fitting: PendingEdit[] = [];
  for (const edit of edits) {
    const size = JSON.stringify(edit).length;
    if (size > UNLOAD_JOURNAL_MAX_CHARS) logTooLarge(edit, size);
    else fitting.push(edit);
  }
  while (fitting.length > 0 && JSON.stringify(fitting).length > UNLOAD_JOURNAL_MAX_CHARS) {
    let largest = 0;
    let largestSize = -1;
    fitting.forEach((edit, i) => {
      const size = JSON.stringify(edit).length;
      if (size > largestSize) { largest = i; largestSize = size; }
    });
    logTooLarge(fitting[largest], largestSize);
    fitting.splice(largest, 1);
  }
  return fitting;
}

function writeScope(scope: string, edits: Map<string, PendingEdit>, now: number): void {
  const key = storageKeyFor(scope);
  try {
    const fitting = fittingEdits([...edits.values()].map((edit) => ({ ...edit, savedAt: now })));
    // Nothing left to store: remove the key so a stale earlier record cannot replay.
    if (fitting.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(fitting));
  } catch (err) {
    logDiag("warn", "storage.pendingEditsWriteFailed", {
      reason: "storage-error", message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Writes every scope's live set (an empty set removes its key), stamping `savedAt` with `now`. Called
 *  by the `pagehide` listener; exported for tests. Never throws. */
export function flushPendingEdits(now: number): void {
  if (typeof window === "undefined") return;
  for (const [scope, edits] of liveEdits) writeScope(scope, edits, now);
}

function isPendingEditFields(value: unknown): value is PendingEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.v === 1 &&
    PENDING_EDIT_KINDS.includes(rec.kind as PendingEditKind) &&
    typeof rec.id === "string" &&
    typeof rec.base === "string" &&
    typeof rec.value === "string" &&
    typeof rec.savedAt === "number" && Number.isFinite(rec.savedAt)
  );
}

type DropReason = "corrupt" | "expired" | "storage-error";

function logDropped(reason: DropReason, fields: Record<string, unknown> = {}): void {
  logDiag("warn", "storage.pendingEditDropped", { reason, ...fields });
}

/** `kind` and `id` of a stored entry when they are present and strings, never the value. */
function entryIdentity(entry: unknown): Record<string, string> {
  if (!entry || typeof entry !== "object") return {};
  const rec = entry as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof rec.kind === "string") out.kind = rec.kind;
  if (typeof rec.id === "string") out.id = rec.id;
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads the stored edits for `scope` and removes the key. Records that fail to parse or validate, and
 *  those older than `UNLOAD_JOURNAL_MAX_AGE_MS` at `now`, are dropped and logged (kind and id where
 *  known, never the value). Only the first take of a scope in a page lifetime reads; later ones return
 *  `[]` and leave storage alone. A storage read or remove error is logged as `storage-error`, not
 *  `corrupt`; a failed removal still returns the edits already read. Never throws. */
export function takePendingEdits(scope: string, now: number): PendingEdit[] {
  if (typeof window === "undefined") return [];
  if (takenScopes.has(scope)) return [];
  takenScopes.add(scope);
  const key = storageKeyFor(scope);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (err) {
    logDropped("storage-error", { operation: "read", message: errorMessage(err) });
    return [];
  }
  if (!raw) return [];
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    // The draft was read: hand it back anyway rather than lose it over a failed cleanup.
    logDropped("storage-error", { operation: "remove", message: errorMessage(err) });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logDropped("corrupt");
    return [];
  }
  if (!Array.isArray(parsed)) {
    logDropped("corrupt");
    return [];
  }
  const kept: PendingEdit[] = [];
  for (const entry of parsed as unknown[]) {
    if (!isPendingEditFields(entry)) {
      logDropped("corrupt", entryIdentity(entry));
    } else if (now - entry.savedAt > UNLOAD_JOURNAL_MAX_AGE_MS) {
      logDropped("expired", { kind: entry.kind, id: entry.id });
    } else {
      kept.push(entry);
    }
  }
  return kept;
}

export function resetPendingEditsForTests(): void {
  liveEdits.clear();
  takenScopes.clear();
  if (listenerInstalled && typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  listenerInstalled = false;
}
