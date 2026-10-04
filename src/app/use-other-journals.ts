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
//
// Only keys whose restore RAN on this page are left out of the list (`restoredKeys` from
// use-unload-journal.ts): a load that skips it (an incomplete load) or a project op (switch, create,
// which loads without a restore) leaves its key's journal listed; reloading the page with that
// project open restores it. Records this page wrote itself are left out too: they are this
// session's, not an earlier one's. A project's KEPT slot (§4, `keptProjectKey`: a version left behind
// while its saves were refused as stale) is always listed, whichever tab wrote it: no restore reads that
// slot, so Download / Discard here are its only way out. The key in scope is never expired (its kept
// slot is a different key, so it is).

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadJson } from "./download-json";
import { loadRegistry } from "./projects-registry";
import { clearUnloadJournal, expireUnloadJournals, isKeptProjectKey, journalKeyProject, listUnloadJournals, type UnloadJournal } from "./unload-journal";
import { UNLOAD_JOURNAL_TAB_ID } from "./use-unload-journal";

export type OtherJournal = {
  journal: UnloadJournal;
  /** The registry project's name for the key, or null (a Turso id, `browser`, `turso`) — the notice
   *  then shows the key, with `browser` and `turso` translated. */
  label: string | null;
};

export type UseOtherJournalsArgs = {
  /** The journal key in scope — never expired. */
  projectKey: string;
  /** Keys whose restore ran on this page — never listed. */
  restoredKeys: ReadonlySet<string>;
  /** True once the first load for `projectKey` has applied (so its restore has run). */
  enabled: boolean;
  isPopout: boolean;
};

function toEntry(journal: UnloadJournal): OtherJournal {
  const projectId = journalKeyProject(journal.projectKey); // §4 — a kept slot is labelled with its project
  return { journal, label: loadRegistry().projects.find((p) => p.id === projectId)?.name ?? null };
}

/** The download's file name. The key never holds a credential (see `journalProjectKey`); anything
 *  outside a safe file-name alphabet is replaced anyway. */
export function otherJournalFileName(journal: UnloadJournal): string {
  const safeKey = journal.projectKey.replace(/[^A-Za-z0-9_-]/g, "_");
  const day = new Date(journal.savedAt).toISOString().slice(0, 10);
  return `aipm-cockpit-unsaved-${safeKey}-${day}.json`;
}

export function useOtherJournals({ projectKey, restoredKeys, enabled, isPopout }: UseOtherJournalsArgs) {
  const active = enabled && !isPopout;
  const [others, setOthers] = useState<OtherJournal[]>([]);
  const [expired, setExpired] = useState<OtherJournal[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const sweptRef = useRef(false);

  /** Re-reads the list from storage: every journal except those under a key whose restore ran on this
   *  page (use-unload-journal.ts owns those) and those this page wrote. Newest first. */
  const relist = useCallback((): void => {
    setOthers(listUnloadJournals()
      .filter((j) => isKeptProjectKey(j.projectKey) || (!restoredKeys.has(j.projectKey) && j.tabId !== UNLOAD_JOURNAL_TAB_ID)) // §4 — a KEPT slot is listed whoever wrote it: no restore ever reads it, so this list is its only way out
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(toEntry));
  }, [restoredKeys]);

  useEffect(() => {
    if (!active) return;
    if (!sweptRef.current) {
      sweptRef.current = true;
      setExpired(expireUnloadJournals(Date.now(), projectKey).map(toEntry));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a read of localStorage, re-run when the key in scope or the restored keys change
    relist();
  }, [active, projectKey, relist]);

  /** Removes the record the entry describes — not a later write under the same key. When the key now
   *  holds a different record (another tab rewrote it), the list is re-read so that record shows. */
  const discard = useCallback((entry: OtherJournal): void => {
    const { journal } = entry;
    if (clearUnloadJournal(journal.projectKey, { tabId: journal.tabId, ifSavedAtAtMost: journal.savedAt })) {
      setOthers((list) => list.filter((e) => e !== entry));
    } else {
      relist();
    }
  }, [relist]);

  /** §655 — a kept slot of the project IN SCOPE can be put back (use-storage-backend.ts does it).
   *  Another project's kept slot cannot: its data would land in the wrong project. A plain draft is
   *  restored by reloading with its project open, as before. */
  const isRestorable = useCallback((entry: OtherJournal): boolean => (
    isKeptProjectKey(entry.journal.projectKey) && journalKeyProject(entry.journal.projectKey) === projectKey
  ), [projectKey]);

  /** §655 — after a restore: removes the record the entry describes (as Discard does) and re-reads
   *  the list, which now holds the version kept in its place. */
  const restored = useCallback((entry: OtherJournal): void => {
    const { journal } = entry;
    clearUnloadJournal(journal.projectKey, { tabId: journal.tabId, ifSavedAtAtMost: journal.savedAt });
    relist();
  }, [relist]);

  /** Downloads the entry's workspace JSON as listed (or as it was when it expired). False when the
   *  browser refused. */
  const download = useCallback((entry: OtherJournal): boolean => (
    downloadJson(otherJournalFileName(entry.journal), entry.journal.workspace)
  ), []);

  // ★ NOT gated on `active`: a later load that fails or is refused must not hide an expiry that already
  //   happened, nor the list, for the rest of the page. (A popout never fills either: it is never active.)
  return {
    /** Shown until dismissed for this page; the records stay in storage. */
    others: dismissed ? [] : others,
    /** The records the sweep removed, kept in memory so the notice can name them and still offer
     *  Download until it is dismissed. */
    expired,
    discard,
    download,
    isRestorable,
    restored,
    dismiss: useCallback(() => setDismissed(true), []),
    dismissExpired: useCallback(() => setExpired([]), []),
  };
}
