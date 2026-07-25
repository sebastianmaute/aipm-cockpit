"use client";

// Presentational preview/confirm modal for AI-assisted resource-allocation
// planning. The caller (the alloc-plan glue hook, next task) drives the
// propose -> ground -> apply state machine and owns the instruction text, the
// grounded cells, the per-cell selection, and the confirm/cancel handlers.
// This component owns NO state, reaches into NO context, and performs NO
// writes — it only renders the instruction field (stage "input") and, once
// grounded cells come back (stage "preview"), an itemized list the user
// reviews cell-by-cell before anything is applied. Mirrors task-dedup-modal.tsx.
//
// Itemization is load-bearing, not decorative: Resource.utilization holds
// hand-entered planning figures, and a bare "N cells will change" count is
// exactly the shape of confirm that let timelog-apply.ts silently overwrite
// hand-entered actualHours before it grew an itemized confirm. Every proposed
// cell here is shown with its current and next value and can be individually
// deselected.

import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Textarea } from "./form-controls";
import {
  type GroundedAllocCell,
  type SkipReason,
  type SkippedCell,
  cellKey,
  formatAllocValue,
} from "./alloc-plan/alloc-plan";

export interface AllocPlanModalProps {
  lang: Lang;
  open: boolean;
  /** "input" while collecting the instruction, "preview" once cells are back. */
  stage: "input" | "preview";
  instruction: string;
  onInstruction: (value: string) => void;
  onPropose: () => void;
  cells: readonly GroundedAllocCell[];
  skipped: readonly SkippedCell[];
  /** cellKey()s the user has selected to apply. */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while proposing or applying — disables the controls. */
  busy: boolean;
  /** False only while an apply is in flight — Cancel stays reachable while
   *  merely proposing (a billed call the user may want to call off).
   *  Defaults to true so the component stays usable without it. */
  canCancel?: boolean;
}

// Exhaustive so a future SkipReason is a compile error here, not a blank row.
const SKIP_REASON_KEY: Record<SkipReason, TranslationKey> = {
  "unknown-resource": "allocPlanSkipUnknownResource",
  "out-of-window": "allocPlanSkipOutOfWindow",
  "no-capacity": "allocPlanSkipNoCapacity",
  "bad-hours": "allocPlanSkipBadHours",
  duplicate: "allocPlanSkipDuplicate",
};

export function AllocPlanModal({
  lang,
  open,
  stage,
  instruction,
  onInstruction,
  onPropose,
  cells,
  skipped,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  busy,
  canCancel = true,
}: AllocPlanModalProps) {
  const title = t(lang, "allocPlanTitle");
  const isPreview = stage === "preview";
  const selectedCount = cells.reduce((n, c) => (selected.has(cellKey(c)) ? n + 1 : n), 0);
  const canPropose = instruction.trim().length > 0 && !busy;
  const canConfirm = !busy && selectedCount > 0;

  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
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
              onChange={(e) => onInstruction(e.target.value)}
              placeholder={t(lang, "allocPlanInstructionPlaceholder")}
              aria-label={t(lang, "allocPlanInstructionLabel")}
              disabled={busy}
              rows={3}
              className="w-full"
            />
          </label>

          {isPreview && (
            <>
              <ul className="mt-4 space-y-2">
                {cells.map((c) => {
                  const key = cellKey(c);
                  const on = selected.has(key);
                  return (
                    <li
                      key={key}
                      className="rounded-md border border-line bg-surface-muted px-3 py-2"
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={() => onToggle(key)}
                          aria-label={`${t(lang, "allocPlanInclude")} – ${c.resourceName} – ${c.periodKey}`}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-ui-dark-blue focus:ring-ui-green"
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

              {skipped.length > 0 && (
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
            <Button variant="primary" size="sm" onClick={onPropose} disabled={!canPropose}>
              {busy ? t(lang, "allocPlanThinking") : t(lang, "allocPlanPropose")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
