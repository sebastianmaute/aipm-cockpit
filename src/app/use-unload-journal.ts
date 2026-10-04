// src/app/use-unload-journal.ts
//
// §629 — WHEN the unload journal is written, cleared and restored. The record format, key, fingerprint and the never-throw
// storage calls live in unload-journal.ts; this hook owns only WHEN they run:
//
// - `noteSaveStarted` — called by `doSave` (use-storage-backend.ts) at the one
//   point where `backend.save` is about to fire, i.e. past every save guard. It
//   always remembers the outgoing workspace as the latest UNCONFIRMED one, and
//   writes the journal at once when the page is hiding or hidden: that save
//   cannot be relied on to land before the page goes away.
// - this hook's own `pagehide` listener — writes the latest unconfirmed
//   workspace, so a save that fired while the page was still visible and has
//   not confirmed yet is not lost either.
// - `followLive` — §4: while saving is paused on a conflict, the live workspace
//   in place of a save that never starts. Dropped when its key's base moves
//   (`boundToBase`). `followLive(ws, true)` and `noteSaveRefused` write a
//   version the user left behind to the project's KEPT slot (`keep`), a key
//   nothing on this list reads, clears or overwrites.
// - `noteSaveConfirmed` — called from the save's `.then`: clears the journal
//   this tab wrote for that save (or an older one) and rolls the base forward.
// - `setBase` — called where a load is applied, with what the backend returned
//   and the key of the target it was loaded from; `holdBase` / `adoptHeldBase`
//   — the same for a project op, whose target key is not in scope yet when it
//   applies (see `holdBase`).
// - `dropUnconfirmed` — called by "Reload project" and by the picker's "load
//   the file instead", which both discard the in-memory state: forgets this
//   tab's unconfirmed saves for that key.
// - `restoreOnLoad` — called by the load effect between a load that passed every
//   gate and its apply: a journal whose content IS the loaded workspace is cleared
//   silently (its save landed), else the journal on a base match, else a published
//   conflict that `restoreConflict` (Restore anyway) or `discardConflict` (Discard)
//   resolves — Restore anyway from an in-memory copy of the record the notice describes,
//   Discard removing the key only while it still holds that record.
//
// See docs/superpowers/specs/2026-09-27-unload-journal-design.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { isPageHiding } from "./debounced-save";
import { logDiag } from "./diagnostics";
import { loadRegistry } from "./projects-registry";
import {
  clearUnloadJournal,
  fingerprintWorkspace,
  JOURNAL_FINGERPRINT_UNSTABLE_KINDS,
  journalProjectKey,
  keptProjectKey,
  readUnloadJournal,
  writeUnloadJournal,
  type UnloadJournal,
} from "./unload-journal";
import { jsonToWorkspace, workspaceToJson, type StorageKind, type Workspace } from "./workspace";

function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/** Identifies THIS page load. Minted once at module load, so it is stable for
 *  the life of the page and differs on every reload — a confirmed save clears
 *  only a journal carrying this id (ruling R1), never one an earlier page left. */
export const UNLOAD_JOURNAL_TAB_ID = newTabId();

// Strictly increasing per tab, even when `Date.now()` does not move between
// two saves (the clear guard and the base roll-forward both compare these).
let lastSavedAt = 0;
function nextSavedAt(): number {
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  return lastSavedAt;
}

/** Ruling R3 — re-writes an APPLIED journal under this page's tab id, its savedAt kept, so the
 *  confirmation of its save-back (a later savedAt from this tab) clears it through the guard in
 *  `clearUnloadJournal`; left under the earlier page's id it would never clear. Lifts the savedAt
 *  counter to it as well, so that save-back is later even if the earlier page's clock ran ahead. */
function retagToThisTab(journal: UnloadJournal): void {
  lastSavedAt = Math.max(lastSavedAt, journal.savedAt);
  const { projectKey, savedAt, baseFingerprint, workspace } = journal;
  writeUnloadJournal({ projectKey, tabId: UNLOAD_JOURNAL_TAB_ID, savedAt, baseFingerprint, workspace });
}

/** The journal's workspace, or null when it does not decode — logged, and the key left in place.
 *  ★★ STRICT, always (§668). Lenient, `jsonToWorkspace` answers unparseable text — or JSON that is not
 *  an object — with an EMPTY workspace instead of a throw, so a corrupt journal used to be APPLIED as an
 *  empty project: by the load restore with no click when its base matched, by "Restore anyway" when it
 *  did not. Every caller here applies what it gets, so none may decode leniently. */
/** §668 — one record's identity: its key, writer and save time (what `clearUnloadJournal` guards on too). */
export function journalRecordId(journal: UnloadJournal): string {
  return `${journal.projectKey}|${journal.tabId}|${journal.savedAt}`;
}

export function journalWorkspace(journal: UnloadJournal): Workspace | null {
  try {
    // ★★ NO `diag`, deliberately: with one, a documents / documentVersions sanitizer throw would be
    // CONTAINED (those slices dropped) and the journal applied without them, and its save would then
    // write the project without documents over the stored ones. Without one, strict throws and the
    // whole journal is refused: stored documents stay intact and the record stays downloadable.
    return jsonToWorkspace(journal.workspace, { strict: true });
  } catch (err) {
    logDiag("warn", "workspace.unloadJournalCorrupt", {
      projectKey: journal.projectKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The journal's `projectKey` for the storage target in scope. Reads the
 *  projects registry, so the caller memoises it per backend rather than
 *  calling it on every render. */
export function resolveJournalProjectKey(storageKind: StorageKind, tursoProjectId: string | null): string {
  return journalProjectKey(storageKind, tursoProjectId, loadRegistry().currentProjectId);
}

/** `boundToBase` (§4): the live workspace of a conflict pause (`followLive`). Its record is
 *  written against the base the key has NOW, so once that base moves (a load or op of the key brings
 *  in the other writer's version) the entry is dropped: re-based, it would restore silently over it. */
type Unconfirmed = { projectKey: string; workspace: Workspace; savedAt: number; boundToBase?: true };

/** The record a conflict notice describes, kept IN MEMORY as the restore read it: its key, the
 *  record itself (its `tabId` + `savedAt` identify it) and its decoded workspace. Restore anyway
 *  applies this copy, so a later write to the key cannot take it away while the notice shows. */
type ConflictRecord = { key: string; journal: UnloadJournal; workspace: Workspace };

/** True while the key still holds the record `c` names — a later write (this tab's own
 *  hidden-tab or pagehide write, or another tab's) is a different record. */
function keyStillHolds(c: ConflictRecord): boolean {
  const stored = readUnloadJournal(c.key);
  return stored !== null && stored.tabId === c.journal.tabId && stored.savedAt === c.journal.savedAt;
}

/** The last confirmed state of `projectKey`. `savedAt` is the confirmed save's
 *  own savedAt, or — for a base set from a load — the latest savedAt issued at
 *  that moment (for an op, the moment it was held); only a save started AFTER it
 *  can replace it. The fingerprint is warmed when the page is idle, or computed
 *  at the first journal write if the warm-up has not run by then. */
type Base = { projectKey: string; workspace: Workspace; savedAt: number; fingerprint: string | null };

/** Runs `fn` when the page is idle (`requestIdleCallback`), or on a zero-delay
 *  timer where that API is absent. Used to take the base fingerprint off the
 *  unload path; the lazy computation at write time stays as the fallback. */
function whenIdle(fn: () => void): void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn());
    return;
  }
  setTimeout(fn, 0);
}

export type UseUnloadJournalArgs = {
  projectKey: string;
  /** False before hydration: no save is recorded, so nothing is written. */
  enabled: boolean;
  /** A popout never saves, so it never journals either. */
  isPopout: boolean;
  /** §668 — told when the load restore finds a journal for the key that does not decode. Nothing is
   *  applied; the record stays, listed in the other-journals notice (Download / Discard). */
  onUnreadable?: () => void;
};

export function useUnloadJournal({ projectKey, enabled, isPopout, onUnreadable }: UseUnloadJournalArgs) {
  const onUnreadableRef = useRef(onUnreadable);
  useEffect(() => { onUnreadableRef.current = onUnreadable; }, [onUnreadable]);
  // ★ Synced in an EFFECT, not during render, on purpose: the storage hook's save-effect
  //   CLEANUP can flush a save (§589) in the same commit that switches the target, and React
  //   runs every cleanup before any effect body — so that flush still reads the OLD key, the
  //   one its workspace belongs to.
  const projectKeyRef = useRef(projectKey);
  const activeRef = useRef(enabled && !isPopout);
  useEffect(() => { projectKeyRef.current = projectKey; }, [projectKey]);
  useEffect(() => { activeRef.current = enabled && !isPopout; }, [enabled, isPopout]);

  const baseRef = useRef<Base | null>(null);
  /** A project op's applied workspace, waiting for its target's key — see `holdBase`. */
  const heldBaseRef = useRef<{ workspace: Workspace; savedAt: number } | null>(null);
  const latestUnconfirmedRef = useRef<Unconfirmed | null>(null);
  /** savedAt → projectKey of each save started and not yet confirmed, so a confirmation
   *  clears the key its save was journaled under even after a project switch. */
  const inFlightRef = useRef(new Map<number, string>());

  const baseFingerprintFor = useCallback((key: string): string => {
    const base = baseRef.current;
    if (base === null || base.projectKey !== key) return "";
    if (base.fingerprint !== null) return base.fingerprint;
    const fingerprint = fingerprintWorkspace(base.workspace);
    baseRef.current = { ...base, fingerprint };
    return fingerprint;
  }, []);

  /** Replaces the base and warms its fingerprint when the page is idle. The warm-up
   *  writes only if `next` is STILL the base by then (identity): a newer base, or the
   *  lazy fill above, replaces the object, and the stale warm-up does nothing. */
  const replaceBase = useCallback((next: Base): void => {
    baseRef.current = next;
    whenIdle(() => {
      if (baseRef.current !== next) return;
      baseRef.current = { ...next, fingerprint: fingerprintWorkspace(next.workspace) };
    });
  }, []);

  const write = useCallback((entry: Unconfirmed): void => {
    let workspace: string;
    try {
      workspace = workspaceToJson(entry.workspace);
    } catch (err) {
      logDiag("warn", "workspace.unloadJournalSkipped", {
        projectKey: entry.projectKey,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    writeUnloadJournal({
      projectKey: entry.projectKey,
      tabId: UNLOAD_JOURNAL_TAB_ID,
      savedAt: entry.savedAt,
      baseFingerprint: () => baseFingerprintFor(entry.projectKey), // a thunk: skipped over the cap
      workspace,
    });
  }, [baseFingerprintFor]);

  /** §4 — writes a version the user LEFT (a switch away, or a rebuild, while its saves were refused as
   *  stale) at once to the project's KEPT slot (`keptProjectKey`). Nothing restores from that slot, so
   *  its base is "". An unresolved kept record there is never replaced: after a return the live
   *  workspace is built on the other writer's version, not on the kept one, so replacing it would lose
   *  edits the user has not seen since. The newer version gets a numbered kept slot of its own — never
   *  the project's own slot, where this tab's next confirmation or "Reload project" would clear it.
   *  Returns whether the record was WRITTEN (final review I2): over the cap, on a quota error or a codec
   *  throw it is not, and a caller about to leave the project must not then leave. */
  const keep = useCallback((entry: Unconfirmed): boolean => {
    const slot = readUnloadJournal(keptProjectKey(entry.projectKey)) === null ? keptProjectKey(entry.projectKey) : keptProjectKey(entry.projectKey, entry.savedAt);
    let workspace: string;
    try {
      workspace = workspaceToJson(entry.workspace);
    } catch (err) {
      logDiag("warn", "workspace.unloadJournalSkipped", { projectKey: entry.projectKey, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
    return writeUnloadJournal({ projectKey: slot, tabId: UNLOAD_JOURNAL_TAB_ID, savedAt: entry.savedAt, baseFingerprint: "", workspace });
  }, []);

  /** §655 — keeps the LIVE workspace of the key in scope in a kept slot before a kept version is
   *  restored over it, so that restore can be undone from the same notice. Same write as `keep`, so
   *  the same outcome: false when nothing was written, and the caller must then not restore. */
  const keepLive = useCallback((live: Workspace): boolean => keep({ projectKey: projectKeyRef.current, workspace: live, savedAt: Date.now() }), [keep]);

  const noteSaveStarted = useCallback((outgoing: Workspace): number => {
    const savedAt = nextSavedAt();
    if (!activeRef.current) return savedAt;
    const entry: Unconfirmed = { projectKey: projectKeyRef.current, workspace: outgoing, savedAt };
    latestUnconfirmedRef.current = entry;
    inFlightRef.current.set(savedAt, entry.projectKey);
    if (isPageHiding() || document.visibilityState === "hidden") write(entry);
    return savedAt;
  }, [write]);

  /** §4 — while saving is paused on a conflict no save starts, so `noteSaveStarted` never runs: the
   *  storage hook hands the LIVE workspace here instead. It becomes the latest unconfirmed one, which
   *  pagehide writes (`boundToBase`); no in-flight entry, as no save's confirmation could clear it.
   *  `now` — the pre-switch flush, which leaves the key behind — `keep`s it instead, and consumes the
   *  pause's entry for the key: re-written at pagehide after a return, it would be re-based.
   *  Returns `false` only when `now` and the kept record could NOT be written (`keep`). */
  const followLive = useCallback((live: Workspace, now = false): boolean => {
    if (!activeRef.current) return true; // a pop-out, or before hydration: there is no journal to keep in
    const entry: Unconfirmed = { projectKey: projectKeyRef.current, workspace: live, savedAt: nextSavedAt(), boundToBase: true };
    if (now) {
      // Final re-review r1: consume the pause's entry only once the kept record is WRITTEN. A failed keep
      // refuses the switch, and the user stays paused here: pagehide must still find that entry.
      const kept = keep(entry);
      if (kept && latestUnconfirmedRef.current?.projectKey === entry.projectKey) latestUnconfirmedRef.current = null;
      return kept;
    }
    latestUnconfirmedRef.current = entry;
    if (isPageHiding() || document.visibilityState === "hidden") write(entry);
    return true;
  }, [keep, write]);

  /** §4 — the save `savedAt` was refused as stale after its backend was replaced (a settings rebuild or a
   *  project op): nothing confirms it, and the next load re-bases whatever entry it left, so the entry
   *  goes. `refused` — its workspace, when no flush kept it already — is `keep`t under the key the save
   *  was started for. Returns `false` only when `refused` had to be kept and could not be (`keep`). */
  const noteSaveRefused = useCallback((savedAt: number, refused: Workspace | null): boolean => {
    if (!activeRef.current) return true;
    const key = inFlightRef.current.get(savedAt) ?? projectKeyRef.current;
    inFlightRef.current.delete(savedAt);
    if (latestUnconfirmedRef.current?.savedAt === savedAt) latestUnconfirmedRef.current = null;
    return refused === null || keep({ projectKey: key, workspace: refused, savedAt });
  }, [keep]);

  /** §4 — `key`'s base is about to move: an entry bound to the old one goes (see `boundToBase`). */
  const dropBoundEntry = useCallback((key: string): void => {
    const latest = latestUnconfirmedRef.current;
    if (latest?.boundToBase === true && latest.projectKey === key) latestUnconfirmedRef.current = null;
  }, []);

  const noteSaveConfirmed = useCallback((savedAt: number, confirmed: Workspace): void => {
    const key = inFlightRef.current.get(savedAt);
    if (key === undefined) return;
    // An older save of the same project confirming later could not clear anything this one
    // has not already cleared, nor move the base (it is not newer), so its entry goes too.
    for (const [at, k] of inFlightRef.current) {
      if (at <= savedAt && k === key) inFlightRef.current.delete(at);
    }
    clearUnloadJournal(key, { tabId: UNLOAD_JOURNAL_TAB_ID, ifSavedAtAtMost: savedAt });
    const latest = latestUnconfirmedRef.current;
    if (latest !== null && latest.savedAt <= savedAt) latestUnconfirmedRef.current = null;
    // Roll forward only for the project in scope, and never back to an older save.
    if (key !== projectKeyRef.current) return;
    const base = baseRef.current;
    if (base !== null && base.projectKey === key && savedAt <= base.savedAt) return;
    replaceBase({ projectKey: key, workspace: confirmed, savedAt, fingerprint: null });
  }, [replaceBase]);

  /** The base for a load: `ws` is what the backend returned, `key` the journal key of
   *  the target it came from — passed by the caller, never read from scope, so the pair
   *  is always one target's. Drops any held op base. */
  const setBase = useCallback((ws: Workspace, key: string): void => {
    heldBaseRef.current = null;
    dropBoundEntry(key);
    replaceBase({ projectKey: key, workspace: ws, savedAt: lastSavedAt, fingerprint: null });
  }, [dropBoundEntry, replaceBase]);

  /** ★★★ §629 fix round 1 (I1) — A PROJECT OP APPLIES BEFORE IT FLIPS THE TARGET. The
   *  switch / create / open ops apply the new workspace, THEN set the storage config or
   *  Turso project id (the §77 order, use-storage-backend.ts's load effect), so no key in
   *  scope at apply time is the target's. The op's workspace is therefore held with NO key
   *  until `adoptHeldBase`.
   *  ★★ Ruling R7 — and the live base is dropped meanwhile: scope no longer holds the
   *  workspace it describes. A journal written in that window (an op that fails between its
   *  apply and its flip) carries base "", which no fingerprint equals, so it restores as the
   *  conflict notice, never as a match. */
  const holdBase = useCallback((ws: Workspace): void => {
    heldBaseRef.current = { workspace: ws, savedAt: lastSavedAt };
    baseRef.current = null;
  }, []);

  /** Keys the held op base — called by the load effect's suppress branch, the one run of
   *  the render whose backend IS the op's target, with that render's key. No held base: no-op. */
  const adoptHeldBase = useCallback((key: string): void => {
    const held = heldBaseRef.current;
    if (held === null) return;
    heldBaseRef.current = null;
    dropBoundEntry(key);
    replaceBase({ projectKey: key, workspace: held.workspace, savedAt: held.savedAt, fingerprint: null });
  }, [dropBoundEntry, replaceBase]);

  /** "Reload project" (and the picker's "load the file instead", `applyPickedWorkspace`) DISCARDS
   *  the in-memory state, so this tab's unconfirmed saves for `key` go
   *  with it: kept, a save that FAILED would be written at pagehide over the reloaded base, and the
   *  next load would find that base unchanged and restore the discarded state silently. The stored
   *  record goes only while it is THIS tab's (the tab-id guard): an earlier page's record, such as
   *  the conflict the notice describes, stays, and so does the notice's in-memory copy. */
  const dropUnconfirmed = useCallback((key: string): void => {
    const latest = latestUnconfirmedRef.current;
    if (latest !== null && latest.projectKey === key) latestUnconfirmedRef.current = null;
    for (const [at, k] of inFlightRef.current) {
      if (k === key) inFlightRef.current.delete(at);
    }
    clearUnloadJournal(key, { tabId: UNLOAD_JOURNAL_TAB_ID, ifSavedAtAtMost: lastSavedAt });
  }, []);

  const baseFingerprint = useCallback((): string => baseFingerprintFor(projectKeyRef.current), [baseFingerprintFor]);

  /** The journal the last restore found and could not apply (its base did not match) — see `ConflictRecord`. */
  const [conflictRecord, setConflictRecord] = useState<ConflictRecord | null>(null);
  /** §632 — every key `restoreOnLoad` ran for on this page. use-other-journals.ts leaves these out of
   *  its list: their journal was applied, cleared, or published as the conflict notice. */
  const [restoredKeys, setRestoredKeys] = useState<ReadonlySet<string>>(() => new Set());
  /** §668 — the RECORDS (`journalRecordId`) the load restore found undecodable on this page, so the notice
   *  can say they cannot be restored (reloading only fails again). Per record, not per key: a readable
   *  record another tab writes later under the same key is not marked. */
  const [unreadableRecords, setUnreadableRecords] = useState<ReadonlySet<string>>(() => new Set());

  /** The restore. `loaded` is what a load that passed every gate returned, `key` the journal key
   *  of the target it came from. First, a journal whose CONTENT fingerprints as `loaded` describes
   *  what is stored — its save landed, only its `.then` never ran — so it is cleared, unguarded,
   *  with nothing applied and no notice. Otherwise returns the journal's workspace to apply INSTEAD
   *  when the journal's base equals `loaded`'s fingerprint (ruling R8: `===` only — a base of ""
   *  never matches), re-tagged per R3. Otherwise null: on a mismatch, or a kind in
   *  `JOURNAL_FINGERPRINT_UNSTABLE_KINDS`, the journal is kept and the conflict published. A popout
   *  (or a disabled hook) never restores. */
  const restoreOnLoad = useCallback((loaded: Workspace, key: string, kind: StorageKind): Workspace | null => {
    if (!activeRef.current) return null;
    const journal = readUnloadJournal(key);
    const restored = journal === null ? null : journalWorkspace(journal);
    // §668 — an UNDECODABLE journal stays out of `restoredKeys`, so the other-journals notice lists it
    // with Download and Discard. Nothing else would ever remove it: a confirmed save clears only this
    // tab's records, and the key in scope never expires.
    if (journal === null || restored !== null) setRestoredKeys((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    if (journal === null || restored === null) {
      setConflictRecord(null);
      if (journal !== null) {
        onUnreadableRef.current?.(); // §668 — refused, and said so
        const id = journalRecordId(journal);
        setUnreadableRecords((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
      }
      return null;
    }
    const loadedFingerprint = fingerprintWorkspace(loaded);
    if (fingerprintWorkspace(restored) === loadedFingerprint) {
      clearUnloadJournal(key);
      setConflictRecord(null);
      return null;
    }
    const comparable = !JOURNAL_FINGERPRINT_UNSTABLE_KINDS.includes(kind);
    if (comparable && journal.baseFingerprint === loadedFingerprint) {
      retagToThisTab(journal);
      setConflictRecord(null);
      return restored;
    }
    setConflictRecord({ key, journal, workspace: restored });
    return null;
  }, []);

  /** Restore anyway: the in-memory copy of the record the notice describes, whatever the key
   *  holds now (a later write of this tab may have replaced or cleared it), re-tagged per R3 and
   *  dismissed. Null only when there is no conflict for the target in scope; the caller reports
   *  that rather than doing nothing. The caller applies it and saves it through the normal path. */
  const restoreConflict = useCallback((): Workspace | null => {
    if (conflictRecord === null || conflictRecord.key !== projectKeyRef.current) return null;
    setConflictRecord(null);
    retagToThisTab(conflictRecord.journal);
    return conflictRecord.workspace;
  }, [conflictRecord]);

  /** Discard: removes the conflicting journal, unguarded — the user chose to drop it — but only
   *  while the key still holds that record; either way it drops the in-memory copy and the notice. */
  const discardConflict = useCallback((): void => {
    if (conflictRecord === null) return;
    if (keyStillHolds(conflictRecord)) clearUnloadJournal(conflictRecord.key);
    setConflictRecord(null);
  }, [conflictRecord]);

  /** Published only while the conflicting journal's target is the one in scope. */
  const conflict = conflictRecord !== null && conflictRecord.key === projectKey && enabled && !isPopout;

  useEffect(() => {
    const onPageHide = () => {
      if (!activeRef.current) return;
      const latest = latestUnconfirmedRef.current;
      if (latest !== null) write(latest);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [write]);

  return {
    noteSaveStarted, followLive, noteSaveRefused, noteSaveConfirmed, baseFingerprint, setBase, holdBase, adoptHeldBase, dropUnconfirmed,
    restoreOnLoad, restoreConflict, discardConflict, conflict, restoredKeys, keepLive, unreadableRecords,
  };
}
