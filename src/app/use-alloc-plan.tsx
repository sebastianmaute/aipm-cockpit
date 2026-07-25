"use client";

// Resources-pane glue for "Plan with AI" (AI-assisted resource-allocation
// planning). Owns the propose -> ground -> preview -> confirm state machine
// plus the trigger button and the preview modal element, mirroring
// use-tasks-dedup.tsx's shape exactly. Plan-then-apply: the single forced
// Anthropic call PROPOSES allocation cells but NOTHING mutates the workspace
// until the user confirms per-cell in the modal. Pure logic (context/grounding/
// apply) lives in ./alloc-plan/alloc-plan and is unit-tested there; this file
// is render glue, excluded from the coverage gate (src/app/**/*.tsx).
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// re-grounded against the LIVE resources/plan (groundAllocationCells) before it
// can touch anything — a hallucinated resource id or an out-of-window period
// key can never reach a write.

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useRef, useState } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Absence, type Discipline, type Grade, type Resource, type ResourcePlan, type Role } from "./types";
import { type ActivityKind } from "./activity-log";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { runAllocProposal } from "./alloc-plan-call";
import {
  applyAllocationCells,
  buildAllocContext,
  cellKey,
  groundAllocationCells,
  type GroundedAllocCell,
  type SkippedCell,
} from "./alloc-plan/alloc-plan";
import { AllocPlanModal } from "./alloc-plan-modal";
import { INTERACTIVE } from "./interaction-styles";

type Phase = "idle" | "input" | "thinking" | "preview" | "applying";

export interface AllocPlanDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  capture?: UndoStackApi["capture"];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface AllocPlan {
  /** The toolbar trigger element (null when the feature is unavailable). */
  button: ReactNode;
  /** The preview/confirm modal element (null while the feature is idle). */
  modal: ReactNode;
}

const TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";

export function useAllocPlan(deps: AllocPlanDeps): AllocPlan {
  const { settings, isPopout, lang, resources, setResources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet, capture, logActivity } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [cells, setCells] = useState<readonly GroundedAllocCell[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedCell[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const enabled = isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() && resources.length > 0;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setPhase("idle");
    setInstruction("");
    setCells([]);
    setSkipped([]);
    setSelected(new Set());
  }, []);

  const onOpen = useCallback(() => {
    if (!enabled || phase !== "idle") return;
    // Invalidate/abort anything still pending from a previous session (there
    // shouldn't be one while idle, but this mirrors reset()'s guard exactly).
    abortRef.current?.abort();
    reqIdRef.current++;
    setInstruction("");
    setCells([]);
    setSkipped([]);
    setSelected(new Set());
    setPhase("input");
  }, [enabled, phase]);

  const onPropose = useCallback(async () => {
    if (phase !== "input" || !instruction.trim()) return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const context = buildAllocContext({ resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet });
      const raw = await runAllocProposal(context, { apiKey, model: settings.ai.model }, instruction, controller.signal);
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids/keys against the LIVE resources/plan
      // before anything can be shown or applied. A hallucinated resource or an
      // out-of-window period key is dropped here.
      const grounded = groundAllocationCells(raw, { resources, plan, absences, workdayHours, holidaySet });
      setCells(grounded.cells);
      setSkipped(grounded.skipped);
      if (grounded.cells.length > 0 || grounded.skipped.length > 0) {
        // Preselect every grounded cell; skipped-only results still surface
        // via the preview stage (the only stage the modal renders them in) —
        // silently, since a modal explaining what was refused and why is not
        // "nothing was proposed".
        setSelected(new Set(grounded.cells.map(cellKey)));
        setPhase("preview");
      } else {
        // Nothing at all came back (no cells AND no skips) — only now is
        // "nothing was proposed" true. Stay on the instruction step so the
        // user can revise and retry without reopening.
        showToast("info", t(lang, "allocPlanNoChanges"));
        setSelected(new Set());
        setPhase("input");
      }
    } catch (e) {
      if (reqId !== reqIdRef.current) return; // stale failure — ignore
      // AbortError is raised when the controller fires (cancel/reopen) — treat
      // as a user-initiated stop, not a real error. Read .name directly
      // (never `instanceof DOMException`) because DOMException may not be
      // instanceof Error/DOMException consistently across the jsdom/Node
      // boundary — mirrors chat-panel.tsx.
      const errName = e instanceof Error ? e.name : (e as { name?: string }).name;
      if (errName === "AbortError") {
        setPhase("input");
        return;
      }
      if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
        showToast("error", t(lang, "aiUsageLimitReached"));
      } else if (e instanceof AiHttpError && e.safeMessage) {
        // The response body's error.message carries no secret — safe to surface.
        showToast("error", e.safeMessage);
      } else {
        showToast("error", t(lang, "allocPlanError"));
      }
      setPhase("input");
    }
  }, [phase, instruction, resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet, apiKey, settings.ai.model, lang, showToast]);

  const onToggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onConfirm = useCallback(() => {
    if (phase !== "preview") return;
    const chosen = cells.filter((c) => selected.has(cellKey(c)));
    if (chosen.length === 0) return;
    setPhase("applying");
    const before = resources;
    const result = applyAllocationCells(before, chosen, new Date().toISOString());
    if (result.editedBefore.length === 0) {
      // Nothing actually changed (e.g. resources moved under us) — close quietly.
      reset();
      return;
    }
    // Apply via a functional setter (single tick), then record ONE undo entry
    // covering every resource the apply touched.
    setResources(() => result.nextResources);
    capture?.({
      setter: setResources,
      kind: "bulk.edit",
      edited: result.editedBefore,
      fromArray: before,
      entityKey: "resource",
    });
    logActivity?.("ai.allocationPlan", chosen.length);
    showToast("info", t(lang, "allocPlanApplied", chosen.length));
    reset();
  }, [phase, cells, selected, resources, setResources, capture, logActivity, showToast, lang, reset]);

  const stage: "input" | "preview" = phase === "preview" || phase === "applying" ? "preview" : "input";
  const busy = phase === "thinking" || phase === "applying";
  const canCancel = phase !== "applying";

  const button = enabled ? (
    <button
      type="button"
      onClick={onOpen}
      disabled={phase !== "idle"}
      aria-label={t(lang, "allocPlanTitle")}
      title={t(lang, "allocPlanTitle")}
      className={`${TRIGGER_CLASS} ${INTERACTIVE}`}
    >
      <SparklesIcon aria-hidden="true" className="h-4 w-4" />
      {t(lang, "allocPlan")}
    </button>
  ) : null;

  const modal = phase !== "idle" ? (
    <AllocPlanModal
      lang={lang}
      open
      stage={stage}
      instruction={instruction}
      onInstruction={setInstruction}
      onPropose={() => void onPropose()}
      cells={cells}
      skipped={skipped}
      selected={selected}
      onToggle={onToggle}
      onConfirm={onConfirm}
      onCancel={reset}
      busy={busy}
      canCancel={canCancel}
    />
  ) : null;

  return { button, modal };
}
