"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PaperClipIcon } from "./icons";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type Lang, type TranslationKey, t } from "./i18n";
import { type OperatingGuide } from "./operating-guide";
import { ChatPromptChips } from "./chat-prompt-chips";
import { Markdown } from "./markdown";
import { CHAT_MESSAGE_MAX } from "./sanitize";
import type { AiConfig, Settings } from "./settings-types";
import { clampMaxChatTurns } from "./settings-types";
import type { ChatConversation } from "./workspace-tab-context";
import { useAiUsageContext } from "./ai-usage-context";
import { useResizable } from "./use-resizable";
import { ResetSizeButton } from "./task-manager-ui";
import { useChatModels } from "./use-chat-models";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION, PRESS } from "./interaction-styles";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Checkbox, Input, Select } from "./form-controls";
import { Banner } from "./banner";
import { FieldError } from "./field-feedback";
import { unlockSecret } from "./use-secrets";
import { useConfirm } from "./confirm-dialog";
import { isPassphraseLocked } from "./secrets-store";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import {
  type AttachmentBlock,
  ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
  MAX_STAGED_PAYLOAD_BYTES,
  blocksPayloadBytes,
  planStaging,
  type StagingCandidate,
} from "./chat-attachments";
import { flattenIngestBlocks, ingestFile } from "./attachment-ingest";
import { buildAttachmentSummary } from "./chat-attachment-summary";
import {
  buildStableSystemBlocks,
  buildTurnContext,
  callClaude,
  appendUserNote,
  closeDanglingToolUses,
  CONTINUE_NUDGE,
  INTERRUPTED_TOOL_RESULT,
  stringifyResult,
  type TextBlock,
  type ContentBlock,
  type ToolResultBlock,
  type ApiMessage,
  type DisplayItem,
} from "./chat-api";
import { buildWireMessages } from "./chat-cache-layout";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { ToolBlock } from "./chat-tool-block";
import type { TursoConfig } from "./turso-config";
import { dropStaleScopeWrite, isScopeStale, type ScopeEpochReader } from "./scope-epoch";
import { useChatThreads } from "./use-chat-threads";
import { ChatThreadSidebar } from "./chat-thread-sidebar";
import {
  buildPlanRows,
  cascadeDeselect,
  shouldStage,
  type PlanRow,
  type ProposedCall,
} from "./chat-proposal";
import { describeProposal, type DescribedRow } from "./chat-proposal-describe";
import {
  ChatProposalBlock,
  proposalRowTitle,
  type ProposalCardRow,
} from "./chat-proposal-block";
import {
  applyProposal,
  failureKindOf,
  type FailedAppliedRow,
  type ProposalFailureKind,
} from "./chat-proposal-apply";
import {
  isCascadedRow,
  mintProvisionalIds,
  newProposalId,
  proposalTitles,
  appliedProposalNotice,
  stagedToolResult,
} from "./chat-proposal-stage";
import type { UndoBatch } from "./use-undo-batch";
import { emptyWorkspace, type Workspace } from "./workspace";

// A staged upload: the Anthropic content blocks plus display metadata.
// summary is the non-error disclosure of what the tree under this file
// contained (null for a flat file with nothing to disclose).
//
// ★★ `blocks` IS PLURAL AND ONE CHIP STAYS ONE CHIP: the chip is per dropped
// FILE, the blocks are per walked NODE, so a mail carrying a spreadsheet is
// one chip and two blocks. Collapsing this back to a single `block` is how
// the walk's output went unsent — see flattenIngestBlocks.
type StagedAttachment = { id: string; name: string; blocks: AttachmentBlock[]; summary: string | null };

// Full-width, drag-to-resize pane (same chrome as the primary views).
const CHAT_PANE_CLASS = VIEW_PANE_RESIZABLE_CLASS;

/** The live plan behind a `{kind:"proposal"}` marker in the transcript.
 *
 *  ★★★ IT IS DELIBERATELY NOT PART OF `ChatConversation`. Both `history` and
 *   `display` are persisted, so anything stored on a display item can be
 *   restored much later and would offer to apply a plan staged against a
 *   workspace that has since moved. This state is component-local, dies with
 *   the panel's state, and is bound to the transcript ONLY by `id` — see the
 *   `DisplayItem` proposal variant for the full reasoning. */
interface PendingProposal {
  readonly id: string;
  readonly rows: readonly DescribedRow[];
  /** The SAME array `describeProposal` was handed, kept because the dependency
   *  graph lives here and nowhere else — `DescribedRow` keeps only `mintedId`
   *  and `pendingOn`, while `cascadeDeselect` walks `dependsOn`/`dependsOnAll`.
   *  Positionally aligned with `rows`, as `describeProposal` requires. */
  readonly planRows: readonly PlanRow[];
  /** One per row, positionally aligned — resolved against the live workspace at
   *  staging time so an `update_*` row is titled by its target, not its tool. */
  readonly titles: readonly string[];
  readonly selected: ReadonlySet<number>;
  readonly applying: boolean;
  /** Row indices `applyProposal` reported as not applied → WHY.
   *  ★★ A Map, not a Set: the apply path distinguishes four outcomes and
   *  collapsing them here is what made the card call every one a conflict. */
  readonly failed: ReadonlyMap<number, ProposalFailureKind>;
  /** How many rows the last Apply actually committed, or `null` before any
   *  Apply on this card.
   *
   *  ★★★ SUCCESS HAD NO REPRESENTATION AT ALL, and that is why a working Apply
   *   read as a dead button: on a clean run the selection empties and Apply
   *   disables itself, which is pixel-identical to a no-op. Every other outcome
   *   the card can reach — four failure kinds — had a string; the one that
   *   normally happens had none. `null` is deliberately distinct from `0`: no
   *   Apply yet, versus an Apply that committed nothing. */
  readonly applied: number | null;
}

/** `runBatched`'s stand-in when no batch was threaded: run the plan, collect
 *  nothing, so each write pushes its own undo entry.
 *
 *  ★ ANNOTATED, not inlined at the call site: the property is GENERIC
 *   (`<T>(fn: () => Promise<T>) => Promise<T>`), and a bare `(fn) => fn()`
 *   written inline infers `Promise<unknown>` and fails to satisfy it. */
const RUN_UNBATCHED: UndoBatch["runBatched"] = (fn) => fn();

/** The staging path's fallback workspace when no `workspace` prop was threaded.
 *
 *  ★★ NEVER CALLED DURING RENDER — `emptyWorkspace()` reads the clock, which
 *   the react-hooks purity rule bans in a component body. Every call site here
 *   is inside the async send. */
function stagingWorkspace(ws: Workspace | undefined): Workspace {
  return ws ?? emptyWorkspace();
}

/** True when a drag carries files — the only drag the pane-root drop target
 *  claims. Text and link drags must pass through to the composer. */
function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes("Files");
}

function ChatPanelImpl({
  lang,
  ai,
  dictation,
  dispatcher,
  onAcceptConsent,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
  tursoMode = false,
  tursoConfig = null,
  workspace,
  runBatched,
  getScopeEpoch,
  isSwapInFlight,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
  /** Turso-only multi-thread sidebar + persistence. False/null (the default)
   *  in file mode and in tests/popouts that don't pass them — chat behaves
   *  exactly as before: one ephemeral in-memory conversation, no sidebar. */
  tursoMode?: boolean;
  tursoConfig?: TursoConfig | null;
} & ChatProposalProps &
  ChatConversationStoreProps &
  ChatScopeProps) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner
      lang={lang}
      ai={ai}
      dictation={dictation}
      dispatcher={dispatcher}
      onChangeModel={onChangeModel}
      guides={guides}
      guidesReady={guidesReady}
      chatSeed={chatSeed}
      onChatSeedConsumed={onChatSeedConsumed}
      onConfigureAi={onConfigureAi}
      projectId={projectId}
      getChatConversation={getChatConversation}
      saveChatConversation={saveChatConversation}
      tursoMode={tursoMode}
      tursoConfig={tursoConfig}
      workspace={workspace}
      runBatched={runBatched}
      getScopeEpoch={getScopeEpoch}
      isSwapInFlight={isSwapInFlight}
    />
  );
}

/** §548/§596 — this panel's two windows onto storage scope, both REQUIRED.
 *
 *  ★★★ REQUIRED IS THE POINT, and it is the one thing `ChatProposalProps` below
 *   deliberately did not do. An optional reader that nobody threads degrades to
 *   the pre-§548 behaviour SILENTLY — `scope-epoch.ts`'s header records
 *   `tasks-section.tsx` living that way for a whole release. The cost is that every
 *   `<ChatPanel>` mount in `chat-panel.test.tsx` has to say so — they spread one
 *   `SCOPE_PROPS` const; count them with `grep -c "<ChatPanel" src/app/chat-panel.test.tsx`
 *   rather than trusting a number here. That churn is what buys a tsc error
 *   instead of a turn writing into the next project. */
interface ChatScopeProps {
  /** Reads `useStorageBackend`'s scope epoch. Captured once per send and
   *  re-read at every `stale()` check and between individual tool calls. */
  getScopeEpoch: ScopeEpochReader;
  /** True while an op that will replace this workspace with ANOTHER project's is
   *  in flight.
   *
   *  ★★★ NOT THE LOAD HOLD, AND THIS DOC SAID "a project swap / load hold" UNTIL
   *   THE TWO WERE SPLIT. `loadPending` rises for all ten held ops plus
   *   `!hydrated` plus every backend rebuild; this rises for the FOUR
   *   `holdDuring(..., "changes-scope")` rows alone. Naming the load hold here
   *   makes them read as one signal, which is the coupling the split deliberately
   *   broke — a Save-As, a cancelled OS dialog and a same-project reload all
   *   raise the hold and must NOT cancel the user's turn.
   *  ★★★ READ FROM THE UNMOUNT CLEANUP, WHICH IS WHY IT IS A FUNCTION AND NOT A
   *   BOOLEAN. The teardown and the commit raising the hold are the same commit,
   *   so this panel's last render saw the pre-swap value — any prop or ref
   *   mirroring a render value is stale exactly when the cleanup asks. The
   *   backing ref moves synchronously inside `holdDuring`. */
  isSwapInFlight: () => boolean;
}

/** Wiring for the destructive-write review card. BOTH are optional with safe
 *  defaults so the existing `<ChatPanel>` mounts in `chat-panel.test.tsx`
 *  compile unchanged; the PRODUCTION seam is pinned by
 *  `workspace-section.test.tsx`.
 *
 *  ★★ NO COUNT IS QUOTED HERE ON PURPOSE. This said "~39" while the real number
 *   was 57 — and it sat four lines under a docstring telling you not to trust a
 *   number in a comment. Read it if you need it, never off this line:
 *   `grep -c "<ChatPanel" src/app/chat-panel.test.tsx`
 *  ★ Contrast `ChatScopeProps` directly above, which is REQUIRED: that is the
 *   whole point of the distinction, and it is why those mounts did NOT compile
 *   unchanged when the scope readers landed. Optional buys silence; required
 *   buys a tsc error. Only one of those can catch an unthreaded prop.
 *
 *  ★★ THE TWO DEGRADE DIFFERENTLY AND NEITHER LOSES DATA. Without `workspace`
 *   the card still lists every staged call and apply still replays it — only the
 *   per-row DIFF and the resolved row title are lost, because there is nothing
 *   to ground them against. Without `runBatched` an applied plan pushes ONE undo
 *   entry PER WRITE instead of one for the plan; every write is still
 *   individually reversible.
 *
 *  ★ A REQUIRED prop would be the stronger guarantee and was rejected only on
 *   edit cost. If a third consumer of `ChatPanel` ever appears, make them
 *   required and pay the churn — a silently unwired card is a disclosure the
 *   user never sees. */
interface ChatProposalProps {
  /** The live workspace, for grounding a staged plan's diffs and row titles.
   *  Read through a ref at staging time, never captured at send time. */
  workspace?: Workspace;
  /** `useUndoBatch(...).runBatched` from the SAME batch whose `.undo` is the
   *  dispatcher's `undo` prop. A DIFFERENT instance would collect nothing —
   *  the captures would go straight to the live stack — and nothing would say
   *  so; see the wiring comment in `task-manager.tsx`. */
  runBatched?: UndoBatch["runBatched"];
}

/** Optional in-memory per-project conversation store (from WorkspaceTabProvider)
 *  so the chat survives view-navigation remounts. Absent in tests/popout →
 *  ChatPanel behaves as a fresh, non-persisted conversation. */
interface ChatConversationStoreProps {
  projectId?: string;
  getChatConversation?: (projectId: string) => ChatConversation | undefined;
  saveChatConversation?: (projectId: string, conv: ChatConversation) => void;
}

// Memoized export: with the dispatcher's stable identity (slice 5) and an
// upstream useCallback for onAcceptConsent, all four props are reference-
// stable across parent renders that don't touch lang/ai. ChatPanel now
// skips re-renders triggered by, e.g., task-form keystrokes.
export const ChatPanel = memo(ChatPanelImpl);

function ChatPanelInner({
  lang,
  ai,
  dictation,
  dispatcher,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
  tursoMode = false,
  tursoConfig = null,
  workspace,
  runBatched,
  getScopeEpoch,
  isSwapInFlight,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
  tursoMode?: boolean;
  tursoConfig?: TursoConfig | null;
} & ChatProposalProps &
  ChatConversationStoreProps &
  ChatScopeProps) {
  const confirm = useConfirm();
  // Restore this project's in-memory conversation on (re)mount — the modern
  // shell remounts the chat view on every visit, so local state alone is lost.
  const [history, setHistory] = useState<ApiMessage[]>(
    () => getChatConversation?.(projectId)?.history ?? [],
  );
  const [display, setDisplay] = useState<DisplayItem[]>(
    () => getChatConversation?.(projectId)?.display ?? [],
  );
  // Project switch WHILE the panel stays mounted: swap to that project's
  // conversation. Render-time reconcile (guarded by seenProjectId), NOT an
  // effect — the set-state-in-effect ban. Seeding from the live projectId is
  // correct here (steady-state prop, not a request/nonce — no remount-swallow).
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  // A staged plan is bound to ONE project's rows, ids and concurrency tokens.
  // `panel-chat` is one of the two tabpanels `workspace-section` mounts
  // UNCONDITIONALLY (`hidden={activeTab !== …}`), so this panel NEVER remounts
  // and nothing clears project-scoped state for us — see the reconcile below.
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  if (projectId !== seenProjectId) {
    setSeenProjectId(projectId);
    // ★★★ OUTSIDE the `!tursoMode` branch on purpose. The plan must go in BOTH
    // modes: in Turso mode the transcript is replaced asynchronously by the
    // thread-list fetch, so leaving the plan here would keep a project A card
    // live over project B for the length of that round trip. Clearing it
    // synchronously closes that window in the one place both modes pass
    // through.
    setPendingProposal(null);
    // Turso mode resets history/display asynchronously via the thread-list
    // fetch effect below (it needs an await, so it can't be a synchronous
    // render-time reconcile) — skip the file-mode in-memory-cache path here.
    if (!tursoMode) {
      const next = getChatConversation?.(projectId);
      setHistory(next?.history ?? []);
      setDisplay(next?.display ?? []);
    }
  }
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Passphrase-unlock state: when the saved Anthropic key is passphrase-wrapped
  // (no plaintext key in settings) the user unlocks it inline here; the
  // decrypted value lives in `unlockedKey` for the rest of the session.
  const [unlockedKey, setUnlockedKey] = useState<string | null>(null);
  const [unlockPass, setUnlockPass] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachSeqRef = useRef(0);
  // Read through a ref for the same reason as workspaceRef below: handleFiles
  // is async (every file is read before the cap is enforced), so two picks
  // fired in quick succession would otherwise plan the second against a stale
  // `attachments` closure captured when that pick started.
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  // Latest committed projectId, read by the in-flight send to detect a mid-send
  // project switch (so its trailing writes can't land on the new project).
  const projectIdRef = useRef(projectId);
  // ★★ THE WORKSPACE IS READ THROUGH A REF, NOT FROM THE CLOSURE. Staging
  // happens after `await callClaude(...)`, and `submitPrompt` is redefined every
  // render — so the running closure holds the workspace as it was when SEND was
  // pressed. An edit made while the model was thinking would then be invisible
  // to the plan's diffs and, worse, to `stampCall`'s concurrency tokens. Same
  // ref-sync pattern `use-chat-dispatcher.ts` uses for every live slice it
  // reads. Written in an effect, never during render.
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  // Turso thread state (deps-object hook, AGENTS.md rule 1). Kept as one
  // object — most fields wire onto ChatThreadList in Task 6; submitPrompt
  // below reads .activeThreadId/.threadIdRef and calls .ensureThreadForSend.
  const chatThreads = useChatThreads({
    tursoMode, tursoConfig, projectId, lang, busy, history, display, setHistory, setDisplay, cancelledRef, abortRef, confirm,
  });
  const { ref: chatRef, reset: resetChatSize } = useResizable("aipm-cockpit:chat-size-v2");
  const { record: recordUsage } = useAiUsageContext();
  // Model picker options (live /v1/models when the key is valid, else registry).
  // Uses the session-unlocked key when the saved key is passphrase-wrapped.
  const { options: modelOptions } = useChatModels((unlockedKey ?? ai.apiKey) || "", ai.enabled === true, ai.model);
  const { mic, status, registration } = useDictationMic({
    lang,
    dictation,
    enabled: true,
    label: t(lang, "chatPlaceholder"),
    padding: "px-4! py-2!", // trailing `!` required — see the prop's docstring
    className: "inline-flex items-center justify-center",
    onAppendFinal: (txt) => setInput((prev) => appendDictation(prev, txt)),
  });

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [display, busy]);

  // Persist the conversation to the above-the-view store on every change, so it
  // survives the next remount. Writes a ref (a side effect, not setState) — clear
  // of the set-state-in-effect ban and cannot loop.
  useEffect(() => {
    saveChatConversation?.(projectId, { history, display });
  }, [history, display, projectId, saveChatConversation]);

  // Track the latest projectId and, on a switch WHILE a send is in flight, abort
  // that send (bound to the old project) and mark it cancelled. Its trailing
  // state writes are additionally project-guarded in submitPrompt, so a reply
  // for the old project can never land on — or persist into — the new one. Runs
  // only on an actual change (seed === live on mount → no spurious abort).
  useEffect(() => {
    const prev = projectIdRef.current;
    projectIdRef.current = projectId;
    if (prev !== projectId) {
      cancelledRef.current = true;
      abortRef.current?.abort();
    }
  }, [projectId]);

  // Keyboard interrupt: Escape stops an in-flight response (the textarea is
  // disabled while busy, so this document listener is the keyboard path). Mirrors
  // stopChat's two ref writes; refs are stable so [busy] is the only dep.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't steal Escape from an open modal/dialog (Settings, a task editor,
      // a confirm) — its own handler should own the key — or from a focused
      // control elsewhere (e.g. the top-bar search). Only interrupt when the
      // focus is inside the chat panel (or nowhere in particular).
      if (document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !chatRef.current?.contains(active)) return;
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, chatRef]);

  /** Live handle on `isSwapInFlight` for the unmount cleanup below.
   *
   *  ★ A ref, and the effect below keeps `[]` deps, because putting the prop in
   *   the dep array would make React fire the CLEANUP on every identity change —
   *   i.e. cancel the user's turn on an ordinary re-render, which is the very bug
   *   this pair exists to stop. Only the FUNCTION is captured; it reads live
   *   storage state at call time, so a one-commit-stale identity still answers
   *   correctly (the production reader is a `useCallback([])` and never changes). */
  const isSwapInFlightRef = useRef(isSwapInFlight);
  useEffect(() => { isSwapInFlightRef.current = isSwapInFlight; }, [isSwapInFlight]);

  // ★★★ Cancel an in-flight send when this panel goes away UNDER A SWAP. Before
  // this effect nothing cancelled at all: the keydown cleanup above merely
  // detaches a listener, and the projectId effect fires only on an ACTUAL prop
  // change. Under the §548 load hold `task-manager.tsx` swaps the whole
  // main-window tree for `PanelSkeleton` WITHOUT such a change, so the dying
  // instance's `projectIdRef` is never bumped, its `stale()` reads not-stale
  // forever, and its DISPATCHER is still live (`useStorageBackend` lives in
  // `TaskManager`, which does not unmount) — so a turn in flight across a project
  // swap ran its tools into the project the user swapped TO.
  // ★★ THE DISPATCHER IS THE LIVE PART, not the panel's own setters: `history`
  // and `display` are local `useState` in this component, so those setters are
  // no-ops once it is gone. That asymmetry is the whole shape of the bug — the
  // transcript goes nowhere while the WRITES land.
  // ★★★ CONDITIONAL, §596. An unconditional version shipped first and was a live
  // regression: `modern-shell.tsx`'s content ternary gives `open-points`,
  // `settings` and `learning-insights` their own subtrees, so navigating to any
  // of the three unmounts this panel on an ORDINARY click — and a user who asked
  // the assistant to create tasks and then clicked Open Points to watch them
  // appear got nothing, silently. `isSwapInFlight` is the discriminator.
  // ★★★ AND IT IS NARROWER THAN "A §548 TEARDOWN", which is what this comment
  // said until the B1 fix and is the second regression of this exact shape: SIX
  // of the ten held ops raise the §548 hold and leave it FALSE, because a plain
  // Save-As, a cancelled OS file dialog and a same-project Reload all tear this
  // panel down without the workspace becoming another project's. It is TRUE only
  // while an op that WILL replace this workspace with another project's is in
  // flight (`holdDuring(..., "changes-scope")`, four rows). When it is false the
  // turn is left alone to finish into the project the user is still in — and if
  // the scope did move after all, the epoch drops the write at resolution, which
  // is the correctness guarantee. This cancel is only ever a cost optimisation.
  // ★ Safe under StrictMode's mount→unmount→mount: `submitPrompt` resets
  // `cancelledRef` to false at its own start, so a cancelled flag left by a
  // discarded first mount cannot outlive the next send. `chat-panel.scope.test.tsx`
  // pins both branches of the condition and both halves of that reset.
  useEffect(() => () => {
    if (!isSwapInFlightRef.current()) return;
    cancelledRef.current = true;
    abortRef.current?.abort();
  }, []);

  /** The card's view of the pending plan. `index` is the row's POSITION, which
   *  is the identity `PlanRow.index`, `cascadeDeselect` and `AppliedRow.index`
   *  all key on — `describeProposal` emits one row per call in the input's
   *  order and filters nothing, so the three cannot drift. */
  const proposalCardRows = useMemo<readonly ProposalCardRow[]>(() => {
    const p = pendingProposal;
    if (!p) return [];
    return p.rows.map((row, i) => ({
      index: i,
      call: row.call,
      plan: row.plan,
      // `titles` is resolved against the live workspace; the tool name is the
      // last resort `proposalRowTitle` itself falls back to.
      title: p.titles[i] ?? row.call.name,
      cascaded: isCascadedRow(p.planRows[i], p.selected),
      // ★★ SET FOR EVERY NOT-OK ROW, NOT ONLY THE STALE ONES — under-reporting
      //   is the worse direction and a row that did not land must never read as
      //   applied. `failedKind` (§381) then picks the truthful string for the
      //   kind `p.failed` recorded, rather than the card wearing one string for
      //   all four outcomes.
      failed: p.failed.has(i),
      failedKind: p.failed.get(i),
    }));
  }, [pendingProposal]);

  const guidesPending = ai.groundInGuides && !guidesReady;
  // Master switch: when AI is disabled in Settings, the assistant is fully off
  // regardless of any stored key — force the no-key path so send is blocked.
  const masterOn = ai.enabled === true;
  // The key actually used for calls/gating: a plaintext settings key wins,
  // else the inline-unlocked passphrase key (if any).
  const effectiveApiKey = masterOn ? (ai.apiKey.trim() ? ai.apiKey : (unlockedKey ?? "")) : "";
  const apiKeyMissing = !effectiveApiKey.trim();
  // Cheap synchronous localStorage read — fine in the render body (pure read).
  const apiKeyLocked =
    masterOn && !ai.apiKey.trim() && unlockedKey === null && isPassphraseLocked("anthropicApiKey");

  async function submitPrompt(textArg?: string) {
    const text = (textArg ?? input).trim().slice(0, CHAT_MESSAGE_MAX);
    const atts = attachments;
    if ((!text && atts.length === 0) || busy || guidesPending) return;
    if (!effectiveApiKey.trim()) {
      setError(t(lang, "chatNoApiKey"));
      return;
    }
    setError(null);
    setInput("");
    setAttachments([]);
    setBusy(true);
    cancelledRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    // Bind this send to the project it started on. The THREAD half of this
    // binding (`sendThreadId`) is captured further down, only after
    // ensureThreadForSend has resolved — see the comment there.
    const sendProjectId = projectId;
    // §596 — the SCOPE half of this send's binding, captured before the first
    // await like every other §548 writer. `sendProjectId` cannot see a
    // storage-target change that KEEPS the project id — a Turso URL or token
    // change, a SharePoint target swap, a same-project reload — because it
    // compares the very thing those leave alone. The epoch can: it moves on
    // exactly the replacements that make this send's workspace the wrong one.
    const sendEpoch = getScopeEpoch();

    // With attachments the user turn is a multimodal content array (text first,
    // then each document/image block); otherwise a plain string.
    const content: string | ContentBlock[] =
      atts.length > 0
        ? [
            ...(text ? [{ type: "text", text } as TextBlock] : []),
            ...atts.flatMap((a) => a.blocks),
          ]
        : text;
    // Heal any dangling tool_use left by a prior truncated/stopped turn before
    // appending this turn — else the API 400s on the unmatched tool_use and the
    // chat wedges (every subsequent send re-posts the corrupt history).
    const newHistory: ApiMessage[] = [
      ...closeDanglingToolUses(history),
      { role: "user", content },
    ];
    setHistory(newHistory);
    const displayText =
      atts.length > 0
        ? [text, ...atts.map((a) => `📎 ${a.name}`)].filter(Boolean).join("\n")
        : text;
    const userDisplayItem: DisplayItem = { kind: "user", text: displayText };
    setDisplay((prev) => [...prev, userDisplayItem]);
    // Insert+save a row for a brand-new thread NOW, not once the turn
    // settles — else a mid-send switch to another thread loses this message
    // with no recovery path (see ensureThreadForSend's doc comment). This
    // ALSO covers the case where no thread was active yet at all (a fresh
    // Turso project) — ensureThreadForSend mints and adopts an id itself in
    // that case.
    //
    // `sendThreadId` is captured from the RETURN VALUE, not from
    // `chatThreads.activeThreadId` read earlier — reading it before this
    // call would still see the pre-mint `null` on a fresh project's first
    // send, and every `threadIdRef.current !== sendThreadId` guard below
    // would then wrongly see the newly-adopted id as a mismatch and treat
    // this send as already stale (see ensureThreadForSend's own comment).
    const sendThreadId = chatThreads.ensureThreadForSend(newHistory, [...display, userDisplayItem]);
    // ★ ONE predicate, so the three existing check sites (before the call, after
    //   it, and after the transcript append) all gain the scope test together —
    //   a fourth, per-TOOL check lives inside the loop below for the case none of
    //   these can reach.
    const stale = () =>
      cancelledRef.current || projectIdRef.current !== sendProjectId || chatThreads.threadIdRef.current !== sendThreadId || isScopeStale(getScopeEpoch, sendEpoch);

    const snapshot = dispatcher.getSnapshot();
    const system = buildStableSystemBlocks(lang, snapshot, guides, ai.groundInGuides, ai);
    const turnContext = buildTurnContext(lang, snapshot, guides, ai.groundInGuides, ai);
    // ★★★ WIRE-ONLY. `messages` stays the PERSISTED history; the turn context is
    //     injected into the outgoing copy alone. Persisting it would leave stale
    //     "Today is ..." down the transcript AND rewrite history's tail on every
    //     send, which destroys the byte-identical prefix the cache depends on.
    const messages = newHistory.slice();

    try {
      // Accumulate token usage across all turns for this send.
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheWrite = 0;
      let totalCacheRead = 0;
      // When the previous turn was a max_tokens continuation, the next turn's
      // text is appended to the SAME bubble (a split mid code-fence/table would
      // otherwise render as two broken blocks). `completed` distinguishes a clean
      // end_turn from exhausting the round-trip cap (so we can flag a partial).
      let continueBubble = false;
      let completed = false;

      // Round-trip loop: keep going until the model finishes (end_turn). Two
      // reasons to continue — a tool call to run, or a length-cap truncation to
      // resume — both share the turn budget (a runaway guard).
      // Clamp at the read site too (defence in depth): a directly-typed
      // out-of-range value that bypassed the input clamp can never drive an
      // unbounded number of billed API calls.
      const maxTurns = clampMaxChatTurns(ai.maxChatTurns);
      for (let turn = 0; turn < maxTurns; turn++) {
        if (stale()) break;
        const response = await callClaude(
          effectiveApiKey,
          ai.model,
          system,
          buildWireMessages(messages, turnContext).messages,
          ai, controller.signal,
        );
        // A cancel or a project switch may have landed while awaiting — bail
        // before writing this turn onto (possibly) another project's state.
        if (stale()) break;
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;
        totalCacheWrite += response.usage.cache_creation_input_tokens;
        totalCacheRead += response.usage.cache_read_input_tokens;

        const assistantMsg: ApiMessage = {
          role: "assistant",
          content: response.content,
        };
        messages.push(assistantMsg);

        const turnText = response.content
          .filter((b): b is TextBlock => b.type === "text" && b.text.trim() !== "")
          .map((b) => b.text)
          .join("");
        if (turnText) {
          const stitch = continueBubble;
          setDisplay((prev) => {
            if (stitch) {
              const last = prev[prev.length - 1];
              if (last && last.kind === "assistant") {
                return [...prev.slice(0, -1), { ...last, text: last.text + turnText }];
              }
            }
            return [...prev, { kind: "assistant", text: turnText }];
          });
        }

        if (stale()) break;

        // Complete tool call: run each tool, feed the results back, loop so the
        // model can use them.
        if (response.stop_reason === "tool_use") {
          // The turn's calls, paired with the ids their results must answer.
          const proposed: { readonly useId: string; readonly call: ProposedCall }[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            proposed.push({
              useId: block.id,
              // `ToolUseBlock.input` is `unknown` (the API's own shape). The
              // gate, the plan builder and `runTool` all treat it as a bag of
              // keys, exactly as the immediate path below does when it hands
              // `block.input` straight to `runTool`.
              call: { name: block.name, input: block.input as Readonly<Record<string, unknown>> },
            });
          }

          // ★★★ THE GATE. A turn holding a destructive call, or more than one
          // entity write, is STAGED: nothing runs, a review card goes into the
          // transcript, and every `tool_use` id is still answered. A turn that
          // does not stage takes the original path below UNCHANGED — that
          // equivalence is pinned by a test, because "one extra branch" is how
          // a working path acquires a condition nobody meant to add.
          if (shouldStage(proposed.map((p) => p.call))) {
            const ws = stagingWorkspace(workspaceRef.current);
            const calls = proposed.map((p) => p.call);
            // ★★★ `mintProvisionalIds` ADVANCES the session mark, so every
            // provisional id differs from the one apply mints and the remap is
            // exercised on every create. See its own docstring for what a
            // peek-based mint would have made dormant.
            const planRows = buildPlanRows(calls, mintProvisionalIds(calls, ws));
            const described = describeProposal(calls, ws, planRows);
            const proposalId = newProposalId();
            setPendingProposal({
              id: proposalId,
              rows: described,
              planRows,
              titles: proposalTitles(described, ws, (r) => proposalRowTitle(r.call, r.plan)),
              // Everything starts kept: the card is a chance to REFUSE, and a
              // plan that arrives all-unchecked reads as "nothing to do here".
              selected: new Set(described.map((_, i) => i)),
              applying: false,
              failed: new Map<number, ProposalFailureKind>(),
              applied: null,
            });
            setDisplay((prev) => [
              ...prev,
              { kind: "proposal", id: proposalId, count: described.length },
            ]);
            // ★★★ EVERY `tool_use` ID IS ANSWERED, staged or not. An unanswered
            // id makes the NEXT request a 400 and wedges the chat for good —
            // `closeDanglingToolUses` exists because of exactly that. The
            // result also carries the create's provisional id, so a later call
            // in this same turn can name the row the plan will create.
            messages.push({
              role: "user",
              content: proposed.map(
                (p, i): ToolResultBlock => ({
                  type: "tool_result",
                  tool_use_id: p.useId,
                  content: stagedToolResult(planRows[i].mintedId),
                }),
              ),
            });
            continueBubble = false;
            continue;
          }

          const results: ToolResultBlock[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            // ★★★ §596 — RE-CHECKED PER TOOL, NOT PER TURN, and no `stale()` call
            // site can stand in for this one: all three run BEFORE this loop. A
            // turn can carry several `tool_use` blocks, so a scope move landing
            // mid-batch would otherwise let every REMAINING tool write into the
            // next project. Scope only — cancel and the project/thread refs are
            // the outer loop's job and cannot move here.
            // ★★ WHAT CAN MOVE IT BETWEEN TWO TOOLS, stated narrowly because the
            // first version of this comment said "each `runTool` awaits" and that
            // is false — `chat-tools.ts` contains no `await` at all
            // (`grep -c await src/app/chat-tools.ts` → 0), so `runTool` resolves
            // on the next microtask and nothing that needs a task (a click, a
            // timer, IO) can interleave. What CAN move it is a dispatcher handler
            // itself, which is a write surface into the same app — that is the
            // case pinned by "stops a multi-tool turn at the tool where the scope
            // changed". The rest is cheap insurance for the day a handler becomes
            // genuinely async.
            if (dropStaleScopeWrite(getScopeEpoch, sendEpoch, "chat-panel.toolLoop", { tool: block.name })) break;
            let resultStr: string;
            let isError = false;
            try {
              const r = await runTool(dispatcher, block.name, block.input);
              resultStr = stringifyResult(r);
            } catch (err) {
              isError = true;
              resultStr = err instanceof Error ? err.message : String(err);
            }
            setDisplay((prev) => [
              ...prev,
              {
                kind: "tool",
                name: block.name,
                input: block.input,
                result: resultStr,
                error: isError,
              },
            ]);
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: resultStr,
              is_error: isError ? true : undefined,
            });
          }

          // ★★★ NEVER PUSH AN EMPTY CARRIER. `content: []` is not "a carrier with
          // nothing in it" to the API — it is an INVALID message, and it kills the
          // conversation permanently: `closeDanglingToolUses` runs at the top of
          // every send and (before §596) had no rule that removes an empty
          // message, so every later send rebuilt the same invalid array, and in
          // Turso mode the `setHistory` below is persisted by `use-chat-threads`'s
          // save effect, so it survives reload and tab close. A new thread is the
          // only recovery.
          // ★★★ IT DOES NOT BITE ON *THIS* SEND'S CONTINUATION, AND GUESSING THAT
          // IT DID PRODUCED A GREEN TEST AGAINST THE UNGUARDED CODE. While the
          // empty message is the history TAIL, `buildWireMessages` appends the
          // turn-context block INTO a trailing user message, so the wire sees
          // `content: [ctx]` and the next round trip looks perfectly healthy. The
          // damage lands on the NEXT send: the user's new turn is appended after
          // the empty one, which is then no longer the tail, gets no backfill, and
          // goes out as `content: []` behind two consecutive `user` turns. Any
          // test of this must span TWO sends; one that reads this send's second
          // request passes either way.
          // ★★ TWO WAYS TO GET HERE WITH NOTHING, and only the second needs an
          // await, which is why the guard is at the SOURCE rather than left to a
          // downstream repair. (1) A turn with `stop_reason: "tool_use"` and no
          // `tool_use` block in its content — malformed, but it is external data
          // and nothing upstream validates it; `shouldStage([])` is false, so it
          // reaches this loop and matches nothing. That one is reachable TODAY
          // and is pinned by "a tool_use turn carrying no tool_use block…" in
          // `chat-panel.test.tsx`. (2) The §596 per-tool guard breaking on the
          // FIRST tool — unreachable today, since nothing awaits between the
          // post-`callClaude` `stale()` and the first `runTool`, and deliberately
          // guarded anyway rather than left as a trap for whoever adds one.
          // ★ Skipping the push is correct, not a second bug: the assistant turn
          // then has NO carrier at all, which is exactly the shape
          // `closeDanglingToolUses` was written to repair, and it runs before the
          // next request either way.
          if (results.length > 0) {
            messages.push({ role: "user", content: results });
          }
          continueBubble = false; // tool output breaks the text flow — new bubble
          continue;
        }

        // Truncated at the length cap: resume transparently instead of dumping a
        // cut-off message and waiting for the user to prod. Any tool_use blocks
        // in a truncated turn may be partial — DON'T execute them; answer them
        // with interrupted results (so the protocol stays valid and the model
        // re-issues them cleanly), then nudge it to continue where it left off.
        if (response.stop_reason === "max_tokens") {
          const parts: ContentBlock[] = [];
          for (const block of response.content) {
            if (block.type === "tool_use") {
              parts.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: INTERRUPTED_TOOL_RESULT,
                is_error: true,
              });
            }
          }
          parts.push({ type: "text", text: CONTINUE_NUDGE });
          messages.push({ role: "user", content: parts });
          continueBubble = true; // stitch the resumed text onto the same bubble
          continue;
        }

        // end_turn / stop_sequence — the model is done.
        completed = true;
        break;
      }

      // If the user switched project or thread mid-send, this run belongs to
      // another conversation now showing on screen — don't write its notes or
      // history onto the current one (billing is still recorded).
      // ★★ §596 — THIS DELIBERATELY DOES *NOT* INCLUDE `isScopeStale(getScopeEpoch,
      //   sendEpoch)`, although `stale()` (declared beside `sendThreadId`) does. The two gate
      //   different things and want OPPOSITE answers: the epoch gates WORKSPACE
      //   WRITES (drop them — they would land in the wrong project), this gates
      //   USER-FACING DISCLOSURE. On an epoch-only move the panel has not
      //   remounted and `projectId` has not changed, so the conversation on screen
      //   is still THIS one, so the `chatTruncatedNote` below belongs to it. Drop
      //   the write, still try to tell the user.
      // ★★ "TRY" IS EXACT, AND AN EARLIER VERSION OF THIS ARGUMENT OVERCLAIMED IT.
      //   It called the note "the user's ONLY signal", which is not a reason that
      //   survives its own premises: a scope move that arrives through the §548
      //   hold unmounts this panel (`task-manager.tsx` renders `PanelSkeleton`
      //   while `loadPending`, and `scope-epoch.ts`'s header argues `loadPending`
      //   is committed-true at every bump), and a note appended to an unmounted
      //   component reaches nobody and is never persisted. The note is BEST-EFFORT.
      //   The decision stands on the narrower claim that survives: this gate asks a
      //   DIFFERENT question from the epoch, and answering it with the epoch can
      //   only ever suppress a disclosure — it cannot make one appear. Suppressing
      //   is the failure mode we are avoiding, so an unreliable note beats none.
      // ★★★ THE WRONG FIX, NAMED SO IT IS NOT REDISCOVERED AS AN IMPROVEMENT:
      //   "complete the pattern" by OR-ing the epoch in here, and a dropped turn
      //   becomes invisible — the same silent-failure class as the unconditional
      //   unmount cancel this task had to undo. If you think this needs changing,
      //   the change is a DIFFERENT note ("the storage target changed"), never
      //   silence.
      // ★ NOT a claim that nothing persists. Verify, don't trust this line:
      //   `grep -n "saveThread(" src/app/use-chat-threads.ts` — every hit passes the
      //   LIVE `tursoConfig`, which on a target change is already the NEW one, so a
      //   transcript can land in a different database under the same projectId.
      //   Smaller than a workspace write, out of scope here, and OPEN as §604 in
      //   `docs/open-followups.md` — do not read this bullet as saying it is fine.
      //   ★ The §-number is the point of this sentence: without it a reader can
      //   see the hazard described and has no way to reach the record, which is
      //   indistinguishable from a hazard nobody filed.
      const switchedAway = projectIdRef.current !== sendProjectId || chatThreads.threadIdRef.current !== sendThreadId;
      if (!switchedAway) {
        if (cancelledRef.current) {
          // Stopped by the user — append a neutral note, no error state.
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatStopped") },
          ]);
        } else if (!completed) {
          // Hit the round-trip cap while still continuing (never reached
          // end_turn): surface that the answer is partial, not a silent stop.
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatTruncatedNote") },
          ]);
        }
      }
      if (!cancelledRef.current) {
        // Record summed token usage for the entire send (all turns combined).
        // Skipped on cancel — no complete turn to bill.
        recordUsage({
          input: totalInput,
          output: totalOutput,
          cacheWrite: totalCacheWrite,
          cacheRead: totalCacheRead,
        });
      }

      // Persist a valid history: a max_tokens truncation or a mid-turn Stop can
      // leave the last assistant message with tool_use blocks and no results.
      // Skip when switched away, so the old project's tail can't clobber the new.
      if (!switchedAway) {
        setHistory(closeDanglingToolUses(messages));
      }
    } catch (err) {
      // AbortError is raised by fetch when the controller fires — treat as
      // a user-initiated stop, not a real error. Check .name directly because
      // DOMException may not be instanceof Error across jsdom/Node boundaries.
      const errName = err instanceof Error ? err.name : (err as { name?: string }).name;
      // Suppress when the user switched project or thread mid-send (the abort/
      // error belongs to the old conversation, not the one now on screen).
      if (projectIdRef.current === sendProjectId && chatThreads.threadIdRef.current === sendThreadId) {
        if (errName === "AbortError") {
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatStopped") },
          ]);
        } else if (
          err instanceof AiHttpError &&
          classifyAiError(err.status, err.errorType) === "limit"
        ) {
          // Anthropic's own rate/usage limit. ADVISORY — APPEND a notice to the
          // transcript (do NOT setError-replace or clear prior messages).
          setDisplay((prev) => [
            ...prev,
            { kind: "notice", text: t(lang, "aiUsageLimitReached") },
          ]);
        } else {
          // AiHttpError.message is status-only ("400"); its `safeMessage` (the
          // sanitized RESPONSE error.message, e.g. "prompt is too long: N > M")
          // is appended so a 400 isn't just a bare status digit. Never logged.
          const msg = err instanceof Error ? err.message : String(err);
          const base = t(lang, "chatError", msg);
          const safeMessage = err instanceof AiHttpError ? err.safeMessage : undefined;
          setError(safeMessage ? `${base} — ${safeMessage}` : base);
        }
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      // Refocus the input after the round-trip resolves.
      inputRef.current?.focus();
    }
  }

  /** Toggle one staged row. Deselecting CASCADES to its dependents; selecting
   *  is a plain add, which is safe because a row with an unselected dependency
   *  renders `cascaded` and its checkbox is disabled (see `isCascadedRow`). */
  function toggleProposalRow(index: number) {
    setPendingProposal((prev) => {
      if (!prev || prev.applying) return prev;
      const selected = prev.selected.has(index)
        ? cascadeDeselect(prev.planRows, prev.selected, index)
        : new Set([...prev.selected, index]);
      return { ...prev, selected };
    });
  }

  /**
   * Select every row, or clear the selection.
   *
   * ★★★ SELECTING EVERYTHING IS SAFE, AND FILTERING OUT THE CASCADED ROWS IS
   *  NOT THE SAFER VERSION — it is a bug, which is how this was first written.
   *  "Cascaded" is not a property of a row; `isCascadedRow` is a function of the
   *  CURRENT selection, true exactly when some row this one depends on is
   *  unselected. Every dependency is another row of the same plan, so the
   *  all-selected set makes the predicate false everywhere: nothing is held
   *  back, and the danger `cascadeDeselect` guards — applying a dependent while
   *  its create stays refused — cannot arise.
   *  ★★ The filtered version evaluated the predicate against the selection as it
   *  was BEFORE the click, so a dependent whose create was about to be
   *  re-selected stayed out: select-all then left a row unticked with no
   *  disabled state to explain why. Measured by the test below, which was
   *  written expecting the filter to be right.
   *
   * ★★ CLEARING NEEDS NO CASCADE. `cascadeDeselect` propagates one row's
   *  deselection to its dependents; the empty set already contains that
   *  closure, so calling it per row would be equivalent and slower.
   */
  function toggleAllProposalRows(next: boolean) {
    setPendingProposal((prev) => {
      if (!prev || prev.applying) return prev;
      const selected = next ? new Set(prev.rows.map((_, i) => i)) : new Set<number>();
      return { ...prev, selected };
    });
  }

  /** Discard the plan without writing anything, leaving the transcript honest
   *  about the fact that a proposal was made here. The marker is REPLACED (not
   *  removed) so the surrounding messages keep their order and the discard is
   *  itself part of the record. */
  function discardProposal() {
    const p = pendingProposal;
    if (!p || p.applying) return;
    setPendingProposal(null);
    setDisplay((prev) =>
      prev.map((item) =>
        item.kind === "proposal" && item.id === p.id
          ? { kind: "notice", text: t(lang, "chatProposalDiscarded") }
          : item,
      ),
    );
  }

  /**
   * Replay the kept rows as ONE undoable commit and mark each row's outcome.
   *
   * ★★★ THE SUCCEEDED ROWS ARE DESELECTED AND THE FAILED ONES ARE NOT. That is
   * what stops a second Apply click re-running a write that already landed
   * (`Apply` disables itself at zero selected), while leaving a genuinely stale
   * row checked and marked so the user can retry it after the model re-reads.
   * The card is deliberately NOT unmounted on success: the transcript should
   * still show WHICH writes the user approved.
   *
   * ★★ `runBatched` DEFAULTS TO A PASSTHROUGH, never to a no-op. Without the
   * prop the plan still applies — it simply pushes one undo entry per write
   * instead of one per plan. Swallowing `fn` would drop the writes entirely.
   *
   * ★ Every state write re-checks `prev.id === p.id`: a project switch during
   * the replay clears `pendingProposal`, and a stale resolution must not
   * resurrect the old project's card.
   */
  async function applyPendingProposal() {
    const p = pendingProposal;
    if (!p || p.applying) return;
    setPendingProposal((prev) => (prev?.id === p.id ? { ...prev, applying: true } : prev));
    try {
      const result = await applyProposal({
        dispatcher,
        rows: p.rows,
        selected: p.selected,
        batch: { runBatched: runBatched ?? RUN_UNBATCHED },
      });
      const failed = new Map(
        result.rows
          .filter((r): r is FailedAppliedRow => !r.ok)
          .map((r) => [r.index, failureKindOf(r)] as const),
      );
      const appliedCount = result.rows.length - failed.size;
      setPendingProposal((prev) =>
        prev?.id === p.id
          ? {
              ...prev,
              applying: false,
              failed,
              selected: new Set(failed.keys()),
              applied: appliedCount,
            }
          : prev,
      );
      // ★★★ THE MODEL IS TOLD, and nothing did this before. Its only word on the
      // batch was `STAGED_TOOL_RESULT` ("has NOT been applied"), which nothing
      // superseded — so a later turn reminded the user to approve writes that
      // had already landed, and pointed them at a surface by a name the UI does
      // not use. Reported from the running app.
      // ★★ `appendUserNote` MERGES into the staged turn's trailing user-role
      // tool_result carrier, so the notice sits with the calls it is about. Not
      // an API-validity constraint — consecutive user turns already occur here;
      // see that function's own note, which corrects an earlier claim.
      setHistory((prev) => appendUserNote(prev, appliedProposalNotice(appliedCount, failed.size)));
    } catch (err) {
      // `applyProposal` catches per row, so reaching here means the BATCH
      // itself refused (a nested batch). Nothing was written; surface it and
      // leave the plan exactly as it was so the user can try again.
      setPendingProposal((prev) => (prev?.id === p.id ? { ...prev, applying: false } : prev));
      setError(t(lang, "chatError", err instanceof Error ? err.message : String(err)));
    }
  }

  // Mirror the latest send-gate, submit handler, and consume callback into a
  // ref so the seed effect can read current values while depending only on
  // `chatSeed`. Refs are written in an effect — never during render. React
  // fires effects in declaration order within the same commit, so when
  // `chatSeed` changes this gate-mirror (declared first) refreshes the ref
  // before the seed effect below reads it.
  const sendGateRef = useRef<{ blocked: boolean; submit: (text?: string) => void; consume: () => void }>({
    blocked: true,
    submit: () => {},
    consume: () => {},
  });
  useEffect(() => {
    sendGateRef.current = {
      blocked: guidesPending || apiKeyMissing || busy,
      submit: submitPrompt,
      consume: () => onChatSeedConsumed?.(),
    };
  });

  useEffect(() => {
    if (!chatSeed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(chatSeed.prompt);
    if (chatSeed.autoSend && !sendGateRef.current.blocked) {
      sendGateRef.current.submit(chatSeed.prompt);
    }
    sendGateRef.current.consume();
  }, [chatSeed]);

  async function unlockApiKey() {
    const v = await unlockSecret("anthropicApiKey", unlockPass);
    if (v) {
      setUnlockedKey(v);
      setUnlockPass("");
      setUnlockError(false);
    } else {
      setUnlockError(true);
    }
  }

  function stopChat() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  function clearChat() {
    setHistory([]);
    setDisplay([]);
    setError(null);
    setAttachments([]);
  }

  function attachmentErrorText(
    err: "too-large" | "unsupported-type" | "read-failed" | "encrypted" | "budget-exhausted",
    name: string,
  ): string {
    if (err === "too-large") return t(lang, "chatAttachmentTooLarge", name);
    if (err === "unsupported-type") return t(lang, "chatAttachmentUnsupported", name);
    if (err === "encrypted") return t(lang, "chatAttachmentEncrypted", name);
    // "budget-exhausted" (a mail's attachment tree ran past its shared
    // extraction budget) reuses the generic read-failure copy rather than
    // a dedicated i18n key — it's rare, attachment-specific, and "this
    // attachment couldn't be read" is an honest enough description.
    return t(lang, "chatAttachmentReadFailed", name);
  }

  async function handleFiles(files: FileList | readonly File[] | null) {
    if (!files || files.length === 0) return;
    setError(null);
    // Read every file first, THEN plan which ones fit the cap/budget — the cap
    // is enforced against the set as a whole, not file-by-file as each read
    // resolves (see planStaging).
    const read: StagingCandidate[] = [];
    const summaries = new Map<string, string | null>();
    // Collect every file's failure — a multi-file pick previously overwrote the
    // error state per file, so only the LAST failure was ever shown.
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const result = await ingestFile(file);
      if (!result.ok) {
        errors.push(attachmentErrorText(result.error, file.name));
        continue;
      }
      summaries.set(file.name, buildAttachmentSummary(lang, file.name, result.node));
      read.push({ name: file.name, blocks: flattenIngestBlocks(result.node) });
    }
    const current = attachmentsRef.current;
    const { accepted, rejected } = planStaging(
      current.length,
      blocksPayloadBytes(current.flatMap((a) => a.blocks)),
      read,
    );
    for (const r of rejected) {
      errors.push(
        r.reason === "too-many"
          ? t(lang, "chatAttachmentTooMany", r.name, MAX_CHAT_ATTACHMENTS)
          : t(lang, "chatAttachmentOverBudget", r.name, MAX_STAGED_PAYLOAD_BYTES / (1024 * 1024)),
      );
    }
    const staged: StagedAttachment[] = accepted.map((a) => ({
      id: `att-${(attachSeqRef.current += 1)}`,
      name: a.name,
      blocks: [...a.blocks],
      summary: summaries.get(a.name) ?? null,
    }));
    // Advance the ref NOW, not on the next render: an overlapping pick whose
    // reads resolve before React re-renders must plan against this pick's
    // staged set, or the two together can exceed the cap.
    attachmentsRef.current = [...current, ...staged];
    if (staged.length > 0) setAttachments((prev) => [...prev, ...staged]);
    if (errors.length > 0) setError(errors.join("\n"));
    // Reset the input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  }

  const attachDisabled = busy || apiKeyMissing || guidesPending;

  return (
    // Centered half-size card, top-anchored. The corner drags to a custom size
    // (persisted via useResizable); ResetSizeButton restores the default.
    <div
      ref={chatRef}
      className={CHAT_PANE_CLASS}
      // Only FILE drags are ours: cancelling a text or link drag here would
      // swallow it before it reached the composer textarea.
      onDragOver={(e) => {
        if (attachDisabled || !isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (attachDisabled || !isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        void handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
    <div className="flex h-full min-h-0 flex-1 gap-3">
      {tursoMode && (
        <ChatThreadSidebar
          lang={lang}
          threads={chatThreads.threads}
          activeThreadId={chatThreads.activeThreadId}
          error={chatThreads.threadsError}
          onRetry={chatThreads.retryLoad}
          onSelect={chatThreads.selectThread}
          onNew={chatThreads.newThread}
          onRename={chatThreads.renameThread}
          onDelete={chatThreads.requestDeleteThread}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
        <Select
          size="xs"
          aria-label={t(lang, "aiModel")}
          value={ai.model}
          onChange={(e) => onChangeModel?.(e.target.value)}
          disabled={!onChangeModel}
          className="min-w-0 max-w-[18rem]"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <ResetSizeButton onClick={resetChatSize} lang={lang} />
      </div>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto rounded-md border border-line bg-surface-muted p-3"
      >
        {display.length === 0 ? (
          <div className="space-y-3">
            {apiKeyLocked ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(lang, "secretUnlockApiKey")}
                </p>
                <div className="flex items-stretch gap-2">
                  <Input
                    type="password"
                    aria-label={t(lang, "secretPassphrasePlaceholder")}
                    placeholder={t(lang, "secretPassphrasePlaceholder")}
                    value={unlockPass}
                    onChange={(e) => {
                      setUnlockPass(e.target.value);
                      setUnlockError(false);
                    }}
                    className="min-w-0 flex-1"
                  />
                  <Button onClick={unlockApiKey}>
                    {t(lang, "secretUnlock")}
                  </Button>
                </div>
                {unlockError && (
                  <FieldError>{t(lang, "secretUnlockFailed")}</FieldError>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {apiKeyMissing ? t(lang, "chatNoApiKey") : t(lang, "chatGreeting")}
                </p>
                {apiKeyMissing && onConfigureAi && (
                  <Button onClick={onConfigureAi}>{t(lang, "chatConfigureAi")}</Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <ul
            className="space-y-3"
            role="log"
            aria-relevant="additions"
          >
            {display.map((item, idx) => (
              <li key={idx}>
                {item.kind === "user" && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-ui-dark-blue px-3 py-2 text-sm text-white">
                      {item.text}
                    </div>
                  </div>
                )}
                {item.kind === "assistant" && (
                  <div className="flex justify-start">
                    {/*
                      Assistant text is rendered through the Markdown
                      component so that the common formatting Claude emits
                      (**bold**, bullet/numbered lists, `code`, links, ###
                      headings) renders as styled HTML rather than raw
                      asterisks. User messages stay as plain text — they're
                      verbatim user input. The Markdown renderer never uses
                      dangerouslySetInnerHTML; everything goes through React
                      text nodes so HTML in a reply is escaped automatically.
                    */}
                    <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm text-foreground">
                      <Markdown text={item.text} />
                    </div>
                  </div>
                )}
                {item.kind === "notice" && (
                  <Banner severity="info" role="status">
                    {item.text}
                  </Banner>
                )}
                {item.kind === "tool" && (
                  <ToolBlock
                    name={item.name}
                    input={item.input}
                    result={item.result}
                    error={item.error}
                    lang={lang} tursoConfig={tursoConfig} projectId={projectId}
                  />
                )}
                {/* ★★★ THE ID MATCH IS THE CLEAR. The marker is persisted and
                    the plan is not, so a transcript restored from the in-memory
                    store or from a Turso thread row carries a marker with no
                    live plan and renders expired — which is what clears a
                    pending proposal on EVERY asynchronous reset path
                    (`use-chat-threads` replaces `display` at several sites;
                    count them rather than trusting a number, see the
                    `DisplayItem` proposal variant) without any of them knowing
                    this state exists. The synchronous project-switch reconcile
                    clears it explicitly as well. */}
                {item.kind === "proposal" &&
                  (pendingProposal !== null && pendingProposal.id === item.id ? (
                    <ChatProposalBlock
                      lang={lang}
                      rows={proposalCardRows}
                      selected={pendingProposal.selected}
                      onToggleRow={toggleProposalRow}
                      onToggleAll={toggleAllProposalRows}
                      applied={pendingProposal.applied}
                      onApply={applyPendingProposal}
                      onDiscard={discardProposal}
                      busy={pendingProposal.applying}
                    />
                  ) : (
                    <Banner severity="info" role="status">
                      {t(lang, "chatProposalExpired")}
                    </Banner>
                  ))}
              </li>
            ))}
            {busy && (
              <li className="flex items-center justify-start gap-2">
                <div className="rounded-lg bg-surface px-3 py-2 text-sm italic text-muted-foreground">
                  {t(lang, "chatThinking")}
                </div>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={stopChat}
                  aria-label={t(lang, "chatStopGenerating")}
                  title={t(lang, "chatStopGenerating")}
                >
                  {t(lang, "chatStop")}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>

      {!apiKeyMissing && (
        <div className="mt-2 shrink-0">
          <ChatPromptChips
            lang={lang}
            onPick={(body, autoSend) => (autoSend ? submitPrompt(body) : setInput(body))}
          />
        </div>
      )}

      {error && (
        <Banner severity="error" role="alert" className="mt-2 flex items-start justify-between gap-2">
          <p className="min-w-0 whitespace-pre-line">{error}</p>
          <IconButton
            onClick={() => setError(null)}
            label={t(lang, "dismiss")}
            title={t(lang, "dismiss")}
            className="shrink-0 font-semibold"
          >
            ×
          </IconButton>
        </Banner>
      )}

      {attachments.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-1 p-0">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-ui-dark-blue/40 bg-surface px-2 py-1 text-xs text-foreground"
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-1">
                  <span aria-hidden>📎</span>
                  <span className="truncate">{a.name}</span>
                </span>
                {a.summary && <span className="block text-xs text-muted-foreground">{a.summary}</span>}
              </span>
              <IconButton
                variant="danger"
                onClick={() => removeAttachment(a.id)}
                label={t(lang, "chatAttachmentRemove", a.name)}
                title={t(lang, "chatAttachmentRemove", a.name)}
                className="shrink-0 font-semibold"
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {status && <div className="mt-2">{status}</div>}

      <div className="mt-3 flex items-stretch gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => handleFiles(e.target.files)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <textarea
          ref={inputRef}
          rows={2}
          maxLength={CHAT_MESSAGE_MAX}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={registration.onFocus}
          onBlur={registration.onBlur}
          placeholder={guidesPending ? t(lang, "chatGuidesLoading") : t(lang, "chatPlaceholder")}
          disabled={busy || apiKeyMissing || guidesPending}
          className={`min-w-0 flex-1 self-stretch resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`}
        />
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            className="inline-flex items-center justify-center"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachDisabled}
            aria-label={t(lang, "chatAttach")}
            title={t(lang, "chatAttach")}
          >
            <PaperClipIcon aria-hidden="true" className="h-4 w-4" />
          </Button>
          {mic}
          {busy ? (
            <button
              type="button"
              onClick={stopChat}
              aria-label={t(lang, "chatStop")}
              className={`rounded-md bg-ui-pink px-4 py-2 text-sm font-medium text-white hover:opacity-90 ${INTERACTIVE}`}
            >
              {t(lang, "chatStop")}
            </button>
          ) : (
            <Button
              onClick={() => submitPrompt()}
              disabled={(!input.trim() && attachments.length === 0) || apiKeyMissing || guidesPending}
            >
              {t(lang, "chatSend")}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={async () => {
              if (await confirm({ message: t(lang, "chatClearConfirm") }))
                clearChat();
            }}
            disabled={busy || display.length === 0}
          >
            {t(lang, "chatClear")}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "chatAttachmentHint")}</p>
      </div>
    </div>
    </div>
  );
}

const POLICY_URL = "https://wiki.example.com/wiki/x/ewB2bwE";

function ConsentScreen({
  lang,
  onAccept,
}: {
  lang: Lang;
  onAccept: () => void;
}) {
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const bullets: TranslationKey[] = [
    "aiConsentBullet1",
    "aiConsentBullet2",
    "aiConsentBullet3",
    "aiConsentBullet4",
    "aiConsentBullet5",
    "aiConsentBullet6",
  ];
  return (
    <div className="rounded-lg border border-ui-purple/40 bg-ui-purple/10 p-5 dark:border-ui-purple/50 dark:bg-ui-purple/15">
      <h3 className="text-base font-semibold text-ui-purple-strong">
        {t(lang, "aiConsentTitle")}
      </h3>
      <p className="mt-2 text-sm text-ui-purple-strong">
        {t(lang, "aiConsentNotAccepted")}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-ui-purple-strong">
        {bullets.map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="mt-0.5">
              •
            </span>
            <span>{t(lang, k)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <a
          href={POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-ui-purple-strong underline underline-offset-2 hover:decoration-2"
        >
          {t(lang, "aiConsentPolicyLink")} ↗
        </a>
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-ui-purple-strong">
        <Checkbox
          checked={policyAccepted}
          onChange={(e) => setPolicyAccepted(e.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span>{t(lang, "aiConsentPolicyCheckbox")}</span>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={!policyAccepted}
          className={`rounded-md bg-ui-purple px-4 py-2 text-sm font-medium text-white hover:bg-ui-purple/90 focus:outline-none focus:ring-2 focus:ring-ui-purple focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${PRESS}`}
        >
          {t(lang, "aiConsentAccept")}
        </button>
      </div>
    </div>
  );
}
