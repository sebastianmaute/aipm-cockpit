"use client";

// Presentational preview/confirm modal for the AI work-breakdown optimizer.
// Pure props: the glue hook owns the propose -> ground -> apply state machine,
// the ticked keys and the handlers. This component calls no AI, reads no
// context and writes nothing. Mirrors alloc-plan-modal.tsx.
//
// Every proposed change is itemized with its before/after and can be unticked.
// An estimate or dependency on a task or piece that another item creates is
// disabled (not hidden) while that item is unticked, so the user sees why it
// cannot apply. Everything Apply writes is shown: a new task's assignee, and a
// plain-text excerpt of each description a new row gets.

import { useId } from "react";
import { type Lang, t, tPlural, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { htmlPlainProjection } from "./rich-text-plain";
import { sanitizeMultiline, sanitizeTaskName } from "./sanitize-core";
import type { Task } from "./types";
import { oneLine, type GroundedWbsItem, type RawWbsItem, type SkippedWbsItem, type WbsSkipReason, type WbsTarget } from "./wbs-plan/wbs-plan";

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
  emptyName: "wbsPlanSkip_emptyName",
  emptyGroup: "wbsPlanSkip_emptyGroup",
  emptyRef: "wbsPlanSkip_emptyRef",
  badDate: "wbsPlanSkip_badDate",
  badEstimate: "wbsPlanSkip_badEstimate",
  hasEstimate: "wbsPlanSkip_hasEstimate",
  duplicateRef: "wbsPlanSkip_duplicateRef",
  duplicateTarget: "wbsPlanSkip_duplicateTarget",
  sameGroup: "wbsPlanSkip_sameGroup",
  selfLink: "wbsPlanSkip_selfLink",
  duplicateLink: "wbsPlanSkip_duplicateLink",
  unresolvedRef: "wbsPlanSkip_unresolvedRef",
  ambiguousPiece: "wbsPlanSkip_ambiguousPiece",
  cycle: "wbsPlanSkip_cycle",
};

/** Characters of a description shown in the preview. */
const DESCRIPTION_EXCERPT_CHARS = 120;

/** A one-line plain-text excerpt of sanitized rich HTML (DOM-free projection). */
function descriptionExcerpt(html: string): string {
  const text = htmlPlainProjection(html).replace(/\s+/g, " ").trim();
  // `clipText` (via sanitizeMultiline) never splits an astral character.
  const clipped = sanitizeMultiline(text, DESCRIPTION_EXCERPT_CHARS);
  return clipped.length < text.length ? `${clipped}…` : clipped;
}

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

  const splitOf = (taskId: number): Extract<RawWbsItem, { kind: "split" }> | null => {
    for (const g of items) if (g.item.kind === "split" && g.item.taskId === taskId) return g.item;
    return null;
  };
  // A piece is named by its OWN proposed name, "<piece> (piece N of <original>)",
  // read from the split in this proposal. Without one (a skipped item citing a
  // split that was not kept) it falls back to "<original> — piece N".
  const pieceLabel = (taskId: number, piece: number): string => {
    const p = splitOf(taskId)?.pieces[piece - 1];
    return p
      ? t(lang, "wbsPlanPieceNamed", p.taskName, piece, taskName(taskId))
      : t(lang, "wbsPlanPieceLabel", taskName(taskId), piece);
  };

  // A ref resolves to the newTask that declares it, compared the way grounding
  // normalises refs (a refused item still carries the raw one). Piece 1 is
  // stored as the task itself, so a task this proposal splits is labelled as
  // its piece 1. On an `ambiguousPiece` item a piece ≥ 2 gets the unnamed
  // label: naming the kept split's piece would assert the binding the reason
  // says cannot be made.
  const targetLabel = (target: WbsTarget, ambiguous = false): string => {
    if (target.kind === "task") return splitOf(target.id) ? pieceLabel(target.id, 1) : taskName(target.id);
    if (target.kind === "piece") {
      return ambiguous && target.piece !== 1
        ? t(lang, "wbsPlanPieceLabel", taskName(target.taskId), target.piece)
        : pieceLabel(target.taskId, target.piece);
    }
    const ref = oneLine(target.ref);
    for (const g of items) {
      if (g.item.kind === "newTask" && g.item.ref === ref) return g.item.taskName;
    }
    return sanitizeTaskName(ref);
  };

  const subject = (item: RawWbsItem, reason?: WbsSkipReason): string => {
    const ambiguous = reason === "ambiguousPiece";
    switch (item.kind) {
      case "split":
      case "regroup":
        return taskName(item.taskId);
      case "newTask":
        // A refused item is the raw model output: an `emptyName` one would
        // otherwise render as a row with nothing before its reason.
        return sanitizeTaskName(item.taskName) || t(lang, "wbsPlanUnnamedNewTask");
      case "estimate":
        return targetLabel(item.target, ambiguous);
      case "link":
        return t(lang, "wbsPlanLinkRow", targetLabel(item.from, ambiguous), targetLabel(item.to, ambiguous));
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
      if (item.assignee) parts.push(t(lang, "wbsPlanAssignedTo", item.assignee));
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
  // Pieces 2+ are new rows: name, estimate and a description excerpt.
  type SplitPiece = Extract<RawWbsItem, { kind: "split" }>["pieces"][number];
  // "no estimate" reads better than "estimate none" for a piece without one.
  const pieceEstimate = (m: number | undefined): string =>
    m === undefined ? t(lang, "wbsPlanPieceNoEstimate") : t(lang, "wbsPlanPieceEstimate", minutes(m));
  const pieceText = (taskId: number, p: SplitPiece, isFirst: boolean): string => {
    if (!isFirst) {
      const parts = [p.taskName, pieceEstimate(p.estimateMinutes)];
      if (p.description !== undefined) parts.push(t(lang, "wbsPlanDescriptionExcerpt", descriptionExcerpt(p.description)));
      return parts.join(" · ");
    }
    const before = tasksById.get(taskId)?.originalEstimateMinutes;
    const after = p.estimateMinutes ?? before;
    const estimate =
      after === before
        ? pieceEstimate(before)
        : t(lang, "wbsPlanPieceEstimate", t(lang, "wbsPlanEstimateChange", minutes(before), minutes(after)));
    const parts = [t(lang, "wbsPlanPieceRename", taskName(taskId), p.taskName), estimate];
    if (p.description !== undefined) parts.push(t(lang, "wbsPlanReplacesDescription"));
    return parts.join(" · ");
  };

  const tokens = buildRowTokens(items.map((g) => ({ id: g.key, name: subject(g.item) })));
  const isDisabled = (g: GroundedWbsItem): boolean => g.requires.some((k) => !selected.has(k));
  const count = items.reduce((n, g) => (selected.has(g.key) && !isDisabled(g) ? n + 1 : n), 0);
  const canApply = !applying && count > 0;
  // The prefix of each row's detail ids (aria-describedby on its checkbox).
  const idBase = useId();
  // Every proposed item was refused: the preview still opens, so the reasons
  // are visible, with the "Not applied" list expanded.
  const allSkipped = items.length === 0 && skipped.length > 0;

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
          {allSkipped && <p className="mb-4 text-sm text-foreground">{t(lang, "wbsPlanAllSkipped")}</p>}

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
                    const newTaskDescription =
                      g.item.kind === "newTask" && g.item.description !== undefined ? g.item.description : null;
                    // Each part of the detail gets an id and describes the checkbox,
                    // whose NAME is the subject alone. Referenced part by part, not
                    // through one wrapper: the pieces list carries an aria-label,
                    // which would stand in for its items in a wrapper's text.
                    const partId = (part: string) => `${idBase}-${g.key}-${part}`;
                    const describedBy = [
                      info ? partId("info") : null,
                      newTaskDescription !== null ? partId("desc") : null,
                      ...(split ? split.pieces.map((_, i) => partId(`p${i}`)) : []),
                      g.item.why ? partId("why") : null,
                      disabled ? partId("off") : null,
                    ]
                      .filter((id): id is string => id !== null)
                      .join(" ");
                    return (
                      <li key={g.key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                        <label className="flex cursor-pointer items-start gap-2">
                          <Checkbox
                            checked={selected.has(g.key)}
                            disabled={applying || disabled}
                            onChange={() => onToggle(g.key)}
                            aria-label={rowLabel(t(lang, "wbsPlanInclude"), tokens.get(g.key) ?? g.key)}
                            aria-describedby={describedBy || undefined}
                            className="mt-0.5 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">{subject(g.item)}</span>
                            {info && <span id={partId("info")} className="block text-sm text-foreground">{info}</span>}
                            {newTaskDescription !== null && (
                              <span id={partId("desc")} className="block text-sm text-foreground">
                                {t(lang, "wbsPlanDescriptionExcerpt", descriptionExcerpt(newTaskDescription))}
                              </span>
                            )}
                            {split && (
                              <ul
                                className="mt-1 list-disc pl-5 text-sm text-foreground"
                                aria-label={t(lang, "wbsPlanPiecesLabel")}
                              >
                                {split.pieces.map((p, i) => (
                                  <li key={i} id={partId(`p${i}`)}>
                                    {pieceText(split.taskId, p, i === 0)}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {g.item.why && (
                              <span id={partId("why")} className="mt-1 block text-xs text-muted-foreground">
                                {g.item.why}
                              </span>
                            )}
                            {disabled && (
                              <span id={partId("off")} className="mt-1 block text-xs text-muted-foreground">
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
            <details className="border-t border-line pt-3" open={allSkipped}>
              <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">
                {t(lang, "wbsPlanSkippedTitle")} ({skipped.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {skipped.map((s, i) => (
                  <li key={`${i}:${s.reason}`} className="text-xs text-muted-foreground">
                    {subject(s.item, s.reason)} — {t(lang, SKIP_REASON_KEY[s.reason])}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-6 py-4">
          {/* Nothing can be applied, so dismissal is the only action and
              there is nothing to undo. The empty paragraph keeps Close right. */}
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{allSkipped ? null : t(lang, "wbsPlanUndoNote")}</p>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={applying}>
            {t(lang, allSkipped ? "close" : "wbsPlanCancel")}
          </Button>
          {!allSkipped && (
            <Button variant="primary" size="sm" onClick={onApply} disabled={!canApply}>
              {applying ? t(lang, "wbsPlanApplying") : tPlural(lang, "wbsPlanApply", count, count)}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
