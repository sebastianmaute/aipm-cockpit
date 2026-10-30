"use client";

// Resources-pane glue for "Plan with AI" (AI-assisted resource-allocation
// planning). Owns the propose -> ground -> preview -> confirm state machine
// plus the trigger button and the preview modal element, mirroring
// use-tasks-dedup.tsx's shape exactly. Plan-then-apply: the single forced
// Anthropic call PROPOSES up to three alternatives of task moves and allocation
// cells but NOTHING mutates the workspace until the user picks one and confirms
// its rows in the modal; the ticked rows apply as ONE undo entry (§769). Pure
// logic (context/grounding/apply) lives in ./alloc-plan/ and is unit-tested there; this file
// is render glue, excluded from the coverage gate (src/app/**/*.tsx).
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// re-grounded (groundAlternative) against the tasks/resources/plan captured when
// the call was sent — a hallucinated task or resource id or an out-of-window
// period key can never reach a write. The window can stay open while the live
// state moves on, so apply re-checks every row against the LIVE state first
// (isMoveStale, the cell value check) and skips what changed.

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "./icons";
import { type Lang, t, tPlural } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Absence, type Discipline, type Grade, type Milestone, type Resource, type ResourcePlan, type Role, type Stakeholder, type Task } from "./types";
import { type LogActivityAsFn } from "./activity-log-context";
import { captureFieldPart, type CompositeFragment, type UndoStackApi } from "./undo/use-undo-stack";
import { type ReassignHours } from "./use-reassign-hours";
import { resourceDisplayName } from "./resource-foundation";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiFailureMessageKey } from "./ai-key-status";
import { runAllocProposal } from "./alloc-plan-call";
import { useActionGuideText } from "./action-guides-context";
import { useOpenProjectAiPrivacy, usePeopleProtected } from "./ai-privacy-context";
import {
  applyAllocationCells,
  buildAllocContext,
  cellKey,
  type GroundedAllocCell,
} from "./alloc-plan/alloc-plan";
import { alternativeEffect } from "./alloc-plan/alloc-effect";
import { groundAlternative, isMoveStale, moveKey, type GroundedAlternative } from "./alloc-plan/alloc-ground-moves";
import { planApply } from "./alloc-plan/alloc-apply";
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
  /** Live tasks, milestones and RACI: the digest the model reads and the moves are grounded against (§769). */
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  /** YYYY-MM-DD: the date §774 splits a task's remaining hours from. */
  today: string;
  /** §774's shared step: a ticked move is applied through it, so the hours follow the task. */
  reassignTasks: ReassignHours["reassignTasks"];
  /** §548 — the load hold as §774's step sees it: while true, apply writes nothing (the step would refuse the moves,
   *  and the hour edits must not go alone). A function, read at click time. */
  isLoadHeld: ReassignHours["isLoadHeld"];
  capture?: UndoStackApi["capture"];
  /** Records a cells-only apply as one entry; absent → `capture`, as before §769. */
  captureComposite?: UndoStackApi["captureComposite"];
  /** ★ ACTOR-AWARE. This hook writes exactly one kind, and it is an `ai.*`
   *  one, so it KNOWS its actor — see the rule on `useActivityLog`. */
  logActivityAs?: LogActivityAsFn;
}

export interface AllocPlan {
  /** The toolbar trigger element (null when the feature is unavailable). */
  button: ReactNode;
  /** The preview/confirm modal element (null while the feature is idle). */
  modal: ReactNode;
}

const NO_KEYS: ReadonlySet<string> = new Set();
// The input stage has no alternative yet; the effect of nothing is computed from an empty one.
const EMPTY_ALTERNATIVE: GroundedAlternative = { summary: "", moves: [], skippedMoves: [], cells: [], skipped: [], truncated: false };

/** Every move and hour edit of an alternative: what the review window preselects. */
function allKeys(alt: GroundedAlternative): ReadonlySet<string> {
  return new Set([...alt.moves.map(moveKey), ...alt.cells.map(cellKey)]);
}

/** What one apply did, by reason. ★ ONE toast per apply (there is a single toast slot): each non-zero count gets its
 *  own sentence, so a row skipped for one reason is never reported under another's. */
interface ApplyCounts {
  applied: number;
  /** Rows whose inputs changed while the window was open. */
  stale: number;
  /** Hour edits the ticked moves, planned together, already write. */
  covered: number;
  /** Moves and hour edits that would change nothing. */
  unchanged: number;
}

function applyToastText(lang: Lang, c: ApplyCounts): string {
  return [
    c.applied > 0 ? tPlural(lang, "allocPlanApplied", c.applied, c.applied) : "",
    c.stale > 0 ? tPlural(lang, "allocPlanSkippedStale", c.stale, c.stale) : "",
    c.covered > 0 ? tPlural(lang, "allocPlanSkippedCovered", c.covered, c.covered) : "",
    c.unchanged > 0 ? tPlural(lang, "allocPlanSkippedUnchanged", c.unchanged, c.unchanged) : "",
  ].filter((x) => x !== "").join(" ");
}

export function useAllocPlan(deps: AllocPlanDeps): AllocPlan {
  const { settings, isPopout, lang, resources, setResources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet } = deps;
  const { tasks, milestones, stakeholders, today, reassignTasks, isLoadHeld, capture, captureComposite, logActivityAs } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  // The instruction is NOT held here: the modal keeps it and hands it to onPropose. Held here, every keystroke
  // re-rendered the Resources panel that owns this hook, planning grid included.
  const [alternatives, setAlternatives] = useState<readonly GroundedAlternative[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Each alternative keeps its own ticks, so switching back and forth loses nothing (§769 "The review window").
  const [selectedByAlt, setSelectedByAlt] = useState<ReadonlyMap<number, ReadonlySet<string>>>(new Map());
  const [truncated, setTruncated] = useState(false);
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const guideText = useActionGuideText("alloc");
  const aiPrivacy = useOpenProjectAiPrivacy(); // AI people protection (spec R3)
  // AI people protection (layer 1): Plan with AI moves people, so a protected project has no Plan with AI at
  // all — the trigger is hidden, an open window closes, and propose/apply refuse. Guarded HERE, not at the
  // button, so no other entry point reaches it.
  const peopleProtected = usePeopleProtected();
  const enabled = isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() && resources.length > 0 && !peopleProtected;

  // Invalidate/abort anything pending and clear the propose/preview state.
  // Shared by reset() (which also drops the phase to idle) and onOpen()
  // (which instead lands on "input" — there shouldn't be anything pending
  // while idle, but clearing unconditionally mirrors reset() exactly).
  const clearProposalState = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setAlternatives([]);
    setActiveIndex(0);
    setSelectedByAlt(new Map());
    setTruncated(false);
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

  const onPropose = useCallback(async (instruction: string) => {
    if (peopleProtected || phase !== "input" || !instruction.trim()) return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const context = buildAllocContext({
        resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet, tasks, milestones, stakeholders, instruction, today,
      });
      const parsed = await runAllocProposal(context, { apiKey, model: settings.ai.model, guideText, privacy: aiPrivacy() }, instruction, controller.signal);
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids/keys before anything can be shown or applied: a hallucinated task or resource, or
      // an out-of-window period key, is dropped here. This is the state captured when the call was SENT, not the live
      // state at this moment — an edit that landed while the call ran is caught by the stale check at apply.
      const ctx = { resources, plan, absences, workdayHours, holidaySet, tasks, today };
      const grounded = parsed.alternatives.map((raw) => groundAlternative(raw, ctx));
      // parsed.truncated is where an over-large proposal ACTUALLY gets cut (parseAllocationAlternatives caps cells at
      // the same MAX_ALLOC_CELLS grounding does); each alternative's own flag stays as defence in depth. OR them all
      // so no omission goes unreported.
      setTruncated(parsed.truncated || grounded.some((a) => a.truncated));
      const anything = grounded.some((a) => a.moves.length + a.cells.length + a.skipped.length + a.skippedMoves.length > 0);
      if (anything) {
        // Preselect every grounded row; skipped-only results still surface via the preview stage (the only stage the
        // modal renders them in) — silently, since a modal explaining what was refused and why is not "nothing was
        // proposed".
        setAlternatives(grounded);
        setActiveIndex(0);
        setSelectedByAlt(new Map(grounded.map((a, i) => [i, allKeys(a)])));
        setPhase("preview");
      } else {
        // Nothing at all came back (no rows AND no skips) — only now is "nothing was proposed" true. Stay on the
        // instruction step so the user can revise and retry without reopening.
        showToast("info", t(lang, "allocPlanNoChanges"));
        setSelectedByAlt(new Map());
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
      // §650 — a refused key (401/403) is named as the key problem, ahead of the response's own
      // message ("invalid x-api-key"), which does not say what to do.
      const failureKey = aiFailureMessageKey(e);
      if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
        showToast("error", t(lang, "aiUsageLimitReached"));
      } else if (failureKey) {
        showToast("error", t(lang, failureKey));
      } else if (e instanceof AiHttpError && e.safeMessage) {
        // The response body's error.message carries no secret — safe to surface.
        showToast("error", e.safeMessage);
      } else {
        showToast("error", t(lang, "allocPlanError"));
      }
      setPhase("input");
    }
  }, [peopleProtected, phase, resources, roles, disciplines, grades, plan, absences, workdayHours, holidaySet, tasks, milestones, stakeholders, today, apiKey, settings.ai.model, guideText, aiPrivacy, lang, showToast]);

  // Toggles a row of the ACTIVE alternative only; the others keep their ticks.
  const onToggle = useCallback((key: string) => {
    setSelectedByAlt((prev) => {
      const next = new Set(prev.get(activeIndex) ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return new Map(prev).set(activeIndex, next);
    });
  }, [activeIndex]);

  // A cells-only apply records its own ONE entry: through `captureComposite` when there is one (its toast keeps the
  // Undo button), else through the plain `capture` as before §769.
  const recordCellsOnly = useCallback((cells: readonly GroundedAllocCell[], count: number, cellsPart: CompositeFragment | null, toastText: string) => {
    if (captureComposite) {
      captureComposite({ kind: "bulk.edit", entityKey: "resource", primaryCount: count, parts: [cellsPart], toastText });
      return;
    }
    const { nextResources, editedBefore } = applyAllocationCells(resources, cells, new Date().toISOString());
    // §177b — undo reverts only the utilization cells the plan wrote (a per-key merge), so a concurrent edit to
    // another period survives.
    capture?.({ setter: setResources, kind: "bulk.edit", edited: editedBefore, editedAfter: nextResources, fromArray: resources, entityKey: "resource" });
    showToast("info", toastText);
  }, [captureComposite, capture, resources, setResources, showToast]);

  const onConfirm = useCallback(() => {
    if (peopleProtected || phase !== "preview") return;
    // §548 — while the load hold is up nothing is written: §774's step refuses the moves then, and the hour edits must
    // not be written without them. The window stays as it is; the hold's own render replaces the pane.
    if (isLoadHeld()) return;
    const alt = alternatives[activeIndex];
    const selected = selectedByAlt.get(activeIndex);
    if (!alt || !selected) return;
    // What to write, judged against the LIVE state, and every skip under its own reason (alloc-apply.ts).
    const p = planApply(alt, selected, { resources, plan, absences, workdayHours, holidaySet, tasks, today });
    if (p.chosen === 0) return;
    // NOTE: this body is synchronous to its final reset(), so React batches "applying" away and the modal never sees
    // it today; it is kept for the day apply grows an await (the modal busy state and handleClose guard are ready for
    // that future). Do not delete it as dead code.
    setPhase("applying");
    // A move §774 does not apply after all (its edit is a no-op there) changes nothing; it is counted, never dropped.
    const toastFor = (applied: number, unchangedMoves: number): string =>
      applyToastText(lang, { applied, stale: p.stale, covered: p.covered, unchanged: p.unchanged + unchangedMoves });
    if (p.ownerEdits.length === 0 && p.patches.length === 0) {
      const text = toastFor(0, 0);
      if (text) showToast("info", text);
      reset();
      return;
    }
    // The hour edits' undo fragment: per-key, so it shares one entry with §774's resources part.
    const cellsPart = captureFieldPart<Resource>({ setter: setResources, edits: p.patches, stampField: "localModifiedAt" });
    // ★ Moves first: §774 writes owners and hours through its own functional setters; the cells then write through a
    //   FUNCTIONAL setter on `prev`, on top of the moved hours. No cell left touches a key a fresh move writes.
    const applied = p.ownerEdits.length === 0 ? 0 : reassignTasks(p.ownerEdits, "ai", {
      toastText: (n) => toastFor(n + p.cellCount, p.ownerEdits.length - n),
      extraParts: [cellsPart],
      kind: "bulk.edit",
      // Moves AND hour edits name no single entity: the label falls back to "Edited N items".
      entityKey: p.cellCount > 0 ? undefined : "task",
      primaryCount: (n) => n + p.cellCount,
    });
    const nowIso = new Date().toISOString();
    if (p.patches.length > 0) setResources((prev) => applyAllocationCells(prev, p.cells, nowIso).nextResources);
    if (applied > 0) {
      // §774 recorded the ONE entry (tasks, moved hours and these cells) and showed its toast. The alternative's
      // NUMBER, never its summary: model text is untrusted and the log is read back into prompts.
      logActivityAs?.("ai", "ai.allocationPlanAlt", activeIndex + 1, applied, p.cellCount);
    } else if (p.cellCount === 0) {
      const text = toastFor(0, p.ownerEdits.length);
      if (text) showToast("info", text);
    } else {
      recordCellsOnly(p.cells, p.cellCount, cellsPart, toastFor(p.cellCount, p.ownerEdits.length));
      logActivityAs?.("ai", "ai.allocationPlan", p.cellCount);
    }
    reset();
  }, [peopleProtected, phase, isLoadHeld, alternatives, activeIndex, selectedByAlt, resources, tasks, plan, absences, workdayHours, holidaySet, today, setResources, reassignTasks, recordCellsOnly, logActivityAs, showToast, lang, reset]);

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
  // ★ The accessible NAME stays the visible label ("Plan with AI"); the longer
  //   `allocPlanTitle` sentence rides `description` → `title`, the accessible
  //   DESCRIPTION. Naming the button with the long sentence would fail WCAG
  //   2.5.3 (the visible string is not contained in it); dropping the sentence
  //   entirely would lose real disclosure for screen-reader users.
  const button = enabled ? (
    <AiTriggerButton
      lang={lang}
      busy={phase === "thinking"}
      onRun={onOpen}
      onCancel={reset}
      idleLabelKey="allocPlan"
      idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
      description={t(lang, "allocPlanTitle")}
      disabled={phase !== "idle" && phase !== "thinking"}
    />
  ) : null;

  const buildModal = (): ReactNode => {
    const active = alternatives[activeIndex];
    const live = { resources, plan, absences, workdayHours, holidaySet, tasks, today };
    // A move whose inputs changed while the window is open is marked and cannot be applied (onConfirm would skip it as
    // stale), so it leaves the selection the effect, the move rows' combined plan and the Apply count are built from.
    const staleMoves = new Set((active?.moves ?? []).filter((m) => isMoveStale(m, live)).map((m) => m.key));
    const ticked = selectedByAlt.get(activeIndex) ?? NO_KEYS;
    const selected = staleMoves.size === 0 ? ticked : new Set([...ticked].filter((k) => !staleMoves.has(k)));
    const taskById = new Map(tasks.map((x) => [x.id, x]));
    const resourceById = new Map(resources.map((r) => [r.id, r]));
    const liveResourceName = (id: number): string | undefined => {
      const r = resourceById.get(id);
      return r ? resourceDisplayName(r) : undefined;
    };
    return (
      <AllocPlanModal
        lang={lang}
        open
        stage={stage}
        onPropose={(text) => void onPropose(text)}
        alternatives={alternatives}
        activeIndex={activeIndex}
        onSelectAlternative={setActiveIndex}
        truncated={truncated}
        selected={selected}
        staleMoves={staleMoves}
        effect={alternativeEffect(active ?? EMPTY_ALTERNATIVE, selected, {
          resources,
          roles,
          plan,
          absences,
          workdayHours,
          holidaySet,
          tasks,
          today,
        })}
        currency={plan.currency}
        liveTaskName={(id) => taskById.get(id)?.taskName}
        liveResourceName={liveResourceName}
        onToggle={onToggle}
        onConfirm={onConfirm}
        onCancel={reset}
        busy={busy}
        canCancel={canCancel}
      />
    );
  };
  // The effect is computed inside buildModal, so it runs only while the modal is open.
  const modal = phase !== "idle" && !peopleProtected ? buildModal() : null;

  return { button, modal };
}
