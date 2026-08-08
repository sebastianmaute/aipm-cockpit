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

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
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
import { AiTriggerButton } from "./ai-trigger-button";

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

export function useAllocPlan(deps: AllocPlanDeps): AllocPlan {
  const { settings, isPopout, lang, resources, setResources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet, capture, logActivity } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [instruction, setInstruction] = useState("");
  const [cells, setCells] = useState<readonly GroundedAllocCell[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedCell[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const enabled = isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() && resources.length > 0;

  // Invalidate/abort anything pending and clear the propose/preview state.
  // Shared by reset() (which also drops the phase to idle) and onOpen()
  // (which instead lands on "input" — there shouldn't be anything pending
  // while idle, but clearing unconditionally mirrors reset() exactly).
  const clearProposalState = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setInstruction("");
    setCells([]);
    setSkipped([]);
    setTruncated(false);
    setSelected(new Set());
  }, []);

  const reset = useCallback(() => {
    clearProposalState();
    setPhase("idle");
  }, [clearProposalState]);

  const onOpen = useCallback(() => {
    if (!enabled || phase !== "idle") return;
    clearProposalState();
    setPhase("input");
  }, [enabled, phase, clearProposalState]);

  // Abort any in-flight proposal if the pane unmounts (e.g. the user
  // navigates away from Resources) — a response must never land against a
  // dead component. Cleanup-only: sets no state, so it doesn't run into the
  // set-state-in-effect ban.
  useEffect(() => () => abortRef.current?.abort(), []);

  const onPropose = useCallback(async () => {
    if (phase !== "input" || !instruction.trim()) return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const context = buildAllocContext({ resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet });
      const parsed = await runAllocProposal(context, { apiKey, model: settings.ai.model }, instruction, controller.signal);
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids/keys against the LIVE resources/plan
      // before anything can be shown or applied. A hallucinated resource or an
      // out-of-window period key is dropped here.
      const grounded = groundAllocationCells(parsed.cells, { resources, plan, absences, workdayHours, holidaySet });
      setCells(grounded.cells);
      setSkipped(grounded.skipped);
      // parsed.truncated is where an over-large proposal ACTUALLY gets cut
      // (parseAllocationProposal caps at the same MAX_ALLOC_CELLS grounding
      // does, so grounded.truncated alone can never fire on this real path —
      // it stays as defense in depth for a caller that skips parsing). OR
      // both so neither omission goes unreported.
      setTruncated(parsed.truncated || grounded.truncated);
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
    // NOTE: this whole handler body runs SYNCHRONOUSLY to its final
    // `reset()`/`setResources()` — there is no `await` between here and the
    // end of the function — so React 19's automatic batching coalesces this
    // `setPhase("applying")` with every state update that follows in the same
    // tick and NEVER commits an intermediate "applying" render. `phase ===
    // "applying"` therefore cannot currently be observed by the modal:
    // `busy`/`canCancel` below never see it, and neither does the `stage`
    // derivation. It is kept anyway as defence-in-depth for the day this body
    // grows an `await` (e.g. a server round-trip on apply) — at that point the
    // batching boundary breaks and "applying" becomes real without anyone
    // having to remember to re-add it. Don't delete it as "dead code": the
    // `AllocPlanModal`'s busy-disabling and the `handleClose` neutering in
    // `alloc-plan-modal.tsx` are correct FOR that future, just unreachable now.
    setPhase("applying");
    const before = resources;

    // Each cell's currentValue was captured at PROPOSE time; confirm applies
    // against these CONFIRM-time resources. If the grid changed while the
    // modal was open (another edit, a background sync, ...), a chosen cell's
    // live stored value may no longer match what the user reviewed — writing
    // it anyway would silently overwrite a value the user never saw or
    // approved (the same silent-overwrite class timelog-apply.ts had to
    // close). Drop any cell whose live value has moved and tell the user how
    // many were skipped for that reason, rather than applying blind.
    const resourceById = new Map(before.map((r) => [r.id, r]));
    const fresh: GroundedAllocCell[] = [];
    let staleCount = 0;
    for (const c of chosen) {
      const live = resourceById.get(c.resourceId);
      const liveValue = live?.utilization[c.periodKey] ?? 0;
      if (live && liveValue === c.currentValue) {
        fresh.push(c);
      } else {
        staleCount++;
      }
    }
    if (staleCount > 0) {
      showToast("info", t(lang, "allocPlanSkippedStale", staleCount));
    }
    if (fresh.length === 0) {
      // Every chosen cell had moved — the stale toast above already told the
      // user why; there is nothing left to apply.
      reset();
      return;
    }

    const result = applyAllocationCells(before, fresh, new Date().toISOString());
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
    // Report what was ACTUALLY applied (`fresh.length`), not the original
    // selection count (`chosen.length`) — the two diverge exactly when the
    // stale-cell guard above dropped one or more cells.
    logActivity?.("ai.allocationPlan", fresh.length);
    showToast("info", t(lang, "allocPlanApplied", fresh.length));
    reset();
  }, [phase, cells, selected, resources, setResources, capture, logActivity, showToast, lang, reset]);

  const stage: "input" | "preview" = phase === "preview" || phase === "applying" ? "preview" : "input";
  // The `"applying"` phase never actually commits a render (see the NOTE in
  // onConfirm above) — the `phase === "applying"` checks here, and the
  // consequent `canCancel:false` / `busy:true` the modal receives, are
  // defence-in-depth for a future async apply, not live behaviour today.
  const busy = phase === "thinking" || phase === "applying";
  const canCancel = phase !== "applying";

  // ★ This trigger only OPENS the modal — the billed call fires from inside it
  //   (`onPropose`). So `busy` is `"thinking"` alone: the other non-idle phases
  //   ("input"/"preview"/"applying") kept the trigger DISABLED before and still
  //   do, because none of them is a stoppable Claude call.
  // ★ The longer `allocPlanTitle` sentence, which used to ride `title` as the
  //   accessible DESCRIPTION, is gone — AiTriggerButton pins `title` to the
  //   label so the visible text and the name can never diverge (WCAG 2.5.3).
  const button = enabled ? (
    <AiTriggerButton
      lang={lang}
      busy={phase === "thinking"}
      onRun={onOpen}
      onCancel={reset}
      idleLabelKey="allocPlan"
      idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
      disabled={phase !== "idle" && phase !== "thinking"}
    />
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
      truncated={truncated}
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
