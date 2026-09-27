// src/app/use-unload-journal.ts
//
// §629 — the WRITE and CLEAR half of the unload journal (the restore on load
// is a separate step). The record format, key, fingerprint and the never-throw
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
// - `setBase` — called where a load is applied, with what the backend returned.
//
// See docs/superpowers/specs/2026-09-27-unload-journal-design.md.

import { useCallback, useEffect, useRef } from "react";
import { isPageHiding } from "./debounced-save";
import { logDiag } from "./diagnostics";
import { loadRegistry } from "./projects-registry";
import {
  clearUnloadJournal,
  fingerprintWorkspace,
  journalProjectKey,
  writeUnloadJournal,
} from "./unload-journal";
import { workspaceToJson, type StorageKind, type Workspace } from "./workspace";

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

/** The journal's `projectKey` for the storage target in scope. Reads the
 *  projects registry, so the caller memoises it per backend rather than
 *  calling it on every render. */
export function resolveJournalProjectKey(storageKind: StorageKind, tursoProjectId: string | null): string {
  return journalProjectKey(storageKind, tursoProjectId, loadRegistry().currentProjectId);
}

type Unconfirmed = { projectKey: string; workspace: Workspace; savedAt: number };

/** The last confirmed state of `projectKey`. `savedAt` is the confirmed save's
 *  own savedAt, or — for a base set from a load — the latest savedAt issued at
 *  that moment; only a save started AFTER it can replace it. The fingerprint is
 *  computed on first use, so a base replaced before any journal is written
 *  never pays for one. */
type Base = { projectKey: string; workspace: Workspace; savedAt: number; fingerprint: string | null };

function fingerprintOf(base: Base): string {
  if (base.fingerprint === null) base.fingerprint = fingerprintWorkspace(base.workspace);
  return base.fingerprint;
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
  const latestUnconfirmedRef = useRef<Unconfirmed | null>(null);
  /** savedAt → projectKey of each save started and not yet confirmed, so a confirmation
   *  clears the key its save was journaled under even after a project switch. */
  const inFlightRef = useRef(new Map<number, string>());

  const baseFingerprintFor = useCallback((key: string): string => {
    const base = baseRef.current;
    return base !== null && base.projectKey === key ? fingerprintOf(base) : "";
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
      baseFingerprint: baseFingerprintFor(entry.projectKey),
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
    baseRef.current = { projectKey: key, workspace: confirmed, savedAt, fingerprint: null };
  }, []);

  const setBase = useCallback((ws: Workspace): void => {
    baseRef.current = { projectKey: projectKeyRef.current, workspace: ws, savedAt: lastSavedAt, fingerprint: null };
  }, []);

  const baseFingerprint = useCallback((): string => baseFingerprintFor(projectKeyRef.current), [baseFingerprintFor]);

  useEffect(() => {
    const onPageHide = () => {
      if (!activeRef.current) return;
      const latest = latestUnconfirmedRef.current;
      if (latest !== null) write(latest);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [write]);

  return { noteSaveStarted, noteSaveConfirmed, baseFingerprint, setBase };
}
