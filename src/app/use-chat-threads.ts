// src/app/use-chat-threads.ts
//
// Turso multi-thread chat state, extracted from ChatPanel as a deps-object
// hook (AGENTS.md "Extraction conventions", rule 1 — pattern origin:
// use-storage-file-ops.ts): a typed `deps` object of live render-scope
// values, called unconditionally before ChatPanel's single return, returning
// NON-memoized handlers that read live scope each render.
//
// Unlike the Phase-3 task-manager hook factories (use-calendar-integrations.ts
// etc.), this one holds real persistence/retention logic — fetch on mount and
// project switch, save-on-settle, the mid-send thread-switch guard's tracking
// ref — not render-scope UI glue, so it is deliberately NOT added to
// vitest.config.ts `coverage.exclude`. See use-view-digest.ts for the same
// precedent ("exclude glue, not logic").
//
// ChatPanel still owns: history/display/busy state, submitPrompt (incl. its
// stale()/switchedAway checks, which read this hook's `activeThreadId` and
// `threadIdRef`, and its call to `ensureThreadForSend` right after the user's
// turn is committed locally), projectIdRef, cancelledRef, abortRef, and the
// render-time seenProjectId reconcile. This hook owns only the THREAD half:
// the thread list, the active thread, fetch/save/rename/delete, the ref that
// lets an in-flight send detect it was switched away from, and the retry
// action for a failed fetch/save.
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { ApiMessage, DisplayItem } from "./chat-api";
import type { TursoConfig } from "./turso-config";
import type { ConfirmFn } from "./confirm-dialog";
import { loadThreads, saveThread, deleteThread as deleteThreadRow } from "./chat-threads-store";
import { type ChatThread, newThreadId, deriveThreadName, stripAttachmentsForPersistence } from "./chat-threads";

/** Live render-scope values the Turso thread flows read each render. */
export interface UseChatThreadsDeps {
  tursoMode: boolean;
  tursoConfig: TursoConfig | null;
  projectId: string;
  lang: Lang;
  busy: boolean;
  history: ApiMessage[];
  display: DisplayItem[];
  setHistory: React.Dispatch<React.SetStateAction<ApiMessage[]>>;
  setDisplay: React.Dispatch<React.SetStateAction<DisplayItem[]>>;
  /** ChatPanel's own refs — shared here so a thread switch and a project
   *  switch can't race each other's abort of an in-flight send. */
  cancelledRef: React.MutableRefObject<boolean>;
  abortRef: React.MutableRefObject<AbortController | null>;
  confirm: ConfirmFn;
}

export function useChatThreads(deps: UseChatThreadsDeps) {
  // Destructured to locals because react-hooks/exhaustive-deps REJECTS an
  // `obj.member` dependency (AGENTS.md) — every effect below depends on these
  // locals, never on `deps.x`.
  const {
    tursoMode, tursoConfig, projectId, lang, busy, history, display,
    setHistory, setDisplay, cancelledRef, abortRef, confirm,
  } = deps;

  // Turso-only multi-thread state. `threads` holds each thread's FULL
  // ChatThread (incl. history/display) so switching between them is instant
  // with no second Turso round-trip — see the design's "already-fetched copy"
  // note. Always empty/unused in file mode.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Read by ChatThreadSidebar to show a fetch/save/rename/delete failure
  // banner.
  const [threadsError, setThreadsError] = useState(false);
  // Holds a thunk that re-issues whatever Turso WRITE (save or delete) last
  // failed, keyed by the thread id the write targets — see runPersist.
  // retryLoad() prefers this over a fresh fetch: clicking "Retry" after a
  // failed SAVE must re-send that same payload, not pull whatever the server
  // already has (which by definition excludes the failed write) and stomp
  // the live conversation with it — that was the destructive bug this hook
  // used to have. ★ A SINGLE slot (the pre-Map shape) had a NARROWER but
  // still-destructive bug: a second failure on a DIFFERENT thread (e.g. a
  // rename landing while an earlier save's retry was still pending) silently
  // overwrote the first thread's retry thunk, so Retry only ever re-issued
  // the MOST RECENT failure and the earlier one was never retried — local
  // state diverged from the server with no way back short of losing the
  // failed write outright. Keying by id lets every distinct failure survive
  // until its own retry succeeds. Empty whenever nothing is outstanding (a
  // write just succeeded, or the only failure on record is the initial
  // FETCH, which has no payload to replay — see retryLoad).
  const pendingRetryRef = useRef<Map<string, () => void>>(new Map());
  // Mirrors the latest COMMITTED `threads` value. requestDeleteThread awaits
  // a confirm() dialog before acting — the `threads` closure captured at
  // call time is stale by the time that await resolves if anything else
  // (the busy-persist effect settling, a rename) wrote to `threads` while
  // the dialog was open. Reading this ref afterward, instead of capturing a
  // value via a setState updater's side effect, avoids relying on React
  // invoking that updater synchronously (it does not always) — updaters are
  // supposed to be pure, and a value assigned inside one for later use
  // outside it is not reliably available right after the setter call.
  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  // Latest committed activeThreadId, read by the in-flight send to detect a
  // mid-send THREAD switch — same shape/purpose as ChatPanel's own
  // projectIdRef, which only ever covered a project switch. Without this,
  // switching to a different thread while a send is in flight does nothing to
  // stop that send: it isn't cancelled, isn't aborted, and its replies keep
  // writing into whatever history/display the user has since switched to —
  // silently corrupting the NEWLY selected thread with the OLD thread's
  // reply. submitPrompt (in ChatPanel) extends its own stale()/switchedAway
  // checks to use this ref too; this effect only keeps it current and aborts
  // an in-flight send on a real change.
  const threadIdRef = useRef(activeThreadId);
  useEffect(() => {
    const prev = threadIdRef.current;
    threadIdRef.current = activeThreadId;
    if (prev !== activeThreadId) {
      cancelledRef.current = true;
      abortRef.current?.abort();
    }
  }, [activeThreadId, cancelledRef, abortRef]);

  // Fire a Turso WRITE (save or delete), tracking it as the retry target
  // (keyed by the thread id it targets) on failure and clearing just THAT
  // key on success — the error banner only clears once nothing is left
  // pending. Shared by the busy-persist effect, ensureThreadForSend,
  // renameThread and requestDeleteThread so "Retry" means the same thing
  // everywhere — redo exactly the write that just failed. `key` is the
  // thread id; two writes on the SAME thread (e.g. a rename immediately
  // followed by a delete) intentionally collapse to one retry slot — the
  // later write already supersedes the earlier one's intent.
  function runPersist(key: string, action: () => Promise<void>): void {
    action()
      .then(() => {
        pendingRetryRef.current.delete(key);
        setThreadsError(pendingRetryRef.current.size > 0);
      })
      .catch(() => {
        pendingRetryRef.current.set(key, () => runPersist(key, action));
        setThreadsError(true);
      });
  }

  // Turso mode: (re)fetch this project's thread list on mount and on project
  // switch, then adopt the most-recently-updated thread (or the empty state).
  // File mode never runs this — ChatPanel's render-time reconcile is its path.
  useEffect(() => {
    if (!tursoMode) return;
    // Any pending WRITE retries from a previous project/mount no longer
    // apply once we start a fresh fetch for (possibly) a different project.
    pendingRetryRef.current.clear();
    let cancelled = false;
    loadThreads(tursoConfig, projectId)
      .then((loaded) => {
        if (cancelled) return;
        setThreadsError(false);
        setThreads(loaded);
        const next = loaded[0] ?? null;
        setActiveThreadId(next?.id ?? null);
        setHistory(next?.history ?? []);
        setDisplay(next?.display ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setThreadsError(true);
        setThreads([]);
        setActiveThreadId(null);
        setHistory([]);
        setDisplay([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tursoMode, projectId, tursoConfig, setHistory, setDisplay]);

  // The banner's single retry action. If one or more saves/deletes failed,
  // `pendingRetryRef` holds a thunk PER failed write (keyed by thread id) —
  // retry must NEVER fall back to reloading in that case, since the server
  // by definition does not have what just failed to save, and overwriting
  // the live conversation with it would destroy the very thing the banner is
  // trying to rescue. Re-issue every pending write, not just the most recent
  // one (Finding 3) — each retry's own runPersist call clears its OWN key
  // and re-derives the banner from what is still outstanding, so a retry
  // that fails again keeps the banner up without dropping the others. Only
  // when nothing is pending — meaning the FAILURE ON RECORD was the initial
  // fetch itself, whose own catch branch above already reset history/display
  // to empty — is a reload both correct and safe: there is no live
  // conversation left to lose.
  function retryLoad(): void {
    if (pendingRetryRef.current.size > 0) {
      // Snapshot before iterating: retrying re-invokes runPersist, whose
      // async .then/.catch mutates this same Map once each write settles —
      // never synchronously mid-loop, but a snapshot keeps that separation
      // explicit rather than relying on it.
      for (const retry of Array.from(pendingRetryRef.current.values())) {
        retry();
      }
      return;
    }
    if (!tursoMode) return;
    loadThreads(tursoConfig, projectId)
      .then((loaded) => {
        setThreadsError(false);
        setThreads(loaded);
        const next = loaded[0] ?? null;
        setActiveThreadId(next?.id ?? null);
        setHistory(next?.history ?? []);
        setDisplay(next?.display ?? []);
      })
      .catch(() => {
        setThreadsError(true);
        setThreads([]);
        setActiveThreadId(null);
        setHistory([]);
        setDisplay([]);
      });
  }

  // Persist the just-settled turn (success, error, or cancel) to Turso. Fires
  // exactly once per submitPrompt() call, on the busy=true→false transition —
  // NOT on every history/display change (that would rewrite the whole thread
  // row, incl. every prior attachment placeholder, on each intermediate
  // setDisplay inside a turn). `history`/`display` are the FINAL, just-committed
  // state for the render this effect runs in: submitPrompt's `finally` block
  // (which calls setBusy(false)) always runs in the same async continuation as
  // the try/catch block's own last setHistory/setDisplay call, so React 18's
  // automatic batching commits them together in one render — this effect never
  // sees a stale mid-turn snapshot. Deliberately depends on [busy] ONLY (with
  // the lint escape hatch already used elsewhere in ChatPanel, e.g. its
  // chatSeed effect) so it can't refire on the frequent history/display churn
  // WHILE busy stays true.
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!tursoMode || !wasBusy || busy) return;
    const id = activeThreadId ?? newThreadId();
    setActiveThreadId((prev) => prev ?? id);
    const existing = threads.find((th) => th.id === id);
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id,
      projectId,
      name: existing?.name ?? deriveThreadName(display),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      history: stripAttachmentsForPersistence(history),
      display,
    };
    setThreads((prev) => [thread, ...prev.filter((th) => th.id !== id)]);
    runPersist(id, () => saveThread(tursoConfig, thread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Called by ChatPanel's submitPrompt right after it commits the user's turn
  // into history/display, before awaiting the model. A brand-new thread
  // (minted by newThread(), not yet in `threads`) normally gets no row until
  // its first turn SETTLES (the busy-persist effect above) — deliberately,
  // to avoid a write for every intermediate state during a turn. But that
  // means if the user switches to a DIFFERENT thread before the reply lands,
  // selectThread() overwrites history/display with the other thread's
  // content and aborts this send; when it then finishes (via the abort's
  // finally), the busy-persist effect reads whatever is THEN
  // active/displayed — the OTHER thread, unchanged — and saves that. The
  // abandoned new thread's just-sent message is never captured anywhere: a
  // real, silent loss of user-authored content. Inserting (and saving) a
  // minimal row for the new thread the instant its first send starts closes
  // that window — the message already has a durable home before there is any
  // chance to switch away from it. No-ops (and costs nothing) once the
  // thread already has a row, so every later turn is still exactly one save,
  // matching this hook's write-amplification design.
  //
  // ★★★ `activeThreadId === null` MUST be handled here too, not bailed on —
  // a fresh Turso project (no threads yet, and the user has never clicked
  // "New chat" or selected one) starts in exactly that state, and it is the
  // MOST COMMON entry point of all: the very first message anyone ever sends
  // in a new project. Bailing on null left that first message with no row
  // and no recovery path the moment the user switched threads before the
  // reply landed — the identical data-loss class this function exists to
  // close, just left open at its own most-reached call site. Mint an id and
  // ADOPT it as the active thread before inserting the row, so a switch-away
  // has nothing left to abandon.
  //
  // Returns the resolved thread id (existing, newly minted, or null in file
  // mode) — the CALLER (submitPrompt in chat-panel.tsx) captures its OWN
  // `sendThreadId` FROM THIS RETURN VALUE, never from `activeThreadId` read
  // before calling this. Reading it beforehand would still see the pre-mint
  // `null`, and once this function adopts the minted id every later
  // `threadIdRef.current !== sendThreadId` guard in that send would then see
  // the new id and wrongly treat the send it just started as already stale.
  function ensureThreadForSend(sentHistory: ApiMessage[], sentDisplay: DisplayItem[]): string | null {
    if (!tursoMode) return null;
    const id = activeThreadId ?? newThreadId();
    if (activeThreadId === null) {
      // Keep threadIdRef in lockstep with the mint SYNCHRONOUSLY, not only
      // via setActiveThreadId — that commit won't reach threadIdRef until
      // the sync effect above runs on the next render, and that effect
      // treats ANY `threadIdRef.current !== activeThreadId` transition as a
      // user-initiated thread SWITCH and aborts whatever send is in flight
      // — which, at that point, is the very send this call is part of.
      // Writing the ref here first means the effect sees prev === next and
      // does not mistake this mint for a switch-away.
      threadIdRef.current = id;
      setActiveThreadId(id);
    }
    // No await happened between this render and this call (ChatPanel invokes
    // it synchronously, right after committing the user's turn) — the
    // `threads` closure is still fresh, so it's safe to decide "does this
    // thread already have a row" from it directly, unlike requestDeleteThread
    // below (which awaits a confirm dialog first).
    if (threads.some((th) => th.id === id)) return id;
    const now = new Date().toISOString();
    const inserted: ChatThread = {
      id,
      projectId,
      name: deriveThreadName(sentDisplay),
      createdAt: now,
      updatedAt: now,
      history: stripAttachmentsForPersistence(sentHistory),
      display: sentDisplay,
    };
    setThreads((prev) => (prev.some((th) => th.id === id) ? prev : [inserted, ...prev]));
    runPersist(id, () => saveThread(tursoConfig, inserted));
    return id;
  }

  function selectThread(id: string) {
    if (id === activeThreadId) return;
    const target = threads.find((th) => th.id === id);
    setActiveThreadId(id);
    setHistory(target?.history ?? []);
    setDisplay(target?.display ?? []);
  }

  function newThread() {
    setActiveThreadId(newThreadId());
    setHistory([]);
    setDisplay([]);
    // No row inserted yet — ensureThreadForSend (on the first send) or the
    // busy-persist effect (once that turn settles) inserts it.
  }

  function renameThread(id: string, name: string): void {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    const updated: ChatThread = { ...target, name, updatedAt: new Date().toISOString() };
    setThreads((prev) => prev.map((th) => (th.id === id ? updated : th)));
    runPersist(id, () => saveThread(tursoConfig, updated));
  }

  async function requestDeleteThread(id: string): Promise<void> {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    const displayName = target.name || t(lang, "chatThreadUntitled");
    if (!(await confirm({ message: t(lang, "chatThreadDeleteConfirm", displayName), tone: "danger" }))) return;
    // `threads`/`activeThreadId` above were captured at render time, BEFORE
    // this await — a concurrent write (the busy-persist effect settling, or
    // a rename) while the confirm dialog was open must not be clobbered by
    // reverting to that stale snapshot. `threadsRef`/`threadIdRef` mirror the
    // latest COMMITTED state (kept fresh by their own sync effects) — read
    // those instead of relying on a setState updater's side effect (React
    // does not guarantee an updater runs synchronously before the next
    // line — updaters are meant to be pure).
    const remaining = threadsRef.current.filter((th) => th.id !== id);
    setThreads((prev) => prev.filter((th) => th.id !== id));
    if (threadIdRef.current === id) {
      const next = remaining[0] ?? null;
      setActiveThreadId(next?.id ?? null);
      setHistory(next?.history ?? []);
      setDisplay(next?.display ?? []);
    }
    // Scope the delete by project (defense-in-depth against a project-id
    // collision in the id space) — `target` was resolved from `threads`
    // before the confirm await and still carries the row's own projectId.
    runPersist(id, () => deleteThreadRow(tursoConfig, id, target.projectId));
  }

  return {
    threads,
    activeThreadId,
    threadsError,
    setThreadsError,
    setThreads,
    threadIdRef,
    ensureThreadForSend,
    selectThread,
    newThread,
    renameThread,
    requestDeleteThread,
    retryLoad,
  };
}
