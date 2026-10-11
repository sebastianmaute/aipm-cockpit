"use client";

// Presentational preview/confirm modal for the AI work-breakdown optimizer.
// Pure props: the glue hook owns the propose -> ground -> apply state machine,
// the ticked keys and the handlers. This component calls no AI, reads no
// context and writes nothing. Mirrors alloc-plan-modal.tsx.
//
// Every proposed change is itemized with its before/after and can be unticked.
// A dependency whose endpoint is a task created or split by another item is
// disabled (not hidden) while that item is unticked, so the user sees why it
// cannot apply.

import { type Lang, t, tPlural, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";
import type { Task } from "./types";
import type { GroundedWbsItem, RawWbsItem, SkippedWbsItem, WbsSkipReason, WbsTarget } from "./wbs-plan/wbs-plan";

export interface WbsPlanModalProps {
  lang: Lang;
  tasksById: ReadonlyMap<number, Task>;
  items: readonly GroundedWbsItem[];
  skipped: readonly SkippedWbsItem[];
  /** True when the proposal was too large and some items were not shown at all. */
  truncated: boolean;
  /** Keys of the ticked items. */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}

const SECTIONS: readonly { kind: RawWbsItem["kind"]; titleKey: TranslationKey }[] = [
  { kind: "split", titleKey: "wbsPlanSectionSplits" },
  { kind: "regroup", titleKey: "wbsPlanSectionRegroups" },
  { kind: "newTask", titleKey: "wbsPlanSectionNewTasks" },
  { kind: "estimate", titleKey: "wbsPlanSectionEstimates" },
  { kind: "link", titleKey: "wbsPlanSectionLinks" },
];

// Exhaustive so a future WbsSkipReason is a compile error here, not a blank row.
const SKIP_REASON_KEY: Record<WbsSkipReason, TranslationKey> = {
  unknownTask: "wbsPlanSkip_unknownTask",
  closedTask: "wbsPlanSkip_closedTask",
  jiraTask: "wbsPlanSkip_jiraTask",
  outOfScope: "wbsPlanSkip_outOfScope",
  badPieces: "wbsPlanSkip_badPieces",
  overCap: "wbsPlanSkip_overCap",
  emptyName: "wbsPlanSkip_emptyName",
  badDate: "wbsPlanSkip_badDate",
  badEstimate: "wbsPlanSkip_badEstimate",
  hasEstimate: "wbsPlanSkip_hasEstimate",
  duplicateRef: "wbsPlanSkip_duplicateRef",
  selfLink: "wbsPlanSkip_selfLink",
  duplicateLink: "wbsPlanSkip_duplicateLink",
  unresolvedRef: "wbsPlanSkip_unresolvedRef",
  cycle: "wbsPlanSkip_cycle",
  staleTask: "wbsPlanSkip_staleTask",
};

export function WbsPlanModal({
  lang,
  tasksById,
  items,
  skipped,
  truncated,
  selected,
  onToggle,
  onApply,
  onCancel,
  applying,
}: WbsPlanModalProps) {
  const title = t(lang, "wbsPlanTitle");

  const taskName = (id: number): string => tasksById.get(id)?.taskName ?? t(lang, "wbsPlanUnknownTask", id);

  // A ref resolves to the newTask that declares it; a piece to "<original> — piece N".
  const targetLabel = (target: WbsTarget): string => {
    if (target.kind === "task") return taskName(target.id);
    if (target.kind === "piece") return t(lang, "wbsPlanPieceLabel", taskName(target.taskId), target.piece);
    for (const g of items) {
      if (g.item.kind === "newTask" && g.item.ref === target.ref) return g.item.taskName;
    }
    return target.ref;
  };

  const subject = (item: RawWbsItem): string => {
    switch (item.kind) {
      case "split":
      case "regroup":
        return taskName(item.taskId);
      case "newTask":
        return item.taskName;
      case "estimate":
        return targetLabel(item.target);
      case "link":
        return t(lang, "wbsPlanLinkRow", targetLabel(item.from), targetLabel(item.to));
    }
  };

  const minutes = (n: number | undefined): string =>
    n === undefined ? t(lang, "wbsPlanNoEstimate") : t(lang, "wbsPlanMinutes", n);

  const detail = (item: RawWbsItem): string | null => {
    if (item.kind === "regroup") {
      const before = tasksById.get(item.taskId)?.group || t(lang, "wbsPlanNoGroup");
      return t(lang, "wbsPlanGroupChange", before, item.group || t(lang, "wbsPlanNoGroup"));
    }
    if (item.kind === "newTask") {
      const parts = [t(lang, "wbsPlanDue", item.dueDate)];
      if (item.group) parts.push(item.group);
      if (item.estimateMinutes !== undefined) parts.push(minutes(item.estimateMinutes));
      return parts.join(" · ");
    }
    if (item.kind === "estimate") {
      const before = item.target.kind === "task" ? tasksById.get(item.target.id)?.originalEstimateMinutes : undefined;
      return t(lang, "wbsPlanEstimateChange", minutes(before), minutes(item.estimateMinutes));
    }
    return null;
  };

  // Piece 1 REWRITES the original row, so it shows what it replaces: the old
  // name → the new one, the original's estimate → piece 1's when it changes,
  // and a marker when it carries a description (which replaces the original's).
  // Pieces 2+ are new rows: name and estimate.
  type SplitPiece = Extract<RawWbsItem, { kind: "split" }>["pieces"][number];
  const pieceText = (taskId: number, p: SplitPiece, isFirst: boolean): string => {
    if (!isFirst) return [p.taskName, t(lang, "wbsPlanPieceEstimate", minutes(p.estimateMinutes))].join(" · ");
    const before = tasksById.get(taskId)?.originalEstimateMinutes;
    const after = p.estimateMinutes ?? before;
    const estimate =
      after === before ? minutes(before) : t(lang, "wbsPlanEstimateChange", minutes(before), minutes(after));
    const parts = [t(lang, "wbsPlanPieceRename", taskName(taskId), p.taskName), t(lang, "wbsPlanPieceEstimate", estimate)];
    if (p.description !== undefined) parts.push(t(lang, "wbsPlanReplacesDescription"));
    return parts.join(" · ");
  };

  const tokens = buildRowTokens(items.map((g) => ({ id: g.key, name: subject(g.item) })));
  const isDisabled = (g: GroundedWbsItem): boolean => g.requires.some((k) => !selected.has(k));
  const count = items.reduce((n, g) => (selected.has(g.key) && !isDisabled(g) ? n + 1 : n), 0);
  const canApply = !applying && count > 0;

  return (
    <Modal open onClose={applying ? () => {} : onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[680px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {truncated && <p className="mb-4 text-xs text-muted-foreground">{t(lang, "wbsPlanTruncated")}</p>}

          {SECTIONS.map(({ kind, titleKey }) => {
            const group = items.filter((g) => g.item.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t(lang, titleKey)}</h3>
                <ul className="space-y-2">
                  {group.map((g) => {
                    const disabled = isDisabled(g);
                    const info = detail(g.item);
                    const split = g.item.kind === "split" ? g.item : null;
                    return (
                      <li key={g.key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                        <label className="flex cursor-pointer items-start gap-2">
                          <Checkbox
                            checked={selected.has(g.key)}
                            disabled={applying || disabled}
                            onChange={() => onToggle(g.key)}
                            aria-label={rowLabel(t(lang, "wbsPlanInclude"), tokens.get(g.key) ?? g.key)}
                            className="mt-0.5 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">{subject(g.item)}</span>
                            {info && <span className="block text-sm text-foreground">{info}</span>}
                            {split && (
                              <ul
                                className="mt-1 list-disc pl-5 text-sm text-foreground"
                                aria-label={t(lang, "wbsPlanPiecesLabel")}
                              >
                                {split.pieces.map((p, i) => (
                                  <li key={i}>{pieceText(split.taskId, p, i === 0)}</li>
                                ))}
                              </ul>
                            )}
                            {g.item.why && (
                              <span className="mt-1 block text-xs text-muted-foreground">{g.item.why}</span>
                            )}
                            {disabled && (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {t(lang, "wbsPlanLinkNeedsEndpoint")}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {skipped.length > 0 && (
            <details className="border-t border-line pt-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">
                {t(lang, "wbsPlanSkippedTitle")} ({skipped.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {skipped.map((s, i) => (
                  <li key={`${i}:${s.reason}`} className="text-xs text-muted-foreground">
                    {subject(s.item)} — {t(lang, SKIP_REASON_KEY[s.reason])}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-6 py-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t(lang, "wbsPlanUndoNote")}</p>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={applying}>
            {t(lang, "wbsPlanCancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onApply} disabled={!canApply}>
            {applying ? t(lang, "wbsPlanApplying") : tPlural(lang, "wbsPlanApply", count, count)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
