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
// the thread list, the active thread, fetch and save, the ref that lets an
// in-flight send detect it was switched away from, and the retry action for a
// failed fetch/save. It composes:
//   chat-thread-ledger.ts        stored / gone / source of each thread, per database
//   use-chat-identity.ts         this browser's chat identity and `persistence`
//   chat-persist-queue.ts        runPersist: write ordering, retries, landings, saves in flight
//   use-chat-thread-renames.ts   rename and the rename outbox
//   use-chat-erase.ts            single delete, delete ticked, delete all
//   use-chat-threads-publish.ts  the registry the AI dispatcher reads
//   chat-thread-writes.ts        shared helpers (outbox scope, retention expiry)
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "./i18n";
import type { ApiMessage, DisplayItem } from "./chat-api";
import type { TursoConfig } from "./turso-config";
import type { ConfirmFn } from "./confirm-dialog";
import { loadThreads, saveThread } from "./chat-threads-store";
import type { ChatSettings } from "./ai-chat-retention-config";
import { retentionCutoff } from "./chat-threads-schema";
import {
  type ChatThread, newThreadId, deriveThreadName, stripAttachmentsForPersistence,
} from "./chat-threads";
import { logDiag } from "./diagnostics";
import { dropPendingEdit } from "./pending-edits";
import { mergeThreadsAfterLoad, resetThreadsAfterFailedLoad } from "./chat-thread-load";
import { createChatThreadLedger } from "./chat-thread-ledger";
import {
  RENAME_KIND, urlOf, outboxScope, sameDatabase, retentionInForce, expiredBy, expireOldThreads, type SaveGate,
} from "./chat-thread-writes";
import { useChatIdentity } from "./use-chat-identity";
import { createChatPersistQueue, WriteRefusedError } from "./chat-persist-queue";
import { useChatThreadRenames } from "./use-chat-thread-renames";
import { useChatErase } from "./use-chat-erase";
import { useChatThreadsPublish } from "./use-chat-threads-publish";
import type { ChatThreadCloseReason } from "./chat-not-saved-notice";

export { chatPersistence, type ChatPersistence } from "./use-chat-identity";

/** The diagnostics code a thread marked gone (`dropGone`) is logged with. */
type GoneCode = "chat.threadGone" | "chat.threadOwnerChanged" | "chat.threadSaveUnconfirmed";
export type { ChatEraseActions, DeleteAllOutcome } from "./use-chat-erase";

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
   *  switch can't race each other's abort of an in-flight send. `abortRef` is
   *  ALSO read here as the live "is a send in flight" signal, which is what
   *  lets retryLoad refuse to adopt a server thread over a conversation the
   *  user is mid-send in. It is non-null between submitPrompt's start and its
   *  `finally` — and that `finally` (in chat-panel.tsx) clears it only when
   *  the settling send still OWNS the slot
   *  (`if (abortRef.current === controller)`, §312).
   *  ★ Since §321 submitPrompt also BAILS on a non-null `abortRef`, so a
   *  second send cannot start while one is live and the slot never has two
   *  owners. The §312 identity clear is now defence in depth. Pinned by
   *  chat-panel.test.tsx's "a same-tick double dispatch sends exactly once". */
  cancelledRef: React.MutableRefObject<boolean>;
  abortRef: React.MutableRefObject<AbortController | null>;
  confirm: ConfirmFn;
  /** The server's saved-chat settings; `null` until the status has answered. */
  chat: ChatSettings | null;
}

export function useChatThreads(deps: UseChatThreadsDeps) {
  // Destructured to locals because react-hooks/exhaustive-deps REJECTS an
  // `obj.member` dependency (AGENTS.md) — every effect below depends on these
  // locals, never on `deps.x`.
  const {
    tursoMode, tursoConfig, projectId, lang, busy, history, display,
    setHistory, setDisplay, cancelledRef, abortRef, confirm, chat,
  } = deps;

  // Monotonic count of COMMITTED sends, bumped by ensureThreadForSend — which
  // submitPrompt calls exactly once per send, after all of its bails and
  // synchronously before it awaits anything, so it IS the commit point.
  //
  // ★★★ IT ANSWERS A DIFFERENT QUESTION FROM `abortRef`, and retryLoad needs
  // both:
  //    `abortRef`   — LIVENESS:   "is a send in flight AT THIS INSTANT?"
  //    `sendSeqRef` — OCCURRENCE: "did any send BEGIN since this moment?"
  // A liveness signal can only ever be SAMPLED, at instants; a send whose
  // whole lifetime falls strictly between two samples is invisible to it no
  // matter how many samples are taken. That is retryLoad's third ordering,
  // and only an occurrence signal closes it.
  //
  // ★★ It lives HERE rather than in ChatPanel (beside abortRef/cancelledRef)
  // because chat-panel.tsx has no size-ratchet headroom for a threaded ref, and
  // owning it here keeps the signal in the same file as its only reader. ★ The
  // cost: a future send path that skipped ensureThreadForSend would skip the
  // bump — though such a path would already be violating that function's own
  // durable-row invariant, which is the louder failure. Never reset, and only
  // ever compared against a value captured earlier in the same flow.
  const sendSeqRef = useRef(0);

  // Turso-only multi-thread state. `threads` holds each thread's FULL
  // ChatThread (incl. history/display) so switching between them is instant
  // with no second Turso round-trip. Always empty/unused in file mode.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Read by ChatThreadSidebar to show a fetch/save/rename/delete failure banner.
  const [threadsError, setThreadsError] = useState(false);
  // LOAD-scoped failure, narrower than `threadsError` on purpose: raised only
  // by the two fetch paths (the load effect and retryLoad's reload), cleared by
  // either succeeding. `threadsError` also covers a failed SAVE or DELETE,
  // where the list we hold is still a perfectly good READ — see
  // use-chat-threads-publish.ts.
  const [loadFailed, setLoadFailed] = useState(false);
  // Which project the CURRENT `threads` value was loaded for — null until the
  // first load settles. Written only where `threads` is settled from a load
  // (the load effect's two settle branches and retryLoad's two), so it can
  // never claim ownership of rows some other project put there.
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  // Mirrors the latest COMMITTED `threads` value, for code that runs after an
  // await (a confirm dialog, a delete) and must not act on a stale closure.
  // Reading this ref, instead of capturing a value via a setState updater's
  // side effect, avoids relying on React invoking that updater synchronously.
  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // A monotonic PROJECT EPOCH, for async settles that must not write under a
  // project the user has since left. ★ PROJECT changes ONLY — a database change
  // is `targetEpochRef`'s. ★★ AN EPOCH, NOT THE PROJECT VALUE: comparing the id
  // passes on p1 → p2 → back to p1 inside one window (ABA). A counter cannot
  // repeat. ★ NOT the mount effect's `cancelled` local: retryLoad runs from an
  // event handler outside that closure.
  const projectEpochRef = useRef(0);
  useEffect(() => {
    projectEpochRef.current += 1;
  }, [projectId]);
  // §604. The same guard for the Turso DATABASE: a retryLoad issued against database A that settles
  // after the config moved to B would put A's rows (and A's confirmed names, and A's outbox replay)
  // under B. Bumped when the database URL changes — a token rotation for the same URL is not a move —
  // and compared at settle beside `projectEpochRef`.
  const targetEpochRef = useRef(0);
  const targetUrl = tursoConfig?.httpUrl;
  useEffect(() => {
    targetEpochRef.current += 1;
  }, [targetUrl]);
  // §604. The live config, for a write pinned to a database: while the pinned database is still the
  // current one it writes with the live config (a rotated token included), resolved when the write
  // RUNS — a Retry too — and only a write whose database has moved keeps its pinned config.
  const liveConfigRef = useRef(tursoConfig);
  useEffect(() => {
    liveConfigRef.current = tursoConfig;
  });
  function writeConfig(pinned: TursoConfig | null): TursoConfig | null {
    const live = liveConfigRef.current;
    return sameDatabase(pinned, live) ? live : pinned;
  }

  useChatThreadsPublish({
    tursoMode, projectId, threads, activeThreadId, threadsMatchProject: loadedProjectId === projectId, loadFailed,
  });

  // Latest committed activeThreadId, read by the in-flight send to detect a
  // mid-send THREAD switch — same shape/purpose as ChatPanel's own
  // projectIdRef, which only ever covered a project switch. Without this,
  // switching to a different thread while a send is in flight does nothing to
  // stop that send, and its replies keep writing into whatever history/display
  // the user has since switched to. submitPrompt (in ChatPanel) extends its own
  // stale()/switchedAway checks to use this ref too; this effect only keeps it
  // current and aborts an in-flight send on a real change.
  const threadIdRef = useRef(activeThreadId);
  useEffect(() => {
    const prev = threadIdRef.current;
    threadIdRef.current = activeThreadId;
    if (prev !== activeThreadId) {
      cancelledRef.current = true;
      abortRef.current?.abort();
    }
  }, [activeThreadId, cancelledRef, abortRef]);

  // Every save and delete goes through the queue's runPersist (chat-persist-queue.ts). One per mount.
  const [queue] = useState(() => createChatPersistQueue(setThreadsError));
  const { runPersist } = queue;

  // Stored / gone / source of every thread this session has seen, per database (chat-thread-ledger.ts).
  const [ledger] = useState(createChatThreadLedger);

  // A chat deleted elsewhere (or one a save could not confirm, or one of the previous database) was
  // closed here: the panel says so in one line, worded by `threadCloseReason`, until the next send,
  // thread switch or new chat.
  const [threadClosed, setThreadClosed] = useState(false);
  const [threadCloseReason, setThreadCloseReason] = useState<ChatThreadCloseReason>("gone");

  // The database the list is for. When the config moves to another database, the rows of the old one
  // leave the list (and so the registry, which is also marked not loaded) in the same render, before
  // the new load settles: from then on none of them is shown, renamed or sent in. An open chat of the
  // old database is closed in the same render too (with no send running; a running turn is closed by
  // the end-of-turn effect once its save to its own database is queued) — otherwise a send would run
  // in it, its save would be refused, and the new load would then replace it: the message and the
  // reply would vanish without a word. Render-time reconcile, not an effect, so no render ever shows
  // them under the new database.
  const currentUrl = urlOf(tursoConfig);
  const [listUrl, setListUrl] = useState(currentUrl);
  if (listUrl !== currentUrl) {
    setListUrl(currentUrl);
    setThreads((prev) => prev.filter((th) => ledger.cameFrom(currentUrl, th.id)));
    setLoadedProjectId(null);
    const openFromElsewhere = activeThreadId !== null && ledger.sourceOf(activeThreadId) !== null
      && !ledger.cameFrom(currentUrl, activeThreadId);
    if (tursoMode && !busy && openFromElsewhere) {
      setActiveThreadId(null);
      setHistory([]);
      setDisplay([]);
      setThreadClosed(true);
      setThreadCloseReason("otherDatabase");
    }
  }

  const identity = useChatIdentity({ tursoMode, tursoConfig, chat });
  const { persistence, identityReloads } = identity;
  const saveGate: SaveGate | null = persistence === "on" && chat?.recoveryKey
    ? { recoveryKey: chat.recoveryKey, retentionDays: retentionInForce(chat) }
    : null;
  // Deletes need no encryption, so they do not wait for "on": with the status known in Turso mode, a
  // delete is sent — otherwise a deleted legacy chat would come back on reload. (Like a save, it does
  // not check the config itself: the store reports a missing one as a failed write.)
  const deleteGate = chat !== null && tursoMode;
  // A primitive for the load effect: it reloads once when the settings become known, never on a new
  // settings object.
  const chatKnown = chat !== null;
  // For the load effect's expiry, which must not refire the load when the settings change.
  const saveGateRef = useRef(saveGate);
  useEffect(() => {
    saveGateRef.current = saveGate;
  });

  /** Reads this browser's identity for `config`'s database, then loads the threads it may see: its
   *  own and legacy owner-less ones. A row owned by anybody else is dropped here as well as in the
   *  decoder, so it can never reach the list, the registry, search or the recap. With a retention
   *  period in force (`retentionInForce`), a thread past it is dropped too (by this browser's clock —
   *  display only; the delete itself runs on the database's clock), so a load never shows a chat the
   *  next expiry is about to delete. */
  async function loadVisibleThreads(config: TursoConfig | null, pid: string): Promise<ChatThread[]> {
    const owner = await identity.readIdentity(config);
    const loaded = await loadThreads(config, pid, owner);
    const url = urlOf(config);
    // Every row read is stored there; only the rows shown come from there (and may be written there).
    for (const th of loaded) ledger.markStored(url, th.id);
    const days = retentionInForce(chat);
    const cutoffIso = days === null ? null : retentionCutoff(new Date(), days);
    const visible = loaded.filter((th) =>
      (th.ownerId === null || th.ownerId === owner?.ownerId)
      && (cutoffIso === null || !expiredBy(th.updatedAt, cutoffIso)));
    ledger.recordLoaded(url, visible.map((th) => th.id));
    return visible;
  }

  /** Whether the in-memory thread `id` may be written to `url`'s database: it came from there, or it is
   *  new (no database yet), and then it is recorded as coming from there. A thread of another database
   *  is never written here, under any id: its writes are refused without a network call. */
  function claimSource(url: string, id: string): boolean {
    const source = ledger.sourceOf(id);
    if (source === null) ledger.recordSource(url, id);
    if (source !== null && source !== url) logDiag("warn", "chat.threadOtherDatabase");
    return source === null || source === url;
  }
  const loadVisibleRef = useRef(loadVisibleThreads);
  useEffect(() => {
    loadVisibleRef.current = loadVisibleThreads;
  });

  /** The save of `th`: expiry first (never blocking), then the encrypted write as this browser's owner.
   *  A thread stamped with an owner this browser no longer is (the row may have been erased and a new
   *  identity started in another tab) is closed like a gone one, and nothing is sent. A stored thread is
   *  UPDATEd; when that changes no row the store reads whether the row is still there: absent is "gone"
   *  and closes it, and a failed read ("unconfirmed") closes it too, without saying it was deleted. A
   *  server-reported "not-owned" — the upsert of a never-stored thread whose id another owner holds, or a
   *  stored row another owner took over — keeps the conversation on screen under no thread, so the next
   *  send saves it under a new id of this owner's: it is this person's own content, not an erasure. */
  function saveAction(config: TursoConfig | null, th: ChatThread, gate: SaveGate): () => Promise<void> {
    // Tracked per database while on its way, so a delete-all there waits for it (`savesSettled`).
    return () => queue.track(urlOf(config), runSave(config, th, gate));
  }

  async function runSave(config: TursoConfig | null, th: ChatThread, gate: SaveGate): Promise<void> {
    // Every write (a rename, an end-of-turn save, a retry) goes only to the thread's own database.
    // Refused, not landed: no confirmed name, no settled outbox entry, no cleared banner.
    if (!ledger.cameFrom(urlOf(config), th.id)) {
      logDiag("warn", "chat.threadOtherDatabase");
      throw new WriteRefusedError();
    }
    if (gate.retentionDays !== null) expireOldThreads(config, gate.retentionDays, th.projectId, () => threadsRef.current);
    const owner = identity.trustedIdentity(config) ?? (await identity.writeIdentity(config));
    // A LOCAL mismatch is not a take-over: the row may have been erased and a new identity started in
    // another tab. Closed like a deleted chat, so its transcript cannot go out under the new owner.
    if (th.ownerId !== null && th.ownerId !== owner.ownerId) {
      dropGone(config, th, "chat.threadOwnerChanged");
      return;
    }
    const url = urlOf(config);
    const outcome = await saveThread(config, th, owner, gate.recoveryKey, { stored: ledger.isStored(url, th.id) });
    if (outcome === "not-owned") {
      dropUnsaveable(th.id, "chat.threadNotOwned");
      return;
    }
    if (outcome === "gone" || outcome === "unconfirmed") {
      dropGone(config, th, outcome === "gone" ? "chat.threadGone" : "chat.threadSaveUnconfirmed");
      return;
    }
    ledger.markStored(url, th.id);
    // Only into the list of the database it landed in: a write pinned to a database the user has
    // since left must not touch the new one's list.
    if (sameDatabase(config, liveConfigRef.current)) stampOwner(th.id, owner.ownerId);
  }

  /** The thread `th` is gone from the database (erased, deleted elsewhere, expired), or stamped with an
   *  owner this browser no longer is, or a save could not confirm it is there ("unconfirmed"): off the
   *  list, its pending rename goes too, and it is marked gone in `config`'s database. The active thread
   *  is closed only when it came from that database — which need not be the current one: after a switch
   *  its transcript is still on screen — and never a same-id thread of another database. With a send
   *  running, the end-of-turn effect closes it instead. The notice says it was deleted except for
   *  "unconfirmed". */
  function dropGone(config: TursoConfig | null, th: ChatThread, code: GoneCode): void {
    const scope = outboxScope(config, th.projectId);
    if (scope) dropPendingEdit(scope, RENAME_KIND, th.id);
    ledger.markGone(urlOf(config), th.id);
    if (threadIdRef.current === th.id) setThreadCloseReason(code === "chat.threadSaveUnconfirmed" ? "unconfirmed" : "gone");
    dropUnsaveable(th.id, code);
    // ★ Its conversation must not stay on screen: the next send would mint a new id and insert the
    // whole erased transcript again. With a send running, the end-of-turn effect closes it instead.
    if (threadIdRef.current === th.id && ledger.cameFrom(urlOf(config), th.id) && abortRef.current === null) closeGoneThread();
  }

  /** Closes the active chat: nothing on screen, no active thread, and the notice (worded by `reason`
   *  when given; `dropGone` sets it for a gone thread). */
  function closeGoneThread(reason?: ChatThreadCloseReason): void {
    if (reason) setThreadCloseReason(reason);
    threadIdRef.current = null;
    setActiveThreadId(null);
    setHistory([]);
    setDisplay([]);
    setThreadClosed(true);
  }

  /** A save of thread `id` landed as `ownerId`'s row: the in-memory thread says so too (list, ref and
   *  so the registry). A chat started in this session is minted owner-less, and without this a
   *  "delete all my chats" could not tell it from a legacy row. */
  function stampOwner(id: string, ownerId: string): void {
    const stamp = (list: ChatThread[]): ChatThread[] =>
      list.some((th) => th.id === id && th.ownerId !== ownerId)
        ? list.map((th) => (th.id === id ? { ...th, ownerId } : th))
        : list;
    threadsRef.current = stamp(threadsRef.current);
    setThreads(stamp);
  }

  /** The thread `id` can no longer be saved here: off the list (and so off the registry). When it is
   *  the active one and no send is running, it stops being active; the conversation on screen is left
   *  to the caller (`dropGone` closes it, a not-owned result keeps it so the next send starts a new
   *  thread of this owner's). */
  function dropUnsaveable(id: string, code: GoneCode | "chat.threadNotOwned"): void {
    logDiag("warn", code);
    setThreads((prev) => prev.filter((th) => th.id !== id));
    if (threadIdRef.current === id && abortRef.current === null) setActiveThreadId(null);
  }

  const renames = useChatThreadRenames({
    tursoMode, tursoConfig, projectId, lang, threads, setThreads, saveGate, runPersist, saveAction, writeConfig,
    landed: queue.landed,
  });
  const { renameScope, confirmSavedName, namesLoadedRef } = renames;

  // Turso mode: (re)fetch this project's thread list on mount and on project
  // switch, then adopt the most-recently-updated thread (or the empty state).
  // File mode never runs this — ChatPanel's render-time reconcile is its path.
  useEffect(() => {
    if (!tursoMode) return;
    // Any pending WRITE retries from a previous project/mount no longer
    // apply once we start a fresh fetch for (possibly) a different project.
    queue.resetForLoad();
    let cancelled = false;
    // The active thread as it stood when this fetch STARTED. If it has changed
    // by the time the fetch resolves, something adopted a thread mid-flight —
    // ensureThreadForSend minting one for a send that began before this fetch
    // settled (reachable in production: chat-panel.tsx's `chatSeed` effect
    // auto-sends from a MOUNT effect, in the same commit that starts this
    // fetch), or a "New chat" / thread click.
    const startedOn = threadIdRef.current;
    const landingsAtStart = queue.landings();
    const fromThisDatabase = (th: ChatThread) => ledger.cameFrom(urlOf(tursoConfig), th.id);
    loadVisibleRef.current(tursoConfig, projectId)
      .then((loaded) => {
        if (cancelled) return;
        // Retention: once the list is in, the project's threads past the server's period go. Only
        // while chats are saved at all — never with a guessed period.
        const gate = saveGateRef.current;
        if (gate && gate.retentionDays !== null) expireOldThreads(tursoConfig, gate.retentionDays, projectId, () => loaded);
        setThreadsError(false);
        setLoadFailed(false);
        // MERGE, not bail, when something adopted a different thread while
        // this fetch was in flight. `loaded` cannot contain a thread minted
        // after the fetch was issued, so assigning it verbatim would drop
        // that row from the list, clobber `activeThreadId`, wipe
        // history/display, and — via the threadIdRef sync effect seeing a
        // change — abort the very send that minted it. Bailing outright would
        // instead discard the server's OTHER threads. So keep the locally-held
        // rows ahead of the fetched ones, and leave the active thread and its
        // history/display exactly as the adopting caller set them. Scoped to
        // THIS project and database — see mergeThreadsAfterLoad.
        //
        // ★★ `preserveLive: false` — this effect must NOT take retryLoad's
        // in-flight-send guard. It also runs on a PROJECT SWITCH, where the
        // pre-switch `activeThreadId` belongs to the project we are leaving:
        // preserving it there would leave the old project's thread active and
        // its conversation on screen under the new project.
        const settled = mergeThreadsAfterLoad(startedOn, threadIdRef.current, projectId, loaded, false, fromThisDatabase);
        setThreads(settled.updateThreads);
        setLoadedProjectId(projectId);
        // §626. A rename typed before the last close and never saved: re-issue it now that the
        // server's own copy is in hand to check the draft's base against.
        namesLoadedRef.current(loaded, landingsAtStart);
        if (settled.stale) return;
        setActiveThreadId(settled.next?.id ?? null);
        setHistory(settled.next?.history ?? []);
        setDisplay(settled.next?.display ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setThreadsError(true);
        setLoadFailed(true);
        // Same mid-flight adoption guard as the success branch, and the reset
        // here is the MORE destructive of the two: `setThreads([])` would drop
        // the just-minted row from the list outright while its save is already
        // on its way to Turso. `preserveLive: false` for the project-switch
        // reason given above.
        const settled = resetThreadsAfterFailedLoad(startedOn, threadIdRef.current, projectId, false, fromThisDatabase);
        setThreads(settled.updateThreads);
        setLoadedProjectId(projectId);
        if (settled.stale) return;
        setActiveThreadId(null);
        setHistory([]);
        setDisplay([]);
      });
    return () => {
      cancelled = true;
    };
    // `chatKnown`: the load filters out threads past the retention period only with the chat settings
    // known, so the list is loaded once more when they arrive after the first load. `queue`, `ledger`
    // and `namesLoadedRef` keep one identity for the hook's lifetime.
  }, [tursoMode, projectId, tursoConfig, setHistory, setDisplay, identityReloads, chatKnown, queue, ledger, namesLoadedRef]);

  // The banner's single retry action. If one or more saves/deletes failed,
  // the persist queue holds a thunk PER failed write (keyed by thread id) —
  // retry must NEVER fall back to reloading in that case, since the server
  // by definition does not have what just failed to save, and overwriting
  // the live conversation with it would destroy the very thing the banner is
  // trying to rescue. Re-issue every pending write, not just the most recent
  // one — each retry's own runPersist call clears its OWN key and re-derives
  // the banner from what is still outstanding. Only when nothing is pending —
  // meaning the FAILURE ON RECORD was the initial fetch itself — does retry
  // fall through to a fresh reload.
  //
  // ★★★ THAT RELOAD IS NOT AUTOMATICALLY SAFE. The initial fetch's catch has
  // TWO branches and only one of them resets: on its STALE branch it returns
  // EARLY, keeping a mid-flight-minted thread active with the user's live
  // message in history/display. So a reload here can very much have a live
  // conversation to lose — which is exactly the ordering the guards below cover.
  function retryLoad(): void {
    if (queue.retryFailed()) return;
    if (!tursoMode) return;
    // Same mid-flight-mint guard as the mount-fetch effect (§148). ★★ It is NOT
    // equivalent to the effect's own `startedOn`: the effect's baseline is taken
    // before any send for that mount can exist, while retryLoad's can already
    // BE a thread with a send streaming into it. That difference is the whole
    // reason the second guard below is needed.
    const startedOn = threadIdRef.current;
    // ★★★ THREE ORDERINGS OF A SEND, THREE DISJUNCTS — and the enumeration is the
    // point: `abortRef` is a LIVENESS signal, sampled at instants, so anything
    // whose whole lifetime falls between two samples is invisible to it.
    // Closing that needs an OCCURRENCE signal (`sendSeqRef`).
    //   (a) A send already IN FLIGHT when Retry is clicked, finishing before
    //       the reload settles. → caught by `sendInFlightAtClick`, and by
    //       NOTHING else: it bumped the counter BEFORE `seqAtClick` was captured.
    //   (b) A send that STARTS after the click and is STILL in flight at
    //       settle. → caught by the settle-time `abortRef.current !== null`.
    //   (c) A send that starts AND finishes strictly inside the window. Both
    //       liveness samples read null, and if it went into the already-active
    //       thread it minted nothing, so the identity test reads clean too. →
    //       caught by `sendSeqRef.current !== seqAtClick`. ★★ NOT the ONLY
    //       detector: the busy-persist effect issues a `runPersist` at every
    //       send's end, so §317's persist occurrence test fires for it too. The
    //       counter is the only detector that does not depend on that write.
    // ★★ submitPrompt is SINGLE-FLIGHT (§321: it bails on a non-null `abortRef`),
    // which this depends on; pinned by chat-panel.test.tsx's "a same-tick double
    // dispatch sends exactly once".
    // ★★★ NOT EXHAUSTIVE OVER WHAT CAN BE LIVE: a send begun AND finished before
    // the click can still have its PERSIST in flight — invisible to the
    // pre-reload `retryFailed()` gate, which sees only FAILED writes. That is
    // §317, closed at the SETTLE by `persistInFlightAtClick` and the persist
    // occurrence test.
    // ★★★ IT MUST GATE THE SETTLE, NOT THE FETCH. Gating the `loadThreads` call
    // would let a send that never settles pin the reload branch closed forever.
    const sendInFlightAtClick = abortRef.current !== null;
    const seqAtClick = sendSeqRef.current;
    // §317. The same liveness/occurrence pair for PERSISTS. Only two disjuncts:
    // a settle-time liveness re-read would be redundant.
    const persistInFlightAtClick = queue.inFlight();
    const persistSeqAtClick = queue.startedCount();
    // §626 (R11). A save that lands while this reload is out keeps its confirmed name — see
    // adoptConfirmedNames. Not shouldPreserveLive(): that is project-wide and also true for a write
    // that FAILS, so it would freeze every thread's confirmed name, not just the one that landed.
    const landingsAtClick = queue.landings();
    // §313. The project epoch this reload is FOR, compared at settle against the live one.
    const issuedAtEpoch = projectEpochRef.current;
    // §604. The database this reload reads; a settle after the config moved is dropped (no rows, no
    // confirmed names, no outbox replay, no failure banner) and logged without the URL or token.
    const issuedAtTargetEpoch = targetEpochRef.current;
    const targetMoved = (outcome: "loaded" | "failed"): boolean => {
      if (issuedAtTargetEpoch === targetEpochRef.current) return false;
      logDiag("info", "storage.chatThreadsStaleTargetDropped", { outcome });
      return true;
    };
    // ★★ A FUNCTION, NOT A VALUE — three disjuncts read refs that must be
    // sampled AT SETTLE. Hoisted so the two handlers cannot drift.
    const shouldPreserveLive = () =>
      sendInFlightAtClick ||
      abortRef.current !== null ||
      sendSeqRef.current !== seqAtClick ||
      persistInFlightAtClick ||
      queue.startedCount() !== persistSeqAtClick;
    const fromThisDatabase = (th: ChatThread) => ledger.cameFrom(urlOf(tursoConfig), th.id);
    loadVisibleThreads(tursoConfig, projectId)
      .then((loaded) => {
        // §313. A project switch while this was in flight means every setState
        // below would write p1's data under p2.
        if (issuedAtEpoch !== projectEpochRef.current) return;
        if (targetMoved("loaded")) return;
        setThreadsError(false);
        setLoadFailed(false);
        const settled = mergeThreadsAfterLoad(startedOn, threadIdRef.current, projectId, loaded, shouldPreserveLive(), fromThisDatabase);
        setThreads(settled.updateThreads);
        setLoadedProjectId(projectId);
        namesLoadedRef.current(loaded, landingsAtClick); // same as the load effect's success branch
        if (settled.stale) return;
        setActiveThreadId(settled.next?.id ?? null);
        setHistory(settled.next?.history ?? []);
        setDisplay(settled.next?.display ?? []);
      })
      .catch(() => {
        if (issuedAtEpoch !== projectEpochRef.current) return;
        if (targetMoved("failed")) return;
        setThreadsError(true);
        setLoadFailed(true);
        const settled = resetThreadsAfterFailedLoad(startedOn, threadIdRef.current, projectId, shouldPreserveLive(), fromThisDatabase);
        setThreads(settled.updateThreads);
        setLoadedProjectId(projectId);
        if (settled.stale) return;
        setActiveThreadId(null);
        setHistory([]);
        setDisplay([]);
      });
  }

  // Persist the just-settled turn (success, error, or cancel) to Turso. Fires
  // exactly once per submitPrompt() call, on the busy=true→false transition —
  // NOT on every history/display change (that would rewrite the whole thread
  // row on each intermediate setDisplay inside a turn). `history`/`display` are
  // the FINAL, just-committed state for the render this effect runs in:
  // submitPrompt's `finally` (which calls setBusy(false)) runs in the same async
  // continuation as its last setHistory/setDisplay, so React batches them into
  // one render. Deliberately depends on [busy] ONLY so it can't refire on the
  // history/display churn WHILE busy stays true.
  const prevBusyRef = useRef(busy);
  // §604. The Turso config of the render where this turn STARTED (busy's rising edge). The turn is
  // saved there, and its rename edit settles under that database's outbox scope — never the live
  // config, which a switch mid-turn has moved to another database.
  const turnConfigRef = useRef(tursoConfig);
  // §604. The thread the turn started on, next to its config.
  const turnThreadIdRef = useRef(activeThreadId);
  // The turn's thread as the list held it when the turn started: after a database switch the list no
  // longer holds it, and the save to its own database still carries its name and creation date.
  const turnThreadRef = useRef<ChatThread | null>(null);
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!wasBusy && busy) {
      turnConfigRef.current = tursoConfig;
      turnThreadIdRef.current = activeThreadId;
      turnThreadRef.current = threads.find((th) => th.id === activeThreadId) ?? null;
    }
    if (!tursoMode || !wasBusy || busy) return;
    const turnConfig = turnConfigRef.current;
    // §604. The turn is saved in the database it started in. When the DATABASE has moved since (the
    // URL, not a rotated token), the live list is the NEW database's: the thread is not put into it
    // (nor made active there), or a later send or rename on it would upsert A's conversation into B.
    const movedAway = !sameDatabase(turnConfig, tursoConfig);
    // ★ And when B's load has already settled, it made B's thread active, loaded B's transcript and
    // so aborted this send: what is on screen is B's, not the turn's. Saving it would write B's
    // conversation into A — there is nothing of this turn left to save.
    if (movedAway && activeThreadId !== turnThreadIdRef.current) return;
    // A thread found gone while this turn ran is not saved at all (an UPDATE would match nothing, and
    // under a new id it would insert the erased transcript): it is closed now that the send has settled,
    // even when the user has moved to another database since — its transcript is still on screen.
    if (activeThreadId !== null && ledger.isGone(urlOf(turnConfig), activeThreadId)) {
      const goneId = activeThreadId;
      setThreads((prev) => prev.filter((th) => th.id !== goneId));
      closeGoneThread();
      return;
    }
    const id = activeThreadId ?? newThreadId();
    // A thread of another database (left on screen until the new load settles) is not saved here.
    if (!movedAway && !claimSource(urlOf(turnConfig), id)) return;
    if (!movedAway) setActiveThreadId((prev) => prev ?? id);
    const existing = threads.find((th) => th.id === id) ?? (movedAway && turnThreadRef.current?.id === id ? turnThreadRef.current : undefined);
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id,
      projectId,
      ownerId: existing?.ownerId ?? null,
      name: existing?.name ?? deriveThreadName(display),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      history: stripAttachmentsForPersistence(history),
      display,
    };
    if (!movedAway) setThreads((prev) => [thread, ...prev.filter((th) => th.id !== id)]);
    if (saveGate) {
      const scope = renameScope(turnConfig);
      runPersist(id, saveAction(writeConfig(turnConfig), thread, saveGate), (owns) => confirmSavedName(scope, id, thread.name, owns));
    }
    // The turn ran across a database switch: its save is queued to its own database above, and the
    // screen now belongs to the new one, so the chat is closed with a notice.
    if (movedAway) closeGoneThread("otherDatabase");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Called by ChatPanel's submitPrompt right after it commits the user's turn
  // into history/display, before awaiting the model. A brand-new thread
  // normally gets no row until its first turn SETTLES (the busy-persist effect
  // above). But if the user switches to a DIFFERENT thread before the reply
  // lands, selectThread() replaces history/display and aborts this send, and
  // the busy-persist effect then saves the OTHER thread: the abandoned new
  // thread's just-sent message would be lost. Inserting (and saving) a minimal
  // row the instant its first send starts closes that window. No-ops once the
  // thread already has a row, so every later turn is still exactly one save.
  //
  // ★★★ `activeThreadId === null` MUST be handled here too, not bailed on —
  // a fresh Turso project starts in exactly that state, and it is the MOST
  // COMMON entry point of all: the very first message in a new project. Mint
  // an id and ADOPT it as the active thread before inserting the row, so a
  // switch-away has nothing left to abandon.
  //
  // Returns the resolved thread id — the existing active one, or the one just
  // minted and adopted. The CALLER (submitPrompt in chat-panel.tsx) captures
  // its OWN `sendThreadId` FROM THIS RETURN VALUE, never from `activeThreadId`
  // read before calling this (that would still see the pre-mint `null`).
  //
  // ★★ IN FILE MODE IT RETURNS `threadIdRef.current` — the CURRENT ref value,
  // NOT `null`. There is no thread concept in file mode, so the caller's
  // staleness guards must be INERT there, and returning the live ref is what
  // makes them inert. A hardcoded `null` was a live regression: a panel that
  // was in Turso mode and then had `tursoMode` flip false (`panel-chat` is
  // mounted unconditionally, so it never remounts) keeps the OLD Turso thread
  // id in `threadIdRef`, and `stale()` was then true on its FIRST evaluation —
  // every file-mode send became a silent no-op.
  function ensureThreadForSend(sentHistory: ApiMessage[], sentDisplay: DisplayItem[]): string | null {
    // Before the file-mode bail, so the counter measures SENDS rather than
    // Turso sends. retryLoad, its only reader, is tursoMode-gated anyway.
    sendSeqRef.current += 1;
    if (!tursoMode) return threadIdRef.current;
    setThreadClosed(false);
    const id = activeThreadId ?? newThreadId();
    if (activeThreadId === null) {
      // Keep threadIdRef in lockstep with the mint SYNCHRONOUSLY: the sync
      // effect above treats ANY `threadIdRef.current !== activeThreadId`
      // transition as a user-initiated thread SWITCH and aborts whatever send is
      // in flight — which, at that point, is the very send this call is part of.
      threadIdRef.current = id;
      setActiveThreadId(id);
    }
    // No await happened between this render and this call — the `threads`
    // closure is still fresh, so it's safe to decide "does this thread already
    // have a row" from it directly.
    if (threads.some((th) => th.id === id)) return id;
    // The active thread is another database's (the list has moved on, its load has not settled): no
    // row is inserted or saved here.
    if (!claimSource(urlOf(tursoConfig), id)) return id;
    const now = new Date().toISOString();
    const inserted: ChatThread = {
      id,
      projectId,
      ownerId: null,
      name: deriveThreadName(sentDisplay),
      createdAt: now,
      updatedAt: now,
      history: stripAttachmentsForPersistence(sentHistory),
      display: sentDisplay,
    };
    setThreads((prev) => (prev.some((th) => th.id === id) ? prev : [inserted, ...prev]));
    if (!saveGate) return id;
    const scope = renameScope();
    runPersist(id, saveAction(tursoConfig, inserted, saveGate), (owns) => confirmSavedName(scope, id, inserted.name, owns));
    return id;
  }

  function selectThread(id: string) {
    if (id === activeThreadId) return;
    setThreadClosed(false);
    const target = threads.find((th) => th.id === id);
    setActiveThreadId(id);
    setHistory(target?.history ?? []);
    setDisplay(target?.display ?? []);
  }

  function newThread() {
    setThreadClosed(false);
    setActiveThreadId(newThreadId());
    setHistory([]);
    setDisplay([]);
    // No row inserted yet — ensureThreadForSend (on the first send) or the
    // busy-persist effect (once that turn settles) inserts it.
  }

  const { erase, requestDeleteThread } = useChatErase({
    tursoConfig, projectId, lang, confirm, deleteGate, knownOwnerId: identity.knownOwnerId, threads, threadsRef,
    threadIdRef, projectEpochRef, setThreads, setActiveThreadId, setHistory, setDisplay,
    knownIdentity: identity.knownIdentity, storedIdentity: identity.storedIdentity, writeConfig, renameScope, runPersist,
    forgetRetries: queue.forgetRetries, savesSettled: (config) => queue.savesSettled(urlOf(config)), loadVisibleThreads,
  });

  return {
    erase,
    threads,
    activeThreadId,
    threadsError,
    persistence,
    threadClosed,
    threadCloseReason,
    startNewIdentity: identity.startNewIdentity,
    setThreadsError,
    setThreads,
    threadIdRef,
    ensureThreadForSend,
    selectThread,
    newThread,
    renameThread: renames.renameThread,
    trackRenameDraft: renames.trackRenameDraft,
    cancelRenameDraft: renames.cancelRenameDraft,
    requestDeleteThread,
    retryLoad,
  };
}
