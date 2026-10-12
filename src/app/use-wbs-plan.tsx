"use client";

// Task-manager-level glue for "Optimize with AI" (AI work-breakdown proposals,
// `optimize_wbs`). Owns the input -> thinking -> preview -> apply state machine,
// the toolbar trigger, the instruction dialog and the preview modal element.
// Mirrors use-alloc-plan.tsx. Plan-then-apply: the single forced Anthropic call
// PROPOSES changes and NOTHING mutates the workspace until the user confirms
// per item. Pure logic (context, grounding, apply) lives in ./wbs-plan/wbs-plan
// and is unit-tested there; this file is render glue (a .tsx, so outside the
// coverage gate) and is pinned by use-wbs-plan.test.tsx.
//
// ★ It runs at the task-manager level and its modal renders from the modals
//   block, so `open()` (the chat tool's entry point) works from any view and no
//   remount can swallow a request.
// ★ Workspace slices come from `useWorkspace()`, so task-manager wires it with
//   one line.
// ★★ It awaits the AI and then writes, so it obeys docs/AGENTS/platform.md "The
//   load hold": nothing STARTS while `loadPending` (open, the toolbar trigger
//   and Apply all refuse), a hold that begins mid-flow CLOSES it (§662's
//   render-time reconcile, as use-blockers-window.ts does), and the scope epoch is captured before the await and
//   checked after it and again at Apply — a proposal made in one project is never
//   grounded against, or written into, another (`dropStaleScopeWrite`).
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// grounded against the live tasks (groundWbsProposal) before it is shown, and
// grounded AGAIN against the tasks at apply time (applyWbsProposal), so a
// hallucinated id or a row edited since the proposal never reaches a write.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SparklesIcon } from "./icons";
import { type Lang, t, tPlural } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Task } from "./types";
import { type LogActivityAsFn } from "./activity-log-context";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { filterTasksByHealth } from "./health";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiKeyMessageKeyForError } from "./ai-key-status";
import { runWbsProposal } from "./wbs-plan-call";
import { useActionGuideText } from "./action-guides-context";
import {
  applyWbsProposal,
  buildWbsContext,
  countNewRows,
  groundWbsProposal,
  type GroundedWbsItem,
  type SkippedWbsItem,
  type WbsApplyResult,
  type WbsOpenRefusal,
  type WbsScope,
} from "./wbs-plan/wbs-plan";
import { WbsPlanModal } from "./wbs-plan-modal";
import { AiTriggerButton } from "./ai-trigger-button";
import { Modal } from "./modal";
import { Button } from "./button";
import { Textarea } from "./form-controls";
import { mintIds } from "./id-mint-session";
import { isTaskClosed } from "./task-closed";
import { resolveTimezone, todayInZone } from "./timezone";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import { sanitizeText } from "./sanitize-core";

type Phase = "idle" | "input" | "thinking" | "preview" | "applying";

/** Sent when the user leaves the instructions blank. Model-facing, so English
 *  like the system prompt, never translated. */
const DEFAULT_WBS_INSTRUCTION =
  "Review the in-scope tasks and propose the most valuable work-breakdown improvements.";
/** Cap on the user's instruction, the one `optimize_wbs` applies on the chat
 *  path (`chat-tools.ts`), so a large paste never reaches the billed request. */
const MAX_WBS_INSTRUCTION_CHARS = 1000;

export interface WbsPlanDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  capture?: UndoStackApi["capture"];
  /** ★ ACTOR-AWARE. This hook writes exactly one kind, an `ai.*` one, so it
   *  KNOWS its actor — see the rule on `useActivityLog`. */
  logActivityAs?: LogActivityAsFn;
  /** REQUIRED (scope-epoch.ts: an optional reader is how a writer goes unguarded). */
  getScopeEpoch: ScopeEpochReader;
  /** True while a load or project swap holds the workspace: nothing starts. */
  loadPending: boolean;
  /** The table's own clock and holidays, so the toolbar scope applies the RAG
   *  health filter exactly as the Open Points table does. */
  today: string;
  holidaySet: ReadonlySet<string>;
}

export interface WbsOpenRequest {
  group?: string;
  instructions?: string;
  /** The caller's synchronously-updated task list (the chat dispatcher's
   *  `tasksRef`), so a task the chat created earlier in the same model turn
   *  is in scope and in the digest. Defaults to this hook's own list, which an
   *  effect syncs only after commit. */
  liveTasks?: readonly Task[];
}

export interface WbsOpenResult {
  opened: boolean;
  tasksInScope: number;
  /** Set when nothing opened: why, so the chat tool can tell the model. */
  reason?: WbsOpenRefusal;
}

export interface WbsPlan {
  /** The toolbar trigger (null in a popout). */
  button: ReactNode;
  /** The instruction dialog or preview modal (null while idle). */
  modal: ReactNode;
  /** The chat tool's entry point: goes straight to `thinking`. Refuses (and
   *  opens nothing) in a popout, with the AI off, during a load hold, mid-flow,
   *  for a group no task has, or on an empty scope — and says which. */
  open(req: WbsOpenRequest): WbsOpenResult;
}

/** A task the flow may change: not closed and not Jira-synced. */
const isEditable = (task: Task): boolean => !isTaskClosed(task) && !task.jiraKey;

export function useWbsPlan(deps: WbsPlanDeps): WbsPlan {
  const { settings, isPopout, lang, capture, logActivityAs, getScopeEpoch, loadPending, today: tableToday, holidaySet } = deps;
  const { tasks, setTasks, milestones, project, filteredSortedTasks } = useWorkspace();
  const { healthFilter } = useFilters();
  const showToast = useToastContext();

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<WbsScope | null>(null);
  // ★ Not `setItems`: that name is how the counted task setter is handed on
  // (destructive-save-arming.ui.test.ts), and this is the proposal, not a slice.
  const [items, setProposalItems] = useState<readonly GroundedWbsItem[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedWbsItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a proposal that resolves after cancel is
  // discarded (no stale preview, no stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set when a load hold closed the flow; the notice waits for the hold to end.
  const closedByHoldRef = useRef(false);
  // The scope epoch the current proposal was requested in (captured before the
  // await); Apply drops the write when it moved.
  const epochRef = useRef<number | undefined>(undefined);
  // The live task list for the click handlers — `open()` and apply read it
  // rather than a closure that may be a render old (the dispatcher's pattern).
  // ★ Synced after commit, so `open()` prefers the caller's `liveTasks`.
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  // ★ Written in the SAME call as the state, never synced by an effect: a call
  // that fails in the same tick it started batches "thinking" -> "idle" into no
  // state change at all, so an effect would never fire and the ref would stay
  // "thinking", refusing every later open().
  const phaseRef = useRef<Phase>("idle");
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  // ★★ Focus goes back to the toolbar trigger when a flow it opened ends. The
  // instruction dialog and the preview are two separate `Modal`s: when the
  // preview replaces the dialog, the dialog hands focus to the trigger, which
  // is disabled in "preview", so focus falls to <body> and the preview records
  // <body> as its opener (WCAG 2.4.3). The effect below runs after the trigger
  // is enabled again. A chat-opened flow keeps the Modal's own restore.
  const triggerBoxRef = useRef<HTMLSpanElement | null>(null);
  const fromTriggerRef = useRef(false);
  useEffect(() => {
    if (phase !== "idle" || !fromTriggerRef.current) return;
    fromTriggerRef.current = false;
    triggerBoxRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [phase]);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const aiReady = isAiEnabled(settings.ai) && !!apiKey.trim();
  const guideText = useActionGuideText("wbs");
  const enabled = aiReady && !isPopout;

  // The flow's STATE back to idle — state setters only, so the load-hold
  // reconcile below may call it during render.
  const clearFlowState = useCallback(() => {
    setPhaseState("idle");
    setInstruction("");
    setScope(null);
    setProposalItems([]);
    setSkipped([]);
    setTruncated(false);
    setSelected(new Set());
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    phaseRef.current = "idle";
    clearFlowState();
  }, [clearFlowState]);

  // ★★ A load hold that starts mid-flow closes it — the dialog, a running call
  // or an open preview — so Apply is never a dead button over a workspace being
  // replaced. The STATE half is a render-time reconcile, never an effect (§662,
  // use-blockers-window.ts); it settles because the next render sees "idle".
  // The REF half (abort the call, discard its result, free `open()`) cannot run
  // during render, so the effect does it: refs only, no state.
  // ★ The modal covers the app, so a hold that starts mid-flow is one the user
  // did not start here (a backend-change reload, a swap from another surface):
  // the effect says why the flow closed — but only once the hold ENDS: while
  // it lasts, the app shell (and the toast with it) is replaced by a skeleton,
  // and the toast's dismiss timer would run out unseen. `showToast` is the
  // toast context's function, not a state setter of this component, so the
  // effect still sets no state of its own; it fires once, because it frees
  // `phaseRef` and clears `closedByHoldRef`.
  if (loadPending && phase !== "idle") clearFlowState();
  useEffect(() => {
    if (!loadPending) {
      if (closedByHoldRef.current) {
        closedByHoldRef.current = false;
        showToast("info", t(lang, "wbsPlanClosedByLoad"));
      }
      return;
    }
    abortRef.current?.abort();
    reqIdRef.current++;
    if (phaseRef.current !== "idle") closedByHoldRef.current = true;
    phaseRef.current = "idle";
  }, [loadPending, showToast, lang]);

  // Abort an in-flight proposal on unmount. Cleanup-only: sets no state.
  useEffect(() => () => abortRef.current?.abort(), []);

  const propose = useCallback(
    async (runScope: WbsScope, text: string, liveTasks?: readonly Task[]) => {
      const reqId = ++reqIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("thinking");
      const startEpoch = getScopeEpoch();
      epochRef.current = startEpoch;
      try {
        const live = liveTasks ?? tasksRef.current;
        const context = buildWbsContext({ tasks: live, scopeIds: runScope.taskIds, milestones, project });
        const parsed = await runWbsProposal(
          context,
          { apiKey, model: settings.ai.model, guideText },
          sanitizeText(text, MAX_WBS_INSTRUCTION_CHARS) || DEFAULT_WBS_INSTRUCTION,
          controller.signal,
        );
        if (reqId !== reqIdRef.current) return; // superseded — discard
        if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "useWbsPlan.propose")) {
          showToast("info", t(lang, "wbsPlanScopeChanged"));
          reset();
          return;
        }
        // Ground against the tasks as they are NOW, not as they were sent.
        const grounded = groundWbsProposal(parsed, tasksRef.current, runScope);
        // Only a proposal with NOTHING in it is "no changes proposed". When the
        // model proposed items and grounding refused them all, the preview
        // still opens, showing just the "Not applied" list with its reasons.
        if (grounded.items.length === 0 && grounded.skipped.length === 0) {
          showToast("info", t(lang, "wbsPlanEmpty"));
          reset();
          return;
        }
        setProposalItems(grounded.items);
        setSkipped(grounded.skipped);
        setTruncated(grounded.truncated);
        setSelected(new Set(grounded.items.map((g) => g.key)));
        setPhase("preview");
      } catch (e) {
        if (reqId !== reqIdRef.current) return; // stale failure — ignore
        // Read .name directly, never `instanceof DOMException` — the
        // jsdom/Node boundary rule use-alloc-plan.tsx documents.
        const errName = e instanceof Error ? e.name : (e as { name?: string } | null)?.name;
        if (errName === "AbortError") {
          reset();
          return;
        }
        // §650 — a refused key (401/403) is named as the key problem.
        const keyMsg = aiKeyMessageKeyForError(e);
        if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
          showToast("error", t(lang, "aiUsageLimitReached"));
        } else if (keyMsg) {
          showToast("error", t(lang, keyMsg));
        } else if (e instanceof AiHttpError && e.safeMessage) {
          showToast("error", e.safeMessage);
        } else {
          showToast("error", t(lang, "wbsPlanError"));
        }
        reset();
      }
    },
    [milestones, project, apiKey, settings.ai.model, guideText, lang, showToast, reset, setPhase, getScopeEpoch],
  );

  const onOpen = useCallback(() => {
    // `phaseRef`, not `phase`: a chat `open()` sets the ref in the same call,
    // before its "thinking" state renders.
    if (!enabled || loadPending || phaseRef.current !== "idle") return;
    // The rows the table shows: `filteredSortedTasks` is upstream of the RAG
    // health filter, which tasks-section.tsx applies on its own (as
    // visible-task-rows.ts says, select-all once reached hidden rows this way).
    // Hide-finished is moot: closed tasks are never editable.
    const shown = filterTasksByHealth(filteredSortedTasks, healthFilter, tableToday, holidaySet);
    const ids = shown.filter(isEditable).map((x) => x.id);
    if (ids.length === 0) {
      showToast("info", t(lang, "wbsPlanNoTasks"));
      return;
    }
    setInstruction("");
    setScope({ taskIds: new Set(ids) });
    fromTriggerRef.current = true;
    setPhase("input");
  }, [enabled, loadPending, filteredSortedTasks, healthFilter, tableToday, holidaySet, showToast, lang, setPhase]);

  const onPropose = useCallback(() => {
    if (phase !== "input" || !scope) return;
    void propose(scope, instruction);
  }, [phase, scope, instruction, propose]);

  const open = useCallback(
    (req: WbsOpenRequest): WbsOpenResult => {
      const refuse = (reason: WbsOpenRefusal): WbsOpenResult => ({ opened: false, tasksInScope: 0, reason });
      if (isPopout) return refuse("popout");
      if (!aiReady) return refuse("aiOff");
      if (loadPending) return refuse("loading");
      if (phaseRef.current !== "idle") return refuse("busy");
      // Case-insensitive and trimmed: the model may say "design" for "Design".
      const group = req.group?.trim().toLowerCase();
      const inGroup = (x: Task) => !group || (x.group ?? "").trim().toLowerCase() === group;
      const live = req.liveTasks ?? tasksRef.current;
      const ids = live.filter((x) => isEditable(x) && inGroup(x)).map((x) => x.id);
      if (ids.length === 0) return refuse(group && !live.some(inGroup) ? "unknownGroup" : "noTasks");
      const runScope: WbsScope = { taskIds: new Set(ids) };
      fromTriggerRef.current = false;
      setInstruction(req.instructions ?? "");
      setScope(runScope);
      void propose(runScope, req.instructions ?? "", live);
      return { opened: true, tasksInScope: ids.length };
    },
    [isPopout, aiReady, loadPending, propose],
  );

  const onToggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onApply = useCallback(() => {
    if (phase !== "preview" || !scope || loadPending) return;
    if (dropStaleScopeWrite(getScopeEpoch, epochRef.current, "useWbsPlan.apply")) {
      showToast("info", t(lang, "wbsPlanScopeChanged"));
      reset();
      return;
    }
    // Synchronous to its final reset(), so React batches this away; kept for
    // the day apply grows an await (the NOTE in use-alloc-plan.tsx's onConfirm).
    setPhase("applying");
    const today = todayInZone(new Date(), resolveTimezone(settings.timezone, project?.operatingTimezone));
    const live = tasksRef.current;
    // Every selected item goes in; the engine drops one whose required item is
    // unticked, and re-grounds the rest against the rows it is handed.
    const ticked = items.filter((g) => selected.has(g.key));
    // Ids are minted HERE, from the live list, never at proposal time (the
    // AGENTS.md id-mint race).
    const ids = mintIds("task", live, countNewRows(ticked));
    let result: WbsApplyResult;
    try {
      result = applyWbsProposal(live, ticked, ids, today, scope);
    } catch {
      showToast("error", t(lang, "wbsPlanError"));
      reset();
      return;
    }
    // The undo images' source array: `live` until the updater says otherwise.
    let base: readonly Task[] = live;
    if (result.applied > 0) {
      // A pure updater, so StrictMode's double call is harmless. ★ It must not
      // throw: apply throws on an id collision or too few ids, and a throw in
      // an updater crashes the render — so it falls back to `prev`.
      // ★ `flushSync` makes the updater run before the next line, so what it
      // did is known HERE. ★★ The toast, the `ai.wbsPlan` count and the undo
      // images come from the updater's OWN result, never the pre-click one:
      // `prev` can differ from `live` when a background write is queued but not
      // rendered, and an item stale against `prev` was not written. A fallback
      // wrote nothing, so no "Applied N" toast, no row and no undo entry — the
      // generic error instead.
      const box: { written: WbsApplyResult | null; from: readonly Task[] } = { written: null, from: live };
      flushSync(() => {
        setTasks((prev) => {
          try {
            const r = applyWbsProposal(prev, ticked, ids, today, scope);
            box.written = r;
            box.from = prev;
            return r.nextTasks;
          } catch {
            box.written = null;
            return prev;
          }
        });
      });
      if (!box.written) {
        showToast("error", t(lang, "wbsPlanError"));
        reset();
        return;
      }
      result = box.written;
      base = box.from;
    }
    if (result.applied > 0) {
      // Updates only: created rows stay out of the images (docs/AGENTS/undo.md
      // "Creates" — capturing a create duplicates it on undo).
      if (result.editedBefore.length > 0) {
        capture?.({
          setter: setTasks,
          kind: "bulk.edit",
          edited: result.editedBefore,
          editedAfter: result.editedAfter,
          fromArray: base,
          entityKey: "task",
        });
      }
      logActivityAs?.("ai", "ai.wbsPlan", result.applied);
    }
    // ONE toast: there is a single toast slot, so a second call in this
    // handler would replace the first and a partial apply would report only
    // what was skipped. The combined key is picked by the skipped count; the
    // applied count rides a count-neutral "applied: {0}".
    const { applied, skippedStale } = result;
    if (applied > 0 && skippedStale > 0) {
      showToast("info", tPlural(lang, "wbsPlanAppliedSkipped", skippedStale, applied, skippedStale));
    } else if (applied > 0) {
      showToast("info", tPlural(lang, "wbsPlanApplied", applied, applied));
    } else if (skippedStale > 0) {
      showToast("info", tPlural(lang, "wbsPlanStaleSkipped", skippedStale, skippedStale));
    }
    reset();
  }, [phase, scope, loadPending, getScopeEpoch, items, selected, settings.timezone, project?.operatingTimezone, setTasks, capture, logActivityAs, showToast, lang, reset, setPhase]);

  // ★ The trigger only OPENS the dialog; the billed call fires from inside it,
  //   so it is busy (and a Stop button) in `thinking` alone.
  // ★ With the AI off or no key it stays visible but disabled, and its reason
  //   rides `description` → `title`; the accessible NAME stays the visible label.
  // `contents`: the box adds no layout of its own to the toolbar row.
  const button = isPopout ? null : (
    <span ref={triggerBoxRef} className="contents">
      <AiTriggerButton
        lang={lang}
        busy={phase === "thinking"}
        onRun={onOpen}
        onCancel={reset}
        idleLabelKey="wbsPlanButton"
        idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
        description={t(lang, aiReady ? "wbsPlanButtonTitle" : "wbsPlanNeedsAi")}
        disabled={!aiReady || (phase !== "idle" && phase !== "thinking")}
      />
    </span>
  );

  let modal: ReactNode = null;
  if (phase === "input" || phase === "thinking") {
    modal = (
      <WbsPlanInputDialog
        lang={lang}
        instruction={instruction}
        onInstruction={setInstruction}
        onPropose={onPropose}
        onCancel={reset}
        thinking={phase === "thinking"}
      />
    );
  } else if (phase === "preview" || phase === "applying") {
    modal = (
      <WbsPlanModal
        lang={lang}
        tasksById={new Map(tasks.map((x) => [x.id, x] as const))}
        items={items}
        skipped={skipped}
        truncated={truncated}
        selected={selected}
        onToggle={onToggle}
        onApply={onApply}
        onCancel={reset}
        applying={phase === "applying"}
      />
    );
  }

  return { button, modal, open };
}

/** The optional-instructions step, and the progress state while the call runs.
 *  Cancel stays live during `thinking` — it aborts the call. */
function WbsPlanInputDialog({
  lang,
  instruction,
  onInstruction,
  onPropose,
  onCancel,
  thinking,
}: {
  lang: Lang;
  instruction: string;
  onInstruction: (v: string) => void;
  onPropose: () => void;
  onCancel: () => void;
  thinking: boolean;
}) {
  const title = t(lang, "wbsPlanTitle");
  return (
    <Modal open onClose={onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "wbsPlanIntro")}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">{t(lang, "wbsPlanInstructionLabel")}</span>
            <Textarea
              value={instruction}
              onChange={(e) => onInstruction(e.target.value)}
              placeholder={t(lang, "wbsPlanInstructionPlaceholder")}
              disabled={thinking}
              rows={3}
              className="w-full"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t(lang, "wbsPlanCancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onPropose} disabled={thinking}>
            {thinking ? t(lang, "wbsPlanThinking") : t(lang, "wbsPlanPropose")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
