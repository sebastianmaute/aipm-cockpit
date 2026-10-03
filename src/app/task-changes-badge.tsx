"use client";
// src/app/task-changes-badge.tsx — the "N changes" badge shown on a task.
// Twin of `task-raid-badge.tsx`: rendered by BOTH the table row and the Kanban
// card, so `lang` and `onJumpToChanges` arrive as PROPS (the board renders
// outside the table's RowContextProvider — a context read would throw there).
// The click arms the Changes view's task filter (open-followups §481).
import { memo } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { rowLabel } from "./row-tokens";

interface ChangesBadgeProps {
  taskId: number;
  /** Number of change requests linked to the task; the caller renders nothing at 0. */
  count: number;
  lang: Lang;
  /**
   * ★★ REQUIRED. The visible text is derived from the COUNT alone, so two rows
   * with equal counts would otherwise render two identically-named buttons
   * (WCAG 2.4.6). Built by the list owner (`buildRowTokens`), as for `RaidBadge`.
   */
  rowToken: string;
  onJumpToChanges: (taskId: number) => void;
}

function ChangesBadgeImpl({ taskId, count, lang, rowToken, onJumpToChanges }: ChangesBadgeProps) {
  // The visible text is also the HEAD of the accessible name, so WCAG 2.5.3
  // (name contains the visible label) holds by construction. The `*One`
  // singular is picked by `tPlural`, never a ternary: German re-words noun,
  // adjective and verb together (open-followups §407).
  const countText = tPlural(lang, "taskRowChangesBadge", count, count);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToChanges(taskId);
      }}
      title={t(lang, "taskRowChangesBadgeJump")}
      aria-label={rowLabel(countText, rowToken)}
      className={`ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue hover:bg-ui-blue/25 dark:bg-ui-blue/20 dark:text-ui-light-grey dark:hover:bg-ui-blue/30 ${INTERACTIVE}`}
    >
      {countText}
    </button>
  );
}

export const ChangesBadge = memo(ChangesBadgeImpl);
