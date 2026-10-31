"use client";

// RACI-pane glue for "Suggest RACI" (AI-assisted RACI assignment). Owns the
// propose -> ground -> preview -> confirm state machine plus the trigger
// button and the review modal element, mirroring use-tasks-dedup.tsx's shape
// (no free-text instruction — raci-suggest.ts's engine takes only the live
// stakeholders/milestones, unlike alloc-plan's instruction-driven flow) with
// the request-generation nonce, abort handling and error classification of
// use-alloc-plan.tsx. Plan-then-apply: the single forced Anthropic call
// PROPOSES RACI cells but NOTHING mutates the workspace until the user
// confirms per-cell in the modal. Pure logic (context/grounding) lives in
// ./raci-suggest/raci-suggest and is unit-tested there; this file is render
// glue, excluded from the coverage gate (src/app/**/*.tsx).
//
// SECURITY: the api key is read from the in-memory hydrated settings and
// passed straight to the call; it is never logged. Model output is UNTRUSTED
// and is re-grounded against the LIVE stakeholders/milestones
// (groundRaciCells) before it can touch anything — a hallucinated id, an
// invalid role, or a second Accountable for a milestone can never reach a
// write.
//
// ★★ APPLY IS THE HIGH-RISK PART. `onSave` (the stakeholders pane's save
// handler) takes a SINGLE stakeholder and writes the caller's object
// verbatim; `setRaciRole` returns a pure copy of a SNAPSHOT. Calling onSave
// once per accepted CELL would make two cells on the same stakeholder (but
// different milestones) each fold into the same stale snapshot, and the
// second call would silently drop the first's raci entry — real data loss.
// `foldCellsByStakeholder` collapses every accepted cell into ONE updated
// Stakeholder per person before any save happens, so onSave is called
// exactly once per touched stakeholder.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SparklesIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import {
  type ChangeItem, type Discipline, type Grade, type Milestone,
  type RaidItem, type Resource, type Role, type Stakeholder, type Task,
} from "./types";
import { type ProjectDocument } from "./document-model";
import { type LogActivityAsFn } from "./activity-log-context";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiFailureMessageKey } from "./ai-key-status";
import { runRaciSuggestion } from "./raci-suggest-call";
import { useActionGuideText } from "./action-guides-context";
import { useOpenProjectAiPrivacy, usePeopleProtected } from "./ai-privacy-context";
import {
  buildRaciContext,
  cellKey,
  groundRaciCells,
  type GroundedRaciCell,
  type SkippedRaciCell,
} from "./raci-suggest/raci-suggest";
import { setRaciRole } from "./stakeholders";
import { RaciSuggestModal } from "./raci-suggest-modal";
import { AiTriggerButton } from "./ai-trigger-button";
import { STAKEHOLDER_UNDO_GROUPS, buildBulkFieldEdits } from "./undo/field-groups";

type Phase = "idle" | "input" | "thinking" | "preview" | "applying";

export interface RaciSuggestDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  // The evidence and reference slices Claude reads alongside the matrix (§771).
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  documents: readonly ProjectDocument[];
  /** The stakeholders pane's save handler — mirrors every other entity save
   *  contract: `(item, isNew?, opts?)`, where `opts.suppressFieldUndo` skips
   *  the per-field undo capture (this hook records ONE bulk undo entry
   *  instead, via `onCaptureBulk`). */
  onSave: (item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void;
  /** Snapshot the touched stakeholders' field patches for undo, called
   *  BEFORE the save loop mutates them — mirrors `onCaptureStakeholderBulk`
   *  (the same capture the manual bulk-edit panel uses), so this feature
   *  gets one correctly-ordered undo entry for free instead of re-deriving
   *  the low-level `capture()` before/after-image contract itself. */
  onCaptureBulk?: (edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => void;
  /** ★ ACTOR-AWARE. This hook writes exactly one kind, and it is an `ai.*`
   *  one, so it KNOWS its actor — see the rule on `useActivityLog`. */
  logActivityAs?: LogActivityAsFn;
}

export interface RaciSuggest {
  /** The toolbar trigger element (null when the feature is unavailable). */
  button: ReactNode;
  /** The preview/confirm modal element (null while the feature is idle or thinking). */
  modal: ReactNode;
}

/** Collapse the accepted cells into ONE updated Stakeholder per person.
 *
 *  ★★ Load-bearing. `onSave` takes a single stakeholder and writes the
 *  caller's object verbatim, while `setRaciRole` returns a pure copy of a
 *  SNAPSHOT. So calling onSave once per CELL would make two cells on the
 *  same stakeholder each fold into the same stale snapshot, and the second
 *  would drop the first's raci key. Fold first, save once per stakeholder.
 *
 *  A stakeholder present in `cells` but absent from `stakeholders` (deleted
 *  between propose and confirm) is silently skipped, not resurrected. */
export function foldCellsByStakeholder(
  cells: readonly GroundedRaciCell[],
  stakeholders: readonly Stakeholder[],
): Stakeholder[] {
  const byId = new Map(stakeholders.map((s) => [s.id, s]));
  const folded = new Map<number, Stakeholder>();
  for (const c of cells) {
    const base = folded.get(c.stakeholderId) ?? byId.get(c.stakeholderId);
    if (!base) continue; // deleted between propose and confirm
    folded.set(c.stakeholderId, setRaciRole(base, c.milestoneId, c.role));
  }
  return [...folded.values()];
}

/** Drop every cell whose handover partner is not also in `chosen`. The two halves
 *  of a pair are applied together or not at all: an A without its demotion would
 *  leave a milestone with two Accountables. */
export function dropOrphanedPairHalves(chosen: readonly GroundedRaciCell[]): GroundedRaciCell[] {
  const perPair = new Map<string, number>();
  for (const c of chosen) if (c.pairKey) perPair.set(c.pairKey, (perPair.get(c.pairKey) ?? 0) + 1);
  return chosen.filter((c) => !c.pairKey || (perPair.get(c.pairKey) ?? 0) >= 2);
}

export function useRaciSuggest(deps: RaciSuggestDeps): RaciSuggest {
  const {
    settings, isPopout, lang, stakeholders, milestones, tasks, raid, changes, resources, roles, disciplines, grades,
    documents, onSave, onCaptureBulk, logActivityAs,
  } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [cells, setCells] = useState<readonly GroundedRaciCell[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedRaciCell[]>([]);
  // Cells dropped as no-ops (the role proposed is already stored). Kept so the
  // preview can say so: before, only the empty-and-no-skips toast read it, and
  // a preview whose cells were all no-op or refused said nothing about them (§43).
  const [noOp, setNoOp] = useState(0);
  const [truncated, setTruncated] = useState(false);
  // Tracked SEPARATELY from `truncated`. That flag means the response was cut;
  // this one means the INPUT was — the model never saw some stakeholders or
  // milestones, so their absence from the proposal says nothing about them.
  // buildRaciContext computes this and it was previously dropped on the floor,
  // which made a capped input indistinguishable from "Claude assigned no role".
  const [contextTruncated, setContextTruncated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [request, setRequest] = useState("");
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const guideText = useActionGuideText("raci");
  const aiPrivacy = useOpenProjectAiPrivacy(); // AI people protection (spec R3)
  // AI people protection (layer 1): RACI suggestions rate people, so a protected project has none — the
  // trigger is hidden, an open preview closes and is reset (below), and propose/apply refuse. Guarded HERE, not at the button.
  const peopleProtected = usePeopleProtected();
  const enabled =
    isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() &&
    stakeholders.length > 0 && milestones.length > 0 && !peopleProtected;
  // Review 3, R6: protection turning on RESETS the preview (render-time reconcile; set-state-in-effect is banned),
  // so a stale proposal cannot reappear when protection is turned off again. The request in flight is
  // invalidated by the effect below (refs are not touched during render).
  if (peopleProtected && (phase !== "idle" || cells.length > 0 || skipped.length > 0)) {
    setPhase("idle");
    setCells([]);
    setSkipped([]);
    setNoOp(0);
    setTruncated(false);
    setContextTruncated(false);
    setSelected(new Set());
    setRequest("");
  }
  // Refs only, no state: a proposal still in flight when protection turns on is aborted and discarded.
  useEffect(() => {
    if (!peopleProtected) return;
    reqIdRef.current++;
    abortRef.current?.abort();
  }, [peopleProtected]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setPhase("idle");
    setCells([]);
    setSkipped([]);
    setNoOp(0);
    setTruncated(false);
    setContextTruncated(false);
    setSelected(new Set());
    setRequest("");
  }, []);

  // Abort any in-flight proposal if the pane unmounts — a response must
  // never land against a dead component. Cleanup-only: sets no state, so it
  // doesn't run into the set-state-in-effect ban.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The trigger opens the dialog on its input stage; nothing is billed until Run.
  const onOpen = useCallback(() => {
    if (!enabled || phase !== "idle") return;
    setPhase("input");
  }, [enabled, phase]);

  const onPropose = useCallback(async () => {
    if (!enabled || phase !== "input") return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const context = buildRaciContext({
        stakeholders, milestones, tasks, raid, changes, resources, roles, disciplines, grades, documents, request,
      });
      const parsed = await runRaciSuggestion(context, { apiKey, model: settings.ai.model, guideText, privacy: aiPrivacy() }, controller.signal);
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids/roles against the LIVE stakeholders/
      // milestones before anything can be shown or applied.
      const grounded = groundRaciCells(parsed.cells, stakeholders, milestones);
      setSkipped(grounded.skipped);
      setNoOp(grounded.noOp);
      // parsed.truncated is where an over-large proposal ACTUALLY gets cut
      // (parseRaciProposal caps at the same MAX_RACI_CELLS grounding does, so
      // grounded.truncated alone can never fire on this real path — it stays
      // as defense in depth for a caller that skips parsing). OR both so
      // neither omission goes unreported.
      setTruncated(parsed.truncated || grounded.truncated);
      setContextTruncated(context.truncated);
      if (grounded.cells.length === 0 && grounded.skipped.length === 0) {
        // Three different outcomes reach this branch and they are not the same
        // sentence. "Claude proposed no assignments" is only true when nothing
        // came back at all; when every cell was dropped as a no-op the model
        // DID propose — you already have what it suggested, which is the
        // ordinary result of re-running against a populated matrix.
        showToast(
          "info",
          t(lang, grounded.noOp > 0 ? "raciSuggestAllExisting" : "raciSuggestNoProposal"),
        );
        // The modal is the only renderer of the context-cap notice, and this
        // path never opens it — so on a capped project that proposed nothing,
        // the one case where "why is this empty?" most needs answering, the
        // signal would be computed and then silently dropped. Again.
        if (context.truncated) showToast("info", t(lang, "raciSuggestContextTruncated"));
        reset();
        return;
      }
      // Preselect every grounded cell; skipped-only results still surface via
      // the preview stage (the only stage the modal renders them in).
      setCells(grounded.cells);
      setSelected(new Set(grounded.cells.map(cellKey)));
      setPhase("preview");
    } catch (e) {
      if (reqId !== reqIdRef.current) return; // stale failure — ignore
      // AbortError is raised when the controller fires (cancel/reopen) —
      // treat as a user-initiated stop, not a real error. Read .name
      // directly (never `instanceof DOMException`) — mirrors chat-panel.tsx.
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
        showToast("error", t(lang, "raciSuggestError"));
      }
      setPhase("input");
    }
  }, [enabled, phase, stakeholders, milestones, tasks, raid, changes, resources, roles, disciplines, grades, documents, request, reset, apiKey, settings.ai.model, guideText, aiPrivacy, lang, showToast]);

  const onToggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onConfirm = useCallback(() => {
    if (peopleProtected || phase !== "preview") return;
    // Pair integrity first: a half whose partner was deselected is dropped, so a
    // lone new Accountable (or lone demotion) can never be written.
    // A half whose stakeholder was deleted since propose counts as not chosen, so it orphans its partner
    // (foldCellsByStakeholder would otherwise skip it silently and save the other half alone).
    const liveIds = new Set(stakeholders.map((s) => s.id));
    const chosen = dropOrphanedPairHalves(
      cells.filter((c) => selected.has(cellKey(c)) && liveIds.has(c.stakeholderId)),
    );
    if (chosen.length === 0) return;
    const updated = foldCellsByStakeholder(chosen, stakeholders);
    if (updated.length === 0) {
      // Every chosen cell's stakeholder vanished since propose — nothing left to apply.
      reset();
      return;
    }
    setPhase("applying");
    // Snapshot BEFORE the save loop mutates — mirrors captureBulkUndo's own
    // "call BEFORE the loop" contract. Field patches rather than whole rows,
    // same as the manual bulk-edit panel — see open-followups #50.
    const originalById = new Map(stakeholders.map((s) => [s.id, s]));
    const rows = updated
      .map((after) => {
        const before = originalById.get(after.id);
        return before ? { before, after } : null;
      })
      .filter((row): row is { before: Stakeholder; after: Stakeholder } => row !== null);
    // The write set DERIVES from the capture. `buildBulkFieldEdits` drops a row
    // whose diff is empty, so confirming a cell that merely re-states the role a
    // stakeholder already carries yields no edit — and saving it anyway would
    // stamp a fresh `localModifiedAt` (`use-stakeholders.ts`) and log a
    // `stakeholder.updated` with no undo entry behind it.
    // ★ Hoisted out of the optional call deliberately: `onCaptureBulk?.(build())`
    // never evaluates `build()` when no capture prop is wired, which would leave
    // `wrote` empty and apply nothing at all.
    // ★ Looping `rows` rather than `updated` is not a narrowing — `foldCellsByStakeholder`
    // folds over the SAME `stakeholders` list `originalById` is built from, so every
    // `after.id` resolves and `rows.length === updated.length`; the null filter above
    // is defensive.
    const edits = buildBulkFieldEdits(rows, STAKEHOLDER_UNDO_GROUPS);
    const wrote = new Set(edits.map((e) => e.id));
    onCaptureBulk?.(edits);
    for (const { after } of rows) {
      if (wrote.has(after.id)) onSave(after, false, { suppressFieldUndo: true });
    }
    // Report the number of CELL assignments applied (chosen.length), not the
    // number of stakeholders touched (updated.length) — the activity string
    // reads "N RACI assignments".
    logActivityAs?.("ai", "ai.raciSuggest", chosen.length);
    reset();
  }, [peopleProtected, phase, cells, selected, stakeholders, onSave, onCaptureBulk, logActivityAs, reset]);

  const busy = phase === "thinking" || phase === "applying";

  // The shared AiTriggerButton owns the label/name coherence this site used to
  // hand-roll: while the billed proposal is in flight BOTH the visible text and
  // the accessible name read "Stop" and the click aborts, so WCAG 2.5.3 (F96)
  // holds without a separate "Asking Claude…" wording.
  //
  // ★ `busy` here is `"thinking"` ALONE, not this hook's `busy` const —
  //   `"applying"` is committing rows locally, not waiting on Claude, so it is
  //   not a stoppable state. It stays DISABLED, exactly as it was before.
  const button = enabled ? (
    <AiTriggerButton
      lang={lang}
      busy={phase === "thinking"}
      onRun={onOpen}
      onCancel={reset}
      idleLabelKey="raciSuggest"
      idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
      disabled={phase !== "idle" && phase !== "thinking"}
    />
  ) : null;

  // Under protection the phase is already reset to idle above; the extra guard keeps the reconciling render from
  // building the modal.
  const modal = phase !== "idle" && !peopleProtected ? (
    <RaciSuggestModal
      lang={lang}
      open
      stage={phase === "preview" || phase === "applying" ? "preview" : "input"}
      request={request}
      onRequestChange={setRequest}
      onRun={() => void onPropose()}
      canCancel={phase !== "applying"}
      cells={cells}
      skipped={skipped}
      noOp={noOp}
      truncated={truncated}
      contextTruncated={contextTruncated}
      stakeholders={stakeholders}
      milestones={milestones}
      selected={selected}
      onToggle={onToggle}
      onConfirm={onConfirm}
      onCancel={reset}
      busy={busy}
    />
  ) : null;

  return { button, modal };
}
