"use client";
// src/app/task-raid-badge.tsx — RAID-reference badge shown on a task.
// Extracted from task-row.tsx so both the table row AND the Kanban card can
// render it without dragging the whole row module (RowContext/Td/TaskRowImpl)
// into the card bundle. Mirrors the TaskStatusSelect extraction.
import { memo } from "react";
import { t } from "./i18n";
import { countByCategory } from "./raid";
import { useTaskRowContext } from "./task-row";
import type { RaidItem } from "./types";

interface RaidBadgeProps {
  taskId: number;
  refs: RaidItem[];
}

function RaidBadgeImpl({ taskId, refs }: RaidBadgeProps) {
  const { lang, onJumpToRaid } = useTaskRowContext();
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
      className="ml-1 inline-flex items-center rounded bg-AIPM-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-AIPM-purple/90"
    >
      {t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D)}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
