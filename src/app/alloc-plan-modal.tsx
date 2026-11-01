"use client";

// Presentational preview/confirm modal for AI-assisted resource-allocation
// planning. The caller (the alloc-plan glue hook) drives the
// propose -> ground -> apply state machine and owns the grounded cells, the
// per-cell selection, and the confirm/cancel handlers. This component owns ONE
// piece of state, the instruction text, handed to `onPropose` once: held by the
// caller, every keystroke re-rendered the Resources panel that owns the hook,
// planning grid included. It is mounted only while the plan is open, so each
// opening starts empty, and it stays mounted back to "input" after an empty
// proposal, so the text survives a retry. It reaches into NO context and
// performs NO writes — it renders the instruction field (stage "input") and, once
// grounded cells come back (stage "preview"), an itemized list the user
// reviews cell-by-cell before anything is applied. Mirrors task-dedup-modal.tsx.
//
// Itemization is load-bearing, not decorative: Resource.utilization holds
// hand-entered planning figures, and a bare "N cells will change" count is
// exactly the shape of confirm that let timelog-apply.ts silently overwrite
// hand-entered actualHours before it grew an itemized confirm. Every proposed
// cell here is shown with its current and next value and can be individually
// deselected.

import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Checkbox, Textarea } from "./form-controls";
import { SegmentedControl } from "./segmented-control";
import { AllocPlanEffect, AllocPlanMoveRows } from "./alloc-plan-moves";
import { AllocElsewhereSuggestions } from "./alloc-elsewhere-suggestions";
import { type CrossProjectPeople } from "./use-cross-project-people";
import { type AltEffect } from "./alloc-plan/alloc-effect";
import { type GroundedAlternative, type MoveSkipReason } from "./alloc-plan/alloc-ground-moves";
import {
  type SkipReason,
  cellKey,
  formatAllocValue,
} from "./alloc-plan/alloc-plan";

export interface AllocPlanModalProps {
  lang: Lang;
  open: boolean;
  /** "input" while collecting the instruction, "preview" once cells are back. */
  stage: "input" | "preview";
  /** Called with the instruction as typed. */
  onPropose: (instruction: string) => void;
  /** Every grounded alternative; the picker shows only with two or more. */
  alternatives: readonly GroundedAlternative[];
  activeIndex: number;
  onSelectAlternative: (index: number) => void;
  /** True when the proposal was too large and some cells were not shown at all. */
  truncated: boolean;
  /** The ACTIVE alternative's ticks: cellKey()s and moveKey()s the user has selected to apply (stale moves excluded). */
  selected: ReadonlySet<string>;
  /** The active alternative's moves whose inputs changed since they were proposed: marked and not applied. */
  staleMoves: ReadonlySet<string>;
  /** What applying the ticked rows of the active alternative would do. */
  effect: AltEffect;
  /** The project's baseline currency, for the cost line. */
  currency: string;
  /** Live task name and person name for an id; undefined when there is none. A skipped move names its task and
   *  person by them, since it carries ids only. */
  liveTaskName: (taskId: number) => string | undefined;
  liveResourceName: (resourceId: number) => string | undefined;
  /** §785: other projects' hours and the name suggestions; Run waits while it loads. Absent → none of it shows. */
  crossProject?: CrossProjectPeople;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while proposing or applying — disables the controls. */
  busy: boolean;
  /** False only while an apply is in flight — Cancel stays reachable while
   *  merely proposing (a billed call the user may want to call off).
   *  Required (no permissive default) so a caller can't forget it and
   *  silently get dismissal-during-apply back with no compiler signal. */
  canCancel: boolean;
}

// Exhaustive so a future SkipReason is a compile error here, not a blank row.
const SKIP_REASON_KEY: Record<SkipReason, TranslationKey> = {
  "unknown-resource": "allocPlanSkipUnknownResource",
  "out-of-window": "allocPlanSkipOutOfWindow",
  "no-capacity": "allocPlanSkipNoCapacity",
  "bad-hours": "allocPlanSkipBadHours",
  duplicate: "allocPlanSkipDuplicate",
  "below-resolution": "allocPlanSkipBelowResolution",
  "already-set": "allocPlanSkipAlreadySet",
  "covered-by-move": "allocPlanSkipCoveredByMove",
};

const MOVE_SKIP_REASON_KEY: Record<MoveSkipReason, TranslationKey> = {
  "unknown-task": "allocPlanSkipMoveUnknownTask",
  closed: "allocPlanSkipMoveClosed",
  jira: "allocPlanSkipMoveJira",
  "same-owner": "allocPlanSkipMoveSameOwner",
  "unknown-resource": "allocPlanSkipMoveUnknownResource",
  duplicate: "allocPlanSkipMoveDuplicate",
};

export function AllocPlanModal({
  lang,
  open,
  stage,
  onPropose,
  alternatives,
  activeIndex,
  onSelectAlternative,
  truncated,
  selected,
  staleMoves,
  effect,
  currency,
  liveTaskName,
  liveResourceName,
  crossProject,
  onToggle,
  onConfirm,
  onCancel,
  busy,
  canCancel,
}: AllocPlanModalProps) {
  const [instruction, setInstruction] = useState("");
  const title = t(lang, "allocPlanTitle");
  const isPreview = stage === "preview";
  // One clamped index drives both the picker's value and the alternative shown.
  const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(alternatives.length - 1, 0));
  const active: GroundedAlternative | undefined = alternatives[safeIndex];
  const cells = active?.cells ?? [];
  const moves = active?.moves ?? [];
  const skipped = active?.skipped ?? [];
  const skippedMoves = active?.skippedMoves ?? [];
  const selectedCount =
    cells.reduce((n, c) => (selected.has(cellKey(c)) ? n + 1 : n), 0) +
    moves.reduce((n, m) => (selected.has(m.key) ? n + 1 : n), 0);
  const names = new Map<number, string>();
  for (const alt of alternatives) {
    for (const c of alt.cells) names.set(c.resourceId, c.resourceName);
    for (const m of alt.moves) {
      if (m.fromResourceId !== undefined) names.set(m.fromResourceId, m.fromLabel);
      names.set(m.toResourceId, m.toLabel);
    }
  }
  const nameOf = (id: number): string => names.get(id) ?? liveResourceName(id) ?? `#${id}`;
  const skippedMoveText = (taskId: number, toResourceId: number): string => {
    const name = liveTaskName(taskId);
    return `#${taskId}${name ? ` ${name}` : ""} → ${nameOf(toResourceId)}`;
  };
  const hasRows = cells.length > 0 || moves.length > 0;
  const loadingElsewhere = crossProject?.status === "loading";
  const notLoadedElsewhere = crossProject?.status === "idle" && !crossProject.loadFailed;
  const canPropose = instruction.trim().length > 0 && !busy && !loadingElsewhere;
  const proposalResourceIds = [...cells.map((c) => c.resourceId), ...moves.flatMap((m) => (m.fromResourceId === undefined ? [m.toResourceId] : [m.fromResourceId, m.toResourceId]))];
  // A ticked hour edit the ticked moves already write is not applied (its count shows under the effect), so it does
  // not count here: with only such rows ticked there is nothing to apply.
  const canConfirm = !busy && selectedCount - effect.coveredCells > 0;
  // Modal's Escape/backdrop-click call onClose unconditionally — they know
  // nothing about canCancel — so during an apply (the one moment every other
  // control is disabled) they would be the ONLY remaining way to dismiss.
  // Neutering onClose itself, not just the visible button, is what actually
  // gates it. NOTE: today's caller (use-alloc-plan.tsx) applies fully
  // synchronously, so `canCancel` never actually goes false in practice — this
  // is defence-in-depth for the day apply grows an await, not live behaviour
  // right now. Keep it; see the NOTE in use-alloc-plan.tsx's onConfirm.
  const handleClose = canCancel ? onCancel : () => {};

  return (
    <Modal open={open} onClose={handleClose} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          {/* ★ NO help icon, deliberately. Measured over all 69 help bodies at
              69/69 resolved, "allocat" matches exactly 1 — concept-resource,
              which explains the resource CONCEPT and says nothing about this
              dialog's proposed allocation plan. A wrong entry is worse than no
              icon. See docs/open-followups.md §456 for the entry collecting all
              seven. */}
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "allocPlanIntro")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">
              {t(lang, "allocPlanInstructionLabel")}
            </span>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t(lang, "allocPlanInstructionPlaceholder")}
              disabled={busy || isPreview}
              rows={3}
              className="w-full"
            />
          </label>
          {crossProject && crossProject.protectedProjects.length > 0 && (
            <p className="mt-2 text-xs text-foreground">{t(lang, "allocElsewhereProtected", crossProject.protectedProjects.map((p) => p.projectName).join(", "))}</p>
          )}
          {!isPreview && notLoadedElsewhere && <p className="mt-2 text-xs text-foreground">{t(lang, "allocElsewhereNotLoaded")}</p>}

          {isPreview && (
            <>
              {crossProject?.loadFailed && <p className="mt-4 text-xs text-foreground">{t(lang, "allocElsewhereLoadFailed")}</p>}
              {crossProject && crossProject.failures.length > 0 && (
                <p className="mt-4 text-xs text-foreground">{t(lang, "allocElsewhereFailures", crossProject.failures.map((f) => f.projectName).join(", "))}</p>
              )}
              {truncated && (
                <p className="mt-4 text-xs text-muted-foreground">{t(lang, "allocPlanTruncated")}</p>
              )}
              {alternatives.length > 1 && (
                <SegmentedControl
                  className="mt-4 max-w-full flex-col sm:flex-row"
                  // Stacked below sm: ends rounded top and bottom, options divided by top borders; the shared row
                  // classes (left/right corners, left borders) still apply from sm up.
                  optionClassName="min-w-0 whitespace-normal break-words text-left max-sm:rounded-none max-sm:first:rounded-t-md max-sm:last:rounded-b-md max-sm:border-l-0 max-sm:not-first:border-t"
                  ariaLabel={t(lang, "allocPlanAlternatives")}
                  value={String(safeIndex)}
                  onChange={(v) => onSelectAlternative(Number(v))}
                  disabled={busy}
                  options={alternatives.map((alt, i) => ({
                    value: String(i),
                    label: (
                      <span className="flex min-w-0 flex-col items-start text-left">
                        <span>{t(lang, "allocPlanAlternativeN", i + 1)}</span>
                        {alt.summary !== "" && <span className="min-w-0 whitespace-normal break-words text-xs font-normal">{alt.summary}</span>}
                      </span>
                    ),
                  }))}
                />
              )}
              {alternatives.length === 1 && active && active.summary !== "" && (
                <p className="mt-3 text-sm font-medium text-foreground">{active.summary}</p>
              )}
              {active?.rationale && <p className="mt-1 text-xs text-muted-foreground">{active.rationale}</p>}
              {!hasRows && <p className="mt-3 text-sm text-muted-foreground">{t(lang, "allocPlanAlternativeEmpty")}</p>}
              {hasRows && <AllocPlanEffect lang={lang} effect={effect} currency={currency} nameOf={nameOf} />}
              {crossProject && hasRows && (
                <AllocElsewhereSuggestions lang={lang} crossProject={crossProject} resourceIds={proposalResourceIds} nameOf={nameOf} busy={busy} />
              )}
              {moves.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">{t(lang, "allocPlanMovesHeading")}</h3>
                  <AllocPlanMoveRows lang={lang} moves={moves} selected={selected} staleMoves={staleMoves} movePlan={effect.movePlan} onToggle={onToggle} busy={busy} />
                </>
              )}
              {cells.length > 0 && moves.length > 0 && (
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted-foreground">{t(lang, "allocPlanCellsHeading")}</h3>
              )}
              {cells.length > 0 && (
              <ul className="mt-2 space-y-2">
                {cells.map((c) => {
                  const key = cellKey(c);
                  const on = selected.has(key);
                  return (
                    <li
                      key={key}
                      className="rounded-md border border-line bg-surface-muted px-3 py-2"
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <Checkbox
                          checked={on}
                          disabled={busy}
                          onChange={() => onToggle(key)}
                          aria-label={`${t(lang, "allocPlanInclude")} – ${c.resourceName} (#${c.resourceId}) – ${c.periodKey}`}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">
                            {c.resourceName}
                            <span className="text-muted-foreground"> · {c.periodKey}</span>
                          </span>
                          <span className="mt-1 block text-sm text-foreground">
                            {formatAllocValue({ mode: c.mode, value: c.currentValue })}
                            {" → "}
                            {formatAllocValue({ mode: c.mode, value: c.nextValue })}
                            <span className="text-muted-foreground">
                              {" "}
                              ({t(lang, "allocPlanHoursOfCapacity", Math.round(c.hours), Math.round(c.capacityHours))})
                            </span>
                            {c.clamped && (
                              <span className="text-muted-foreground"> ({t(lang, "allocPlanClamped")})</span>
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              )}

              {(skipped.length > 0 || skippedMoves.length > 0) && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t(lang, "allocPlanSkippedTitle")}
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {skipped.map((s, i) => (
                      <li key={`${cellKey(s)}:${s.reason}:${i}`} className="text-xs text-muted-foreground">
                        #{s.resourceId} · {s.periodKey} — {t(lang, SKIP_REASON_KEY[s.reason])}
                      </li>
                    ))}
                    {skippedMoves.map((s, i) => (
                      <li key={`move:${s.taskId}:${s.reason}:${i}`} className="text-xs text-muted-foreground">
                        {skippedMoveText(s.taskId, s.toResourceId)} — {t(lang, MOVE_SKIP_REASON_KEY[s.reason])}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={!canCancel}>
            {t(lang, "allocPlanCancel")}
          </Button>
          {isPreview ? (
            <Button variant="primary" size="sm" onClick={onConfirm} disabled={!canConfirm}>
              {t(lang, "allocPlanConfirm")}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => onPropose(instruction)} disabled={!canPropose}>
              {busy ? t(lang, "allocPlanThinking") : loadingElsewhere ? t(lang, "allocElsewhereLoading") : t(lang, "allocPlanPropose")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
