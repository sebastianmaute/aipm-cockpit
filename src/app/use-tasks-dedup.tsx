"use client";

// Tasks-pane glue for the "Deduplicate & unify tasks" feature. Owns the
// propose→preview→confirm state machine plus the trigger button and the review
// modal element, so tasks-section stays lean. Plan-then-apply: the single forced
// Anthropic call PROPOSES merge groups but NOTHING mutates the workspace until
// the user confirms. Pure logic (grounding + apply) lives in ./task-dedup/dedup
// and is unit-tested there; this file is render glue, excluded from the coverage
// gate (src/app/**/*.tsx).
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// re-grounded against the LIVE tasks (groundMergeGroups) before it can delete or
// edit anything — a hallucinated id can never touch a real task.

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Task } from "./types";
import { type ActivityKind } from "./activity-log";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { isAbortError } from "./abort-error";
import { runDedupProposal } from "./task-dedup-call";
import {
  applyMerges,
  buildDedupContext,
  groundMergeGroups,
  type GroundedMergeGroup,
} from "./task-dedup/dedup";
import { TaskDedupModal } from "./task-dedup-modal";
import { AiTriggerButton } from "./ai-trigger-button";

/** Minimum tasks before offering the button (nothing to dedupe below two). */
const MIN_TASKS_FOR_DEDUP = 2;

type Phase = "idle" | "thinking" | "preview" | "applying";

export interface TasksDedupDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  /** Single-entry undo capture (merged rows removed + keep rows edited). */
  capture?: UndoStackApi["capture"];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /**
   * Already-translated view name to append to the trigger's accessible name
   * (e.g. "Gantt"). Needed once this hook is mounted more than once — in the
   * classic layout TasksSection and WorkspaceSection render simultaneously,
   * so two unqualified "Deduplicate & unify" triggers would share one
   * accessible name (WCAG 2.4.6), a collision the axe gate cannot see since
   * it only flags MISSING names, not duplicate ones. Omit for the original
   * single-mount site to keep its name unchanged.
   *
   * ★ Forwarded to AiTriggerButton as `nameQualifier`, which qualifies the
   *   accessible name in BOTH the idle and the Stop state — leaving Stop
   *   unqualified would restore the collision exactly while a call is running.
   */
  triggerQualifier?: string;
}

export interface TasksDedup {
  /** The toolbar trigger element (null when the feature is unavailable). */
  button: ReactNode;
  /** The review/confirm modal element (null when no proposal is open). */
  modal: ReactNode;
}

export function useTasksDedup(deps: TasksDedupDeps): TasksDedup {
  const { settings, isPopout, lang, tasks, setTasks, capture, logActivity, triggerQualifier } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [groups, setGroups] = useState<readonly GroundedMergeGroup[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const enabled =
    isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() && tasks.length >= MIN_TASKS_FOR_DEDUP;

  // Abort any in-flight proposal if the pane unmounts — a billed response must
  // never keep running against a dead component. Cleanup-only: sets no state, so
  // it doesn't run into the set-state-in-effect ban. Mirrors use-alloc-plan.tsx
  // and use-raci-suggest.tsx, which have carried this from the start.
  // ★★ THIS HOOK IS THE ONE THAT NEEDED IT MOST and was the one without it
  //    (open-followups §115): it mounts TWICE (tasks-section.tsx, gantt-view.tsx)
  //    and the modern shell renders only the ACTIVE view, so starting a dedup in
  //    Open Points and switching to Gantt unmounted the running instance. The call
  //    went on being billed while the Gantt trigger showed the IDLE label — a
  //    running call with no Stop anywhere in the app.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setPhase("idle");
    setGroups([]);
    setSelected(new Set());
  }, []);

  const onOpen = useCallback(async () => {
    if (!enabled || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const raw = await runDedupProposal(
        buildDedupContext(tasks),
        { apiKey, model: settings.ai.model },
        controller.signal,
      );
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids against the LIVE tasks before anything can
      // be shown or applied. A hallucinated/removed id is dropped here.
      const grounded = groundMergeGroups(raw, tasks);
      if (grounded.length === 0) {
        showToast("info", t(lang, "taskDedupNoneFound"));
        setPhase("idle");
        return;
      }
      setGroups(grounded);
      setSelected(new Set(grounded.map((g) => g.keepId)));
      setPhase("preview");
    } catch (e) {
      if (reqId !== reqIdRef.current) return; // stale failure — ignore
      if (isAbortError(e)) return;
      if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
        showToast("error", t(lang, "aiUsageLimitReached"));
      } else if (e instanceof AiHttpError && e.safeMessage) {
        // The response body's error.message carries no secret — safe to surface.
        showToast("error", e.safeMessage);
      } else {
        showToast("error", t(lang, "taskDedupError"));
      }
      setPhase("idle");
    }
  }, [enabled, phase, tasks, apiKey, settings.ai.model, lang, showToast]);

  const onToggle = useCallback((keepId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keepId)) next.delete(keepId);
      else next.add(keepId);
      return next;
    });
  }, []);

  const onConfirm = useCallback(() => {
    if (phase !== "preview") return;
    const chosen = groups.filter((g) => selected.has(g.keepId));
    if (chosen.length === 0) return;
    setPhase("applying");
    const before = tasks;
    const result = applyMerges(before, chosen, new Date().toISOString());
    if (result.removedCount === 0) {
      // Nothing actually merged (e.g. tasks changed under us) — close quietly.
      reset();
      return;
    }
    // Apply via a functional setter (single tick), then record ONE undo entry
    // covering the removed duplicates + the edited keep rows.
    setTasks(() => result.nextTasks);
    capture?.({
      setter: setTasks,
      kind: "task.deleted",
      removed: result.removed,
      edited: result.editedBefore,
      fromArray: before,
      entityKey: "task",
    });
    logActivity?.("ai.taskDedup", result.removedCount);
    showToast("info", t(lang, "taskDedupApplied", result.removedCount));
    reset();
  }, [phase, groups, selected, tasks, setTasks, capture, logActivity, showToast, lang, reset]);

  // ★ `triggerQualifier` MUST keep reaching the accessible name. This hook is
  //   mounted TWICE (tasks-section.tsx, gantt-view.tsx) and the classic layout
  //   renders both at once, so an unqualified name is a WCAG 2.4.6 collision
  //   that the axe gate cannot see — dedup-trigger-qualifier.test.tsx exists
  //   for exactly that. Hence AiTriggerButton's `nameQualifier`.
  // ★ `busy` is `"thinking"` alone; `"applying"` is a local merge commit, not a
  //   stoppable Claude call, and was never clickable before either.
  // ★ The fuller `taskDedupTitle` sentence rides `description` → `title`, the
  //   accessible DESCRIPTION, exactly as use-alloc-plan does with allocPlanTitle.
  //   It used to be this trigger's aria-label; the NAME is now the visible label
  //   (see the test file for why that swap was not itself a 2.5.3 fix), so
  //   without `description` the longer sentence would be lost disclosure.
  const button = enabled ? (
    <AiTriggerButton
      lang={lang}
      busy={phase === "thinking"}
      onRun={() => void onOpen()}
      onCancel={reset}
      idleLabelKey="taskDedup"
      idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
      nameQualifier={triggerQualifier}
      description={t(lang, "taskDedupTitle")}
      disabled={phase === "applying"}
    />
  ) : null;

  const modal = phase === "preview" || phase === "applying" ? (
    <TaskDedupModal
      lang={lang}
      open
      groups={groups}
      selected={selected}
      onToggle={onToggle}
      onConfirm={onConfirm}
      onCancel={reset}
      busy={phase === "applying"}
    />
  ) : null;

  return { button, modal };
}
