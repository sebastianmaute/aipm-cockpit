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
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// grounded against the live tasks (groundWbsProposal) before it is shown, and
// grounded AGAIN against the tasks at apply time (applyWbsProposal), so a
// hallucinated id or a row edited since the proposal never reaches a write.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "./icons";
import { type Lang, t, tPlural } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Task } from "./types";
import { type LogActivityAsFn } from "./activity-log-context";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { useWorkspace } from "./workspace-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiKeyMessageKeyForError } from "./ai-key-status";
import { runWbsProposal } from "./wbs-plan-call";
import {
  applyWbsProposal,
  buildWbsContext,
  countNewRows,
  groundWbsProposal,
  type GroundedWbsItem,
  type SkippedWbsItem,
  type WbsApplyResult,
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

type Phase = "idle" | "input" | "thinking" | "preview" | "applying";

/** Sent when the user leaves the instructions blank. Model-facing, so English
 *  like the system prompt, never translated. */
const DEFAULT_WBS_INSTRUCTION =
  "Review the in-scope tasks and propose the most valuable work-breakdown improvements.";

export interface WbsPlanDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  capture?: UndoStackApi["capture"];
  /** ★ ACTOR-AWARE. This hook writes exactly one kind, an `ai.*` one, so it
   *  KNOWS its actor — see the rule on `useActivityLog`. */
  logActivityAs?: LogActivityAsFn;
}

export interface WbsOpenRequest {
  group?: string;
  instructions?: string;
}

export interface WbsPlan {
  /** The toolbar trigger (null in a popout). */
  button: ReactNode;
  /** The instruction dialog or preview modal (null while idle). */
  modal: ReactNode;
  /** The chat tool's entry point: goes straight to `thinking`. Refuses (and
   *  opens nothing) in a popout, with the AI off, mid-flow, or on an empty scope. */
  open(req: WbsOpenRequest): { opened: boolean; tasksInScope: number };
}

/** A task the flow may change: not closed and not Jira-synced. */
const isEditable = (task: Task): boolean => !isTaskClosed(task) && !task.jiraKey;

export function useWbsPlan(deps: WbsPlanDeps): WbsPlan {
  const { settings, isPopout, lang, capture, logActivityAs } = deps;
  const { tasks, setTasks, milestones, project, filteredSortedTasks } = useWorkspace();
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<WbsScope | null>(null);
  const [items, setItems] = useState<readonly GroundedWbsItem[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedWbsItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a proposal that resolves after cancel is
  // discarded (no stale preview, no stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // The live task list for the click handlers — `open()` and apply read it
  // rather than a closure that may be a render old (the dispatcher's pattern).
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const aiReady = isAiEnabled(settings.ai) && !!apiKey.trim();
  const enabled = aiReady && !isPopout;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setPhase("idle");
    setInstruction("");
    setScope(null);
    setItems([]);
    setSkipped([]);
    setTruncated(false);
    setSelected(new Set());
  }, []);

  // Abort an in-flight proposal on unmount. Cleanup-only: sets no state.
  useEffect(() => () => abortRef.current?.abort(), []);

  const propose = useCallback(
    async (runScope: WbsScope, text: string) => {
      const reqId = ++reqIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("thinking");
      try {
        const live = tasksRef.current;
        const context = buildWbsContext({ tasks: live, scopeIds: runScope.taskIds, milestones, project });
        const parsed = await runWbsProposal(
          context,
          { apiKey, model: settings.ai.model },
          text.trim() || DEFAULT_WBS_INSTRUCTION,
          controller.signal,
        );
        if (reqId !== reqIdRef.current) return; // superseded — discard
        // Ground against the tasks as they are NOW, not as they were sent.
        const grounded = groundWbsProposal(parsed, tasksRef.current, runScope);
        if (grounded.items.length === 0) {
          showToast("info", t(lang, "wbsPlanEmpty"));
          reset();
          return;
        }
        setItems(grounded.items);
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
    [milestones, project, apiKey, settings.ai.model, lang, showToast, reset],
  );

  const onOpen = useCallback(() => {
    if (!enabled || phase !== "idle") return;
    const ids = filteredSortedTasks.filter((x) => !isTaskClosed(x)).map((x) => x.id);
    if (ids.length === 0) {
      showToast("info", t(lang, "wbsPlanNoTasks"));
      return;
    }
    setInstruction("");
    setScope({ taskIds: new Set(ids) });
    setPhase("input");
  }, [enabled, phase, filteredSortedTasks, showToast, lang]);

  const onPropose = useCallback(() => {
    if (phase !== "input" || !scope) return;
    void propose(scope, instruction);
  }, [phase, scope, instruction, propose]);

  const open = useCallback(
    (req: WbsOpenRequest): { opened: boolean; tasksInScope: number } => {
      if (!enabled || phaseRef.current !== "idle") return { opened: false, tasksInScope: 0 };
      const group = req.group?.trim();
      const ids = tasksRef.current
        .filter((x) => isEditable(x) && (!group || (x.group ?? "") === group))
        .map((x) => x.id);
      if (ids.length === 0) return { opened: false, tasksInScope: 0 };
      const runScope: WbsScope = { taskIds: new Set(ids) };
      // Claim the phase now so a second call in the same tick is refused.
      phaseRef.current = "thinking";
      setInstruction(req.instructions ?? "");
      setScope(runScope);
      void propose(runScope, req.instructions ?? "");
      return { opened: true, tasksInScope: ids.length };
    },
    [enabled, propose],
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
    if (phase !== "preview" || !scope) return;
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
    if (result.applied > 0) {
      // A pure updater, so StrictMode's double call is harmless. ★ It must not
      // throw: apply throws on an id collision or too few ids, and a throw in
      // an updater crashes the render — so it falls back to `prev`.
      setTasks((prev) => {
        try {
          return applyWbsProposal(prev, ticked, ids, today, scope).nextTasks;
        } catch {
          return prev;
        }
      });
      // Updates only: created rows stay out of the images (docs/AGENTS/undo.md
      // "Creates" — capturing a create duplicates it on undo).
      if (result.editedBefore.length > 0) {
        capture?.({
          setter: setTasks,
          kind: "bulk.edit",
          edited: result.editedBefore,
          editedAfter: result.editedAfter,
          fromArray: live,
          entityKey: "task",
        });
      }
      logActivityAs?.("ai", "ai.wbsPlan", result.applied);
      showToast("info", tPlural(lang, "wbsPlanApplied", result.applied, result.applied));
    }
    if (result.skippedStale > 0) {
      showToast("info", tPlural(lang, "wbsPlanStaleSkipped", result.skippedStale, result.skippedStale));
    }
    reset();
  }, [phase, scope, items, selected, settings.timezone, project?.operatingTimezone, setTasks, capture, logActivityAs, showToast, lang, reset]);

  // ★ The trigger only OPENS the dialog; the billed call fires from inside it,
  //   so it is busy (and a Stop button) in `thinking` alone.
  // ★ With the AI off or no key it stays visible but disabled, and its reason
  //   rides `description` → `title`; the accessible NAME stays the visible label.
  const button = isPopout ? null : (
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
