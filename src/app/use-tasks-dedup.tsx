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

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useRef, useState } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Task } from "./types";
import { type ActivityKind } from "./activity-log";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { runDedupProposal } from "./task-dedup-call";
import {
  applyMerges,
  buildDedupContext,
  groundMergeGroups,
  type GroundedMergeGroup,
} from "./task-dedup/dedup";
import { TaskDedupModal } from "./task-dedup-modal";
import { INTERACTIVE } from "./interaction-styles";

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
}

export interface TasksDedup {
  /** The toolbar trigger element (null when the feature is unavailable). */
  button: ReactNode;
  /** The review/confirm modal element (null when no proposal is open). */
  modal: ReactNode;
}

const TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";

export function useTasksDedup(deps: TasksDedupDeps): TasksDedup {
  const { settings, isPopout, lang, tasks, setTasks, capture, logActivity } = deps;
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
      if (e instanceof DOMException && e.name === "AbortError") return;
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

  const button = enabled ? (
    <button
      type="button"
      onClick={() => void onOpen()}
      disabled={phase === "thinking" || phase === "applying"}
      aria-label={t(lang, "taskDedupTitle")}
      title={t(lang, "taskDedupTitle")}
      className={`${TRIGGER_CLASS} ${INTERACTIVE}`}
    >
      <SparkIcon spinning={phase === "thinking"} />
      {phase === "thinking" ? t(lang, "taskDedupThinking") : t(lang, "taskDedup")}
    </button>
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

function SparkIcon({ spinning }: { spinning: boolean }) {
  return (
    <SparklesIcon aria-hidden="true" className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`} />
  );
}
