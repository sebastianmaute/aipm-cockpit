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
  // failed — see runPersist. retryLoad() prefers this over a fresh fetch:
  // clicking "Retry" after a failed SAVE must re-send that same payload, not
  // pull whatever the server already has (which by definition excludes the
  // failed write) and stomp the live conversation with it — that was the
  // destructive bug this hook used to have. Left null whenever nothing is
  // outstanding (a write just succeeded, or the only failure on record is the
  // initial FETCH, which has no payload to replay — see retryLoad).
  const pendingRetryRef = useRef<(() => void) | null>(null);
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

  // Fire a Turso WRITE (save or delete), tracking it as the retry target on
  // failure and clearing both the pending retry and the error banner on any
  // success. Shared by the busy-persist effect, ensureThreadForSend,
  // renameThread and requestDeleteThread so "Retry" means the same thing
  // everywhere — redo exactly the write that just failed.
  function runPersist(action: () => Promise<void>): void {
    action()
      .then(() => {
        pendingRetryRef.current = null;
        setThreadsError(false);
      })
      .catch(() => {
        pendingRetryRef.current = () => runPersist(action);
        setThreadsError(true);
      });
  }

  // Turso mode: (re)fetch this project's thread list on mount and on project
  // switch, then adopt the most-recently-updated thread (or the empty state).
  // File mode never runs this — ChatPanel's render-time reconcile is its path.
  useEffect(() => {
    if (!tursoMode) return;
    // A pending WRITE retry from a previous project/mount no longer applies
    // once we start a fresh fetch for (possibly) a different project.
    pendingRetryRef.current = null;
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

  // The banner's single retry action. If a save or delete failed,
  // `pendingRetryRef` holds a thunk that re-issues exactly that write —
  // retry must NEVER fall back to reloading in that case, since the server
  // by definition does not have what just failed to save, and overwriting
  // the live conversation with it would destroy the very thing the banner is
  // trying to rescue. Only when nothing is pending — meaning the FAILURE ON
  // RECORD was the initial fetch itself, whose own catch branch above already
  // reset history/display to empty — is a reload both correct and safe:
  // there is no live conversation left to lose.
  function retryLoad(): void {
    if (pendingRetryRef.current) {
      pendingRetryRef.current();
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
    runPersist(() => saveThread(tursoConfig, thread));
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
  function ensureThreadForSend(sentHistory: ApiMessage[], sentDisplay: DisplayItem[]): void {
    if (!tursoMode || activeThreadId === null) return;
    // No await happened between this render and this call (ChatPanel invokes
    // it synchronously, right after committing the user's turn) — the
    // `threads` closure is still fresh, so it's safe to decide "does this
    // thread already have a row" from it directly, unlike requestDeleteThread
    // below (which awaits a confirm dialog first).
    if (threads.some((th) => th.id === activeThreadId)) return;
    const id = activeThreadId;
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
    runPersist(() => saveThread(tursoConfig, inserted));
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
    runPersist(() => saveThread(tursoConfig, updated));
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
    runPersist(() => deleteThreadRow(tursoConfig, id, target.projectId));
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
