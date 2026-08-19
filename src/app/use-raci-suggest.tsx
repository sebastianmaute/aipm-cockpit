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
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import { type Milestone, type Stakeholder } from "./types";
import { type LogActivityAsFn } from "./activity-log-context";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { runRaciSuggestion } from "./raci-suggest-call";
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
import { buildBulkFieldEdits } from "./undo/field-groups";

type Phase = "idle" | "thinking" | "preview" | "applying";

export interface RaciSuggestDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
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

export function useRaciSuggest(deps: RaciSuggestDeps): RaciSuggest {
  const { settings, isPopout, lang, stakeholders, milestones, onSave, onCaptureBulk, logActivityAs } = deps;
  const showToast = useToastContext();

  const [phase, setPhase] = useState<Phase>("idle");
  const [cells, setCells] = useState<readonly GroundedRaciCell[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedRaciCell[]>([]);
  const [truncated, setTruncated] = useState(false);
  // Tracked SEPARATELY from `truncated`. That flag means the response was cut;
  // this one means the INPUT was — the model never saw some stakeholders or
  // milestones, so their absence from the proposal says nothing about them.
  // buildRaciContext computes this and it was previously dropped on the floor,
  // which made a capped input indistinguishable from "Claude assigned no role".
  const [contextTruncated, setContextTruncated] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error toast).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(settings.ai);
  const enabled =
    isAiEnabled(settings.ai) && !isPopout && !!apiKey.trim() &&
    stakeholders.length > 0 && milestones.length > 0;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setPhase("idle");
    setCells([]);
    setSkipped([]);
    setTruncated(false);
    setContextTruncated(false);
    setSelected(new Set());
  }, []);

  // Abort any in-flight proposal if the pane unmounts — a response must
  // never land against a dead component. Cleanup-only: sets no state, so it
  // doesn't run into the set-state-in-effect ban.
  useEffect(() => () => abortRef.current?.abort(), []);

  const onPropose = useCallback(async () => {
    if (!enabled || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking");
    try {
      const context = buildRaciContext(stakeholders, milestones);
      const parsed = await runRaciSuggestion(context, { apiKey, model: settings.ai.model }, controller.signal);
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model ids/roles against the LIVE stakeholders/
      // milestones before anything can be shown or applied.
      const grounded = groundRaciCells(parsed.cells, stakeholders, milestones);
      setSkipped(grounded.skipped);
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
        setPhase("idle");
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
        setPhase("idle");
        return;
      }
      if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
        showToast("error", t(lang, "aiUsageLimitReached"));
      } else if (e instanceof AiHttpError && e.safeMessage) {
        // The response body's error.message carries no secret — safe to surface.
        showToast("error", e.safeMessage);
      } else {
        showToast("error", t(lang, "raciSuggestError"));
      }
      setPhase("idle");
    }
  }, [enabled, phase, stakeholders, milestones, apiKey, settings.ai.model, lang, showToast]);

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
    const edits = buildBulkFieldEdits(rows);
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
  }, [phase, cells, selected, stakeholders, onSave, onCaptureBulk, logActivityAs, reset]);

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
      onRun={() => void onPropose()}
      onCancel={reset}
      idleLabelKey="raciSuggest"
      idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
      disabled={phase === "applying"}
    />
  ) : null;

  const modal = phase === "preview" || phase === "applying" ? (
    <RaciSuggestModal
      lang={lang}
      open
      cells={cells}
      skipped={skipped}
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
