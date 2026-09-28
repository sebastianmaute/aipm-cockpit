// src/app/unload-journal.ts
//
// §629 — the unload journal: a synchronous localStorage record of the
// unconfirmed outgoing workspace, written where a backend save cannot
// complete before the page goes away (pagehide / hidden-tab commit). Every
// backend's save is asynchronous before any write exists, so a draft
// committed right before a reload or close is otherwise lost. See
// docs/superpowers/specs/2026-09-27-unload-journal-design.md.
//
// Pure module: this file touches localStorage only inside try/catch, and
// nothing here ever throws — a caller in an unload handler cannot afford a
// thrown error to abort the page teardown.

import { logDiag } from "./diagnostics";
import { workspaceToJson, jsonToWorkspace, type StorageKind, type Workspace } from "./workspace";

/** localStorage key prefix. The suffix is a `projectKey` (never a credential —
 *  see `journalProjectKey` below), so the stored key itself carries nothing
 *  that would leak a Turso token. */
export const UNLOAD_JOURNAL_PREFIX = "aipm-cockpit:unload-journal:";

/** A serialised record over this many characters is not written — logged as
 *  `workspace.unloadJournalSkipped` instead. Keeps one huge workspace from
 *  either filling localStorage's quota outright or crowding out every other
 *  key sharing the origin. */
export const UNLOAD_JOURNAL_MAX_CHARS = 1_500_000;

export type UnloadJournal = {
  v: 1;
  /** Never a credential — see `journalProjectKey`. */
  projectKey: string;
  tabId: string;
  savedAt: number;
  /** Fingerprint of the last CONFIRMED (loaded, or previously saved-and-confirmed)
   *  state, rolled forward on every confirmed save. Compared against a fresh
   *  `fingerprintWorkspace(loaded)` on the next load to decide whether the
   *  journal still applies cleanly. */
  baseFingerprint: string;
  /** `workspaceToJson` of the unconfirmed outgoing workspace. */
  workspace: string;
};

/** Storage kinds whose relational round trip through Turso cannot be made
 *  fingerprint-stable by canonicalising (see `fingerprintWorkspace`). Task 3
 *  treats a journal for one of these kinds as an always-mismatch, the same
 *  outcome as a genuine fingerprint mismatch. Populated by the Step 3 proof
 *  in `unload-journal.test.ts`; empty means every backend kind checked there
 *  round-trips cleanly. */
export const JOURNAL_FINGERPRINT_UNSTABLE_KINDS: readonly StorageKind[] = [];

function journalKey(projectKey: string): string {
  return `${UNLOAD_JOURNAL_PREFIX}${projectKey}`;
}

/** The journal key's `projectKey`, computed the same way for every write/read/
 *  clear so a key never carries a credential. `storageTargetKey` (which holds
 *  the Turso auth token) is deliberately NOT an input here.
 *
 *  - Turso: the Turso project id, or the sentinel `"turso"` when there is
 *    none (falsy or empty) — fix round 1 / ruling R4: Turso single-tenant
 *    mode is one workspace per database, so a project-less Turso setup is a
 *    real, valid case, and it must NOT fall back to `"browser"` — that would
 *    collide with an IndexedDB/local backend with no current project id,
 *    which is a DIFFERENT workspace on the same origin.
 *  - Every other kind: the registry's current project id, or `"browser"` when
 *    there is none (falsy or empty). */
export function journalProjectKey(
  storageKind: StorageKind,
  tursoProjectId: string | null | undefined,
  currentProjectId: string | null | undefined,
): string {
  if (storageKind === "turso") {
    return tursoProjectId && tursoProjectId.length > 0 ? tursoProjectId : "turso";
  }
  return currentProjectId && currentProjectId.length > 0 ? currentProjectId : "browser";
}

// --- Fingerprint -------------------------------------------------------

// FNV-1a, 64-bit arithmetic (BigInt), masked down to 53 bits so the result
// fits a JS safe integer — stored as a base-36 string. Non-cryptographic and
// fast, which is all a same-origin, same-device comparison needs.
//
// BigInt CONSTRUCTOR calls, not literals (`123n`): this repo's tsconfig
// targets ES2017, where BigInt literal syntax is a compile error (TS2737) —
// the constructor form works at any target since BigInt itself comes from
// the "esnext" lib, only the `n`-suffix syntax is target-gated. The hex
// values are passed as strings because they exceed Number.MAX_SAFE_INTEGER,
// so a numeric argument would already have lost precision before BigInt()
// ever saw it.
const FNV_OFFSET_BASIS_64 = BigInt("0xcbf29ce484222325");
const FNV_PRIME_64 = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");
const MASK_53 = (BigInt(1) << BigInt(53)) - BigInt(1);

function fnv1a53(input: string): string {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return (hash & MASK_53).toString(36);
}

/** Recursively sorts every plain object's keys (arrays keep their element
 *  order — order is meaningful there, e.g. task order). Used so the
 *  fingerprint does not depend on which field order a backend happens to
 *  reconstruct an entity in. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) out[key] = sortKeysDeep(rec[key]);
    return out;
  }
  return value;
}

/** A fast non-cryptographic hash over a canonical serialisation of `ws`. The
 *  recovery compares a fingerprint taken BEFORE saving with one taken of what
 *  the backend returns on the next LOAD, so this must be round-trip stable:
 *  `fingerprintWorkspace(saved) === fingerprintWorkspace(loaded)` for every
 *  backend kind — proved per kind in `unload-journal.test.ts` (Step 3).
 *
 *  Canonicalisation, and why each step is here (§629 Step 3 finding): a
 *  relational backend (Turso) reconstructs each entity field-by-field from
 *  named SQL columns, in whatever field order its decoder happens to declare
 *  — never the field order the entity had before saving. Re-encoding through
 *  `jsonToWorkspace(workspaceToJson(ws))` first runs the SAME migration chain
 *  every load already runs (idempotent, so this is a no-op on an
 *  already-migrated workspace) — deep key sorting alone would still see a
 *  migration-only difference between a pre-migration and a post-migration
 *  workspace as a content change. Sorting object keys afterwards then makes
 *  the comparison blind to field order. Array order is never sorted — it is
 *  meaningful (task order, document order, ...), and every backend here
 *  preserves it. */
export function fingerprintWorkspace(ws: Workspace): string {
  const canonical = workspaceToJson(jsonToWorkspace(workspaceToJson(ws)));
  const sorted = sortKeysDeep(JSON.parse(canonical) as unknown);
  return fnv1a53(JSON.stringify(sorted));
}

// --- Record write / read / clear ---------------------------------------

/** What `writeUnloadJournal` takes: the record without `v`, where `baseFingerprint`
 *  may be a thunk. A thunk is called only once the record WITHOUT it already fits
 *  the cap, so a record that is going to be skipped never pays for a fingerprint
 *  (§629 fix round 1 — the caller runs inside an unload handler). */
export type UnloadJournalWrite = Omit<UnloadJournal, "v" | "baseFingerprint"> & {
  baseFingerprint: string | (() => string);
};

function logSkippedSize(projectKey: string, size: number): void {
  logDiag("warn", "workspace.unloadJournalSkipped", { projectKey, size });
}

/** Writes the journal. Never throws: a size over `UNLOAD_JOURNAL_MAX_CHARS`,
 *  a `baseFingerprint` thunk that throws, or a `localStorage.setItem` failure
 *  (e.g. `QuotaExceededError`) each log `workspace.unloadJournalSkipped` and
 *  return false instead of writing. */
export function writeUnloadJournal(rec: UnloadJournalWrite): boolean {
  try {
    if (typeof window === "undefined") return false;
    const { baseFingerprint, ...rest } = rec;
    if (typeof baseFingerprint === "function") {
      // A fingerprint only lengthens the record, so one over the cap without it stays over.
      const withoutFingerprint = JSON.stringify({ v: 1, ...rest, baseFingerprint: "" });
      if (withoutFingerprint.length > UNLOAD_JOURNAL_MAX_CHARS) {
        logSkippedSize(rec.projectKey, withoutFingerprint.length);
        return false;
      }
    }
    const value: UnloadJournal = {
      v: 1,
      ...rest,
      baseFingerprint: typeof baseFingerprint === "function" ? baseFingerprint() : baseFingerprint,
    };
    const serialized = JSON.stringify(value);
    if (serialized.length > UNLOAD_JOURNAL_MAX_CHARS) {
      logSkippedSize(rec.projectKey, serialized.length);
      return false;
    }
    window.localStorage.setItem(journalKey(rec.projectKey), serialized);
    return true;
  } catch (err) {
    logDiag("warn", "workspace.unloadJournalSkipped", {
      projectKey: rec.projectKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** §632 — a number `new Date` can format: a `savedAt` outside that range made the other-keys notice
 *  throw on render, so such a record counts as malformed. */
const MAX_DATE_MS = 8.64e15; // the ECMAScript Date range, either side of the epoch
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS;
}

/** Every field EXCEPT `v` matches the record shape — checked separately from
 *  `v` itself so a well-formed-but-different-version record (ruling R5: a
 *  hypothetical future v2 journal) can be told apart from a genuinely
 *  malformed one. */
function hasJournalFields(value: unknown): value is Omit<UnloadJournal, "v"> & Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.projectKey === "string" &&
    typeof rec.tabId === "string" &&
    isTimestamp(rec.savedAt) &&
    typeof rec.baseFingerprint === "string" &&
    typeof rec.workspace === "string"
  );
}

function isUnloadJournal(value: unknown): value is UnloadJournal {
  return hasJournalFields(value) && (value as Record<string, unknown>).v === 1;
}

/** Reads the journal for `projectKey`.
 *
 *  - Absent key: null, no diagnostic.
 *  - Unparseable JSON, or parsed but missing/mistyped a field OTHER than `v`:
 *    "malformed" — null, removes the key, logs `workspace.unloadJournalCorrupt`.
 *  - Parses, has every field but `v !== 1` (ruling R5 — a well-formed record
 *    from a version this build doesn't know, e.g. a future v2): null, but the
 *    key is LEFT IN PLACE untouched and nothing is logged — it isn't this
 *    build's to delete.
 *  - `v === 1` and every field matches: the record. */
export function readUnloadJournal(projectKey: string): UnloadJournal | null {
  if (typeof window === "undefined") return null;
  const key = journalKey(projectKey);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!hasJournalFields(parsed)) {
      window.localStorage.removeItem(key);
      logDiag("warn", "workspace.unloadJournalCorrupt", { projectKey });
      return null;
    }
    if (parsed.v !== 1) return null;
    return parsed as UnloadJournal;
  } catch (err) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* best effort — still report below */
    }
    logDiag("warn", "workspace.unloadJournalCorrupt", {
      projectKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Removes the journal for `projectKey`.
 *
 *  - No `guard` (the Discard path, or a plain cleanup): removes unconditionally.
 *  - With `guard`: removes only when the STORED record's `tabId` matches
 *    `guard.tabId` AND its `savedAt` is `<= guard.ifSavedAtAtMost` — so a
 *    confirmed save only ever clears the journal entry IT wrote (or an older
 *    one from the same tab), never a different tab's newer write or a
 *    different tab's write at all.
 *
 *  Returns true when it removed a record (an unguarded clear always reports
 *  true), false when it left the key as it was. */
export function clearUnloadJournal(
  projectKey: string,
  guard?: { tabId: string; ifSavedAtAtMost: number },
): boolean {
  if (typeof window === "undefined") return false;
  const key = journalKey(projectKey);
  try {
    if (!guard) {
      window.localStorage.removeItem(key);
      return true;
    }
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (
      isUnloadJournal(parsed) &&
      parsed.tabId === guard.tabId &&
      parsed.savedAt <= guard.ifSavedAtAtMost
    ) {
      window.localStorage.removeItem(key);
      return true;
    }
    return false;
  } catch {
    /* a guarded clear that can't read the existing record leaves it in
       place rather than guessing — never throws either way */
    return false;
  }
}

// --- Other keys: list and expire (§632) --------------------------------

/** A journal under a key nothing loads again (a project deleted in another tab, a key changed by
 *  the migration to Turso) is otherwise never removed. Past this age it is expired. */
export const UNLOAD_JOURNAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Every readable v1 journal in storage. `projectKey` is the storage key's suffix — what
 *  `readUnloadJournal` / `clearUnloadJournal` take — whatever the record itself says. A record whose
 *  `v` is a number other than 1 (another version's, whatever its fields) is skipped and left in place;
 *  anything else is read through `readUnloadJournal`, so a malformed record is removed and logged. */
export function listUnloadJournals(): UnloadJournal[] {
  if (typeof window === "undefined") return [];
  const projectKeys: string[] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(UNLOAD_JOURNAL_PREFIX)) projectKeys.push(key.slice(UNLOAD_JOURNAL_PREFIX.length));
    }
  } catch {
    return [];
  }
  const journals: UnloadJournal[] = [];
  for (const projectKey of projectKeys) {
    if (isOtherVersion(projectKey)) continue;
    const journal = readUnloadJournal(projectKey);
    if (journal !== null) journals.push({ ...journal, projectKey });
  }
  return journals;
}

/** True when the key holds a JSON object whose `v` is a number other than 1. Never throws. */
function isOtherVersion(projectKey: string): boolean {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(journalKey(projectKey)) ?? "null");
    if (!parsed || typeof parsed !== "object") return false;
    const v = (parsed as Record<string, unknown>).v;
    return typeof v === "number" && v !== 1;
  } catch {
    return false;
  }
}

/** Removes every journal older than `UNLOAD_JOURNAL_MAX_AGE_MS` at `now`, except the one under
 *  `keepProjectKey` (the key in scope, which the load's restore handles) and one dated after `now`
 *  (clock skew). Each removal is guarded to the record listed and logged as
 *  `workspace.unloadJournalExpired`; returns the records removed, so the caller can say so. */
export function expireUnloadJournals(now: number, keepProjectKey: string): UnloadJournal[] {
  const expired: UnloadJournal[] = [];
  for (const journal of listUnloadJournals()) {
    if (journal.projectKey === keepProjectKey) continue;
    if (now - journal.savedAt <= UNLOAD_JOURNAL_MAX_AGE_MS) continue;
    if (!clearUnloadJournal(journal.projectKey, { tabId: journal.tabId, ifSavedAtAtMost: journal.savedAt })) continue;
    logDiag("info", "workspace.unloadJournalExpired", {
      projectKey: journal.projectKey, savedAt: journal.savedAt, size: journal.workspace.length,
    });
    expired.push(journal);
  }
  return expired;
}
