// src/app/use-other-journals.ts
//
// §632 — unload journals under keys other than the one in scope. A key nothing loads again (a
// project deleted or archived in another tab, a key the migration to Turso replaced) would keep
// its journal forever, up to UNLOAD_JOURNAL_MAX_CHARS each, in the origin's shared quota. So once
// per page, after the first load has run its own restore:
//
// - journals older than UNLOAD_JOURNAL_MAX_AGE_MS are expired (logged, and counted for a notice);
// - the rest are listed for a notice that offers Download (the record's workspace JSON, which the
//   Step 0 import reads) and Discard. The list is re-read when the key in scope changes.
//
// Nothing is removed without the user being told: an expiry is announced, a Discard is a click.

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadJson } from "./download-json";
import { loadRegistry } from "./projects-registry";
import { clearUnloadJournal, expireUnloadJournals, listUnloadJournals, type UnloadJournal } from "./unload-journal";

export type OtherJournal = {
  journal: UnloadJournal;
  /** The registry project's name for the key, or the key itself (a Turso id, `browser`, `turso`). */
  label: string;
};

export type UseOtherJournalsArgs = {
  /** The journal key in scope — never listed, never expired. */
  projectKey: string;
  /** True once the first load for `projectKey` has applied (so its restore has run). */
  enabled: boolean;
  isPopout: boolean;
};

function labelFor(projectKey: string): string {
  return loadRegistry().projects.find((p) => p.id === projectKey)?.name ?? projectKey;
}

/** The download's file name. The key never holds a credential (see `journalProjectKey`); anything
 *  outside a safe file-name alphabet is replaced anyway. */
export function otherJournalFileName(journal: UnloadJournal): string {
  const safeKey = journal.projectKey.replace(/[^A-Za-z0-9_-]/g, "_");
  const day = new Date(journal.savedAt).toISOString().slice(0, 10);
  return `aipm-cockpit-unsaved-${safeKey}-${day}.json`;
}

export function useOtherJournals({ projectKey, enabled, isPopout }: UseOtherJournalsArgs) {
  const active = enabled && !isPopout;
  const [others, setOthers] = useState<OtherJournal[]>([]);
  const [expiredCount, setExpiredCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const sweptRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (!sweptRef.current) {
      sweptRef.current = true;
      setExpiredCount(expireUnloadJournals(Date.now(), projectKey).length);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a read of localStorage, re-run when the key in scope changes
    setOthers(listUnloadJournals()
      .filter((j) => j.projectKey !== projectKey)
      .sort((a, b) => b.savedAt - a.savedAt)
      .map((journal) => ({ journal, label: labelFor(journal.projectKey) })));
  }, [active, projectKey]);

  /** Removes the record the entry describes — not a later write under the same key — and the entry. */
  const discard = useCallback((entry: OtherJournal): void => {
    const { journal } = entry;
    clearUnloadJournal(journal.projectKey, { tabId: journal.tabId, ifSavedAtAtMost: journal.savedAt });
    setOthers((list) => list.filter((e) => e !== entry));
  }, []);

  /** Downloads the entry's workspace JSON as listed. False when the browser refused. */
  const download = useCallback((entry: OtherJournal): boolean => (
    downloadJson(otherJournalFileName(entry.journal), entry.journal.workspace)
  ), []);

  return {
    /** Shown until dismissed for this page; the records stay in storage. */
    others: active && !dismissed ? others : [],
    expiredCount: active ? expiredCount : 0,
    discard,
    download,
    dismiss: useCallback(() => setDismissed(true), []),
    dismissExpired: useCallback(() => setExpiredCount(0), []),
  };
}
