// src/app/use-chat-thread-renames.ts — renaming a saved chat thread, for useChatThreads (a
// deps-object hook, AGENTS.md "Extraction conventions", rule 1): the rename itself, the rename
// outbox that keeps a draft or an unsaved rename across a page close (§626), and the server-confirmed
// name each outbox entry is based on.
//
// Holds the outbox rules (which base an edit carries, when a landed save settles it, when a replay is
// dropped), so it is coverage-gated, not excluded.
import type React from "react";
import { useEffect, useRef } from "react";
import { type Lang, t } from "./i18n";
import type { TursoConfig } from "./turso-config";
import { type ChatThread, normalizeThreadName } from "./chat-threads";
import { trackPendingEdit, settlePendingEdit, rebasePendingEdit } from "./pending-edits";
import {
  RENAME_KIND, outboxScope, takeRenameReplays, adoptConfirmedNames, type LandedWrite, type SaveGate,
} from "./chat-thread-writes";

export interface UseChatThreadRenamesDeps {
  tursoMode: boolean;
  tursoConfig: TursoConfig | null;
  projectId: string;
  lang: Lang;
  threads: ChatThread[];
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  saveGate: SaveGate | null;
  runPersist: (key: string, action: () => Promise<void>, onLanded?: (owns: boolean) => void) => void;
  /** The save of `th` to the database of `config` (the hook's `saveAction`). */
  saveAction: (config: TursoConfig | null, th: ChatThread, gate: SaveGate) => () => Promise<void>;
  /** The config a write pinned to `pinned`'s database runs with (the live one while it is the same). */
  writeConfig: (pinned: TursoConfig | null) => TursoConfig | null;
  /** Per thread id, the newest write that has landed. */
  landed: () => ReadonlyMap<string, LandedWrite>;
}

export function useChatThreadRenames(deps: UseChatThreadRenamesDeps) {
  const {
    tursoMode, tursoConfig, projectId, lang, threads, setThreads, saveGate, runPersist, saveAction, writeConfig, landed,
  } = deps;

  // §626. Per thread id, the last name the server is known to hold: set from every successful load
  // and after a save of the thread resolves. It is an outbox entry's `base`, never the optimistic
  // name in `threads` — a rename not yet landed is not what the next start's load will return, and
  // replay drops an edit whose base differs from the loaded name.
  const confirmedNamesRef = useRef<Map<string, string>>(new Map());

  // §626. The outbox scope for a Turso database (this render's unless a write pinned another, §604)
  // and this project, or null without Turso. It is read at track time, so an edit tracked before a
  // project switch stays in its own scope. A write and its scope always come from ONE config value.
  function renameScope(config: TursoConfig | null = tursoConfig): string | null {
    return tursoMode ? outboxScope(config, projectId) : null;
  }

  // §626. The base of a rename edit: the server-confirmed name, or — for a thread neither loaded nor
  // saved yet in this session — the name it was created with.
  function confirmedName(target: ChatThread): string {
    return confirmedNamesRef.current.get(target.id) ?? target.name;
  }

  // §626. A save of thread `id` carrying `name` landed, and no newer write for it has: the server now
  // holds `name`. A waiting outbox entry is re-based onto `name`, which is what the next start will
  // load. Only the write that `owns` the key settles an entry for exactly that value (value-aware: a
  // newer draft typed while the save was in flight stays); a superseded one leaves the entry to the
  // later write it still depends on.
  function confirmSavedName(scope: string | null, id: string, name: string, owns: boolean): void {
    confirmedNamesRef.current.set(id, name);
    if (!scope) return;
    // Rebase before the settle, which is the only step that can throw (it installs the flush listener).
    rebasePendingEdit(scope, RENAME_KIND, id, name);
    if (owns) settlePendingEdit(scope, RENAME_KIND, id, name);
  }

  function applyRename(target: ChatThread, name: string): void {
    const { id } = target;
    const updated: ChatThread = { ...target, name, updatedAt: new Date().toISOString() };
    setThreads((prev) => prev.map((th) => (th.id === id ? updated : th)));
    // §604. Pinned: the save and its outbox scope target the database of this call's render.
    const config = tursoConfig;
    const scope = renameScope(config);
    if (scope) trackPendingEdit(scope, { kind: RENAME_KIND, id, base: confirmedName(target), value: name });
    if (!saveGate) return;
    runPersist(id, saveAction(writeConfig(config), updated, saveGate), (owns) => confirmSavedName(scope, id, name, owns));
  }

  // §626. A load for this project has settled: its names become the confirmed ones (except where a
  // save landed after the load started, `landingsAtStart`), then the renames typed before the last
  // close are re-issued, normalized exactly as the list's commit does. Both load success branches
  // call it through a ref because neither closure can list a per-render function as a dependency.
  function namesLoaded(loaded: readonly ChatThread[], landingsAtStart: number): void {
    adoptConfirmedNames(confirmedNamesRef.current, landed(), loaded, landingsAtStart);
    const scope = outboxScope(tursoConfig, projectId);
    if (!scope) return;
    for (const { target, value } of takeRenameReplays(scope, loaded)) {
      applyRename(target, normalizeThreadName(value, t(lang, "chatThreadUntitled")));
    }
  }
  const namesLoadedRef = useRef(namesLoaded);
  useEffect(() => {
    namesLoadedRef.current = namesLoaded;
  });

  function renameThread(id: string, name: string): void {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    applyRename(target, name);
  }

  // §626. Keeps what the user wants thread `id` to be called — `wanted`, a draft or the committed
  // name — for a page close. Compared after the commit's own normalization against the
  // server-confirmed name: equal has nothing to lose, so it settles; anything else is tracked from
  // that confirmed name, so a rename still in flight is not dropped as `changed` at the next start.
  function keepRename(id: string, wanted: (target: ChatThread) => string): void {
    const scope = renameScope();
    const target = threads.find((th) => th.id === id);
    if (!scope) return;
    if (!target) {
      // The thread is gone from the list: there is nothing left to rename.
      settlePendingEdit(scope, RENAME_KIND, id);
      return;
    }
    const value = wanted(target);
    const base = confirmedName(target);
    const unchanged = value === base || normalizeThreadName(value, t(lang, "chatThreadUntitled")) === base;
    if (unchanged) settlePendingEdit(scope, RENAME_KIND, id);
    else trackPendingEdit(scope, { kind: RENAME_KIND, id, base, value });
  }

  // §626. The open rename input's draft.
  function trackRenameDraft(id: string, value: string): void {
    keepRename(id, () => value);
  }

  // §626. The draft is dropped; what is left to keep is the committed name, which differs from the
  // confirmed one while an earlier rename's save has not resolved.
  function cancelRenameDraft(id: string): void {
    keepRename(id, (target) => target.name);
  }

  return {
    renameScope, confirmSavedName, namesLoadedRef, renameThread, trackRenameDraft, cancelRenameDraft,
  };
}
