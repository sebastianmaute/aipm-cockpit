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

/** The edit's durable write resolved (or the draft was cancelled): it no longer needs the outbox. */
export function settlePendingEdit(scope: string, kind: PendingEditKind, id: string): void {
  liveEdits.get(scope)?.delete(editKey(kind, id));
}

function writeScope(scope: string, edits: Map<string, PendingEdit>, now: number): void {
  const key = storageKeyFor(scope);
  try {
    if (edits.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    const serialized = JSON.stringify([...edits.values()].map((edit) => ({ ...edit, savedAt: now })));
    if (serialized.length > UNLOAD_JOURNAL_MAX_CHARS) {
      // Kinds only — never the draft text, which is the user's own content.
      logDiag("warn", "storage.pendingEditsWriteFailed", {
        reason: "too-large", size: serialized.length, kinds: [...edits.values()].map((edit) => edit.kind),
      });
      return;
    }
    window.localStorage.setItem(key, serialized);
  } catch (err) {
    logDiag("warn", "storage.pendingEditsWriteFailed", {
      reason: "storage", message: err instanceof Error ? err.message : String(err),
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

function logDropped(reason: "corrupt" | "expired", fields: Record<string, unknown> = {}): void {
  logDiag("warn", "storage.pendingEditDropped", { reason, ...fields });
}

/** Reads the stored edits for `scope` and removes the key. Records that fail to parse or validate, and
 *  those older than `UNLOAD_JOURNAL_MAX_AGE_MS` at `now`, are dropped and logged (kind and id only,
 *  never the value). Never throws. */
export function takePendingEdits(scope: string, now: number): PendingEdit[] {
  if (typeof window === "undefined") return [];
  const key = storageKeyFor(scope);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
    if (!raw) return [];
    window.localStorage.removeItem(key);
  } catch (err) {
    logDropped("corrupt", { message: err instanceof Error ? err.message : String(err) });
    return [];
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
      logDropped("corrupt");
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
  if (listenerInstalled && typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  listenerInstalled = false;
}
