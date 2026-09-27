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
// - `noteSaveConfirmed` — called from the save's `.then`: clears the journal
//   this tab wrote for that save (or an older one) and rolls the base forward.
// - `setBase` — called where a load is applied, with what the backend returned
//   and the key of the target it was loaded from; `holdBase` / `adoptHeldBase`
//   — the same for a project op, whose target key is not in scope yet when it
//   applies (see `holdBase`).
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

/** The journal's workspace, or null when it does not decode — logged, and the key left in place. */
function journalWorkspace(journal: UnloadJournal): Workspace | null {
  try {
    return jsonToWorkspace(journal.workspace);
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

type Unconfirmed = { projectKey: string; workspace: Workspace; savedAt: number };

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
};

export function useUnloadJournal({ projectKey, enabled, isPopout }: UseUnloadJournalArgs) {
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

  const noteSaveStarted = useCallback((outgoing: Workspace): number => {
    const savedAt = nextSavedAt();
    if (!activeRef.current) return savedAt;
    const entry: Unconfirmed = { projectKey: projectKeyRef.current, workspace: outgoing, savedAt };
    latestUnconfirmedRef.current = entry;
    inFlightRef.current.set(savedAt, entry.projectKey);
    if (isPageHiding() || document.visibilityState === "hidden") write(entry);
    return savedAt;
  }, [write]);

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
    replaceBase({ projectKey: key, workspace: ws, savedAt: lastSavedAt, fingerprint: null });
  }, [replaceBase]);

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
    replaceBase({ projectKey: key, workspace: held.workspace, savedAt: held.savedAt, fingerprint: null });
  }, [replaceBase]);

  const baseFingerprint = useCallback((): string => baseFingerprintFor(projectKeyRef.current), [baseFingerprintFor]);

  /** The journal the last restore found and could not apply (its base did not match) — see `ConflictRecord`. */
  const [conflictRecord, setConflictRecord] = useState<ConflictRecord | null>(null);

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
    if (journal === null || restored === null) {
      setConflictRecord(null);
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
    noteSaveStarted, noteSaveConfirmed, baseFingerprint, setBase, holdBase, adoptHeldBase,
    restoreOnLoad, restoreConflict, discardConflict, conflict,
  };
}
