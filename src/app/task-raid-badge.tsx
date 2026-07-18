"use client";
// src/app/task-raid-badge.tsx — RAID-reference badge shown on a task.
// Extracted from task-row.tsx so both the table row AND the Kanban card can
// render it. Takes `lang`/`onJumpToRaid` as PROPS (not from RowContext) so it
// works outside the table's RowContextProvider — the Kanban board renders cards
// without that provider. Imports nothing from task-row (fully decoupled).
import { memo } from "react";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { countByCategory } from "./raid";
import type { RaidItem } from "./types";

interface RaidBadgeProps {
  taskId: number;
  refs: RaidItem[];
  lang: Lang;
  onJumpToRaid: (taskId: number) => void;
}

function RaidBadgeImpl({ taskId, refs, lang, onJumpToRaid }: RaidBadgeProps) {
  const counts = countByCategory(refs);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToRaid(taskId);
      }}
      title={t(lang, "raidReferencedBy", refs.length)}
      aria-label={t(lang, "raidReferencedBy", refs.length)}
      className={`ml-1 inline-flex items-center rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-ui-purple/90 ${INTERACTIVE}`}
    >
      {t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D)}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
