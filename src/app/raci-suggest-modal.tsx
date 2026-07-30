"use client";

// Presentational preview/confirm modal for "Suggest RACI". The caller (the
// use-raci-suggest glue hook) drives the propose -> ground -> apply state
// machine and owns the grounded cells, the per-cell selection, and the
// confirm/cancel handlers. This component owns NO state, reaches into NO
// context, and performs NO writes — it only renders the grounded cells the
// user reviews cell-by-cell before anything is applied. Mirrors
// alloc-plan-modal.tsx.
//
// Itemization is load-bearing, not decorative: `Stakeholder.raci` holds
// hand-maintained assignments, so every proposed cell is shown with its
// current and proposed role and can be individually deselected before Apply.

import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { ROLE_LABEL_KEY } from "./raci-chip-picker";
import {
  cellKey,
  type GroundedRaciCell,
  type SkippedRaciCell,
} from "./raci-suggest/raci-suggest";

export interface RaciSuggestModalProps {
  lang: Lang;
  open: boolean;
  cells: readonly GroundedRaciCell[];
  skipped: readonly SkippedRaciCell[];
  /** True when the proposal was too large and some cells were not shown at all. */
  truncated: boolean;
  /** cellKey()s the user has selected to apply. */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while proposing or applying — disables the controls. */
  busy: boolean;
}

export function RaciSuggestModal({
  lang,
  open,
  cells,
  skipped,
  truncated,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  busy,
}: RaciSuggestModalProps) {
  const title = t(lang, "raciSuggestTitle");
  const selectedCount = cells.reduce((n, c) => (selected.has(cellKey(c)) ? n + 1 : n), 0);
  const canConfirm = !busy && selectedCount > 0;

  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "raciSuggestIntro")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {truncated && (
            <p className="mb-4 text-xs text-muted-foreground">{t(lang, "raciSuggestTruncated")}</p>
          )}

          {cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "raciSuggestNoProposal")}</p>
          ) : (
            <ul className="space-y-2">
              {cells.map((c) => {
                const key = cellKey(c);
                const on = selected.has(key);
                const currentLabel = c.currentRole ? t(lang, ROLE_LABEL_KEY[c.currentRole]) : t(lang, "raciSuggestNone");
                const proposedLabel = t(lang, ROLE_LABEL_KEY[c.role]);
                return (
                  <li key={key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <Checkbox
                        checked={on}
                        disabled={busy}
                        onChange={() => onToggle(key)}
                        aria-label={`${t(lang, "raciSuggestInclude")} – ${c.stakeholderName} – ${c.milestoneName}`}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {c.stakeholderName}
                          <span className="text-muted-foreground"> · {c.milestoneName}</span>
                        </span>
                        <span className="mt-1 block text-sm text-foreground">
                          <span className="text-muted-foreground">{t(lang, "raciSuggestCurrent")}: </span>
                          {currentLabel}
                          {" → "}
                          <span className="text-muted-foreground">{t(lang, "raciSuggestProposed")}: </span>
                          {proposedLabel}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {skipped.length > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted-foreground">
              {t(lang, "raciSuggestSkipped", skipped.length)}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t(lang, "cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={!canConfirm}>
            {t(lang, "raciSuggestApply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
