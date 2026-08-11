"use client";

// Presentational preview/confirm modal for the "Deduplicate & unify tasks"
// feature. The caller (the tasks-pane glue hook) computes the grounded merge
// groups and owns the selection + confirm/cancel handlers. This component owns
// NO state and reaches into NO context — it just renders the groups so the user
// can review each proposed merge before anything is applied. Nothing here
// mutates the workspace; Confirm calls back to the caller.

import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { type GroundedMergeGroup } from "./task-dedup/dedup";
import { descriptionText } from "./rich-text-projection";

interface TaskDedupModalProps {
  lang: Lang;
  open: boolean;
  groups: readonly GroundedMergeGroup[];
  /** keepIds of the groups the user has selected to merge. */
  selected: ReadonlySet<number>;
  onToggle: (keepId: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the merge is being applied (disables the controls). */
  busy: boolean;
}

export function TaskDedupModal({
  lang,
  open,
  groups,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  busy,
}: TaskDedupModalProps) {
  const title = t(lang, "taskDedupTitle");
  const selectedCount = groups.reduce((n, g) => (selected.has(g.keepId) ? n + 1 : n), 0);

  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "taskDedupIntro")}</p>
        </div>

        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {groups.map((g) => {
            const on = selected.has(g.keepId);
            return (
              <li key={g.keepId} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => onToggle(g.keepId)}
                    aria-label={`${t(lang, "taskDedupInclude")} – ${g.keepTitle}`}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-ui-dark-blue focus:ring-ui-green"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      <span className="text-muted-foreground">{t(lang, "taskDedupKeep")}: </span>
                      {g.unified.taskName ?? g.keepTitle}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t(lang, "taskDedupMergeInto")}: {g.merged.map((m) => m.title).join(", ")}
                    </span>
                    {g.rationale && (
                      <span className="mt-1 block text-xs italic text-muted-foreground">{g.rationale}</span>
                    )}
                    {g.unified.taskName && (
                      <span className="mt-1 block text-xs text-foreground">
                        {t(lang, "taskDedupUnifiedTitle")}: {g.unified.taskName}
                      </span>
                    )}
                    {g.unified.description && (
                      <span className="mt-1 block whitespace-pre-wrap text-xs text-foreground">
                        {/* ★★ PROJECT it. dedup.ts sets unified.description to
                            sanitizeRichHtml(...) — HTML — so rendering it raw
                            showed the user literal "<p>...</p>" markup in the
                            preview they confirm a DESTRUCTIVE fold from. This is
                            the sixth member of the Task.description consumer
                            family; the other five moved onto a projection in
                            0.210.0 and this one reads the same field. */}
                        {t(lang, "taskDedupUnifiedNotes")}: {descriptionText(g.unified.description)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t(lang, "taskDedupCancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={busy || selectedCount === 0}
          >
            {t(lang, "taskDedupConfirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
