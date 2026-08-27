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
import { rowLabel } from "./row-tokens";
import type { RaidItem } from "./types";

interface RaidBadgeProps {
  taskId: number;
  refs: RaidItem[];
  lang: Lang;
  /**
   * ★★ REQUIRED, NOT OPTIONAL. The badge's name used to be the bare count
   * (`raidReferencedBy` = "Referenced by {0} RAID item(s)"), which carries NO
   * row identity — so any two rows whose REFERENCE COUNTS match rendered two
   * identically-named buttons (WCAG 2.4.6). That does NOT need two tasks to
   * share a name: "Alpha" and "Beta" each linked to two RAID items is enough,
   * and equal counts are the common case. A required prop turns a missed
   * caller into a tsc error rather than a silent collision.
   *
   * ★ Built by the LIST owner (`buildRowTokens`, `src/app/row-tokens.ts`) — a
   * per-item component has no sibling visibility and cannot disambiguate
   * itself. Both call sites (`task-row.tsx`, `task-kanban-card.tsx`) already
   * hold it and hand the same value to the sibling `DocumentBadge`.
   */
  rowToken: string;
  onJumpToRaid: (taskId: number) => void;
}

function RaidBadgeImpl({ taskId, refs, lang, rowToken, onJumpToRaid }: RaidBadgeProps) {
  const counts = countByCategory(refs);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToRaid(taskId);
      }}
      // ★ `title` stays the bare count: it is the hover tooltip (and, since
      // `aria-label` wins the NAME, the accessible DESCRIPTION), not a name,
      // so 2.4.6 does not reach it and repeating the row identity there would
      // only lengthen a tooltip shown on the row the user is already pointing at.
      // ★ ACCEPTED COST: the two were byte-identical before the row token landed,
      // so AT that suppresses a description equal to the name announced it once
      // and now announces the bare count separately as a redundant prefix of the
      // name. Kept because the visible content is a compact glyph string, so the
      // tooltip is the only count a sighted mouse user gets.
      title={t(lang, "raidReferencedBy", refs.length)}
      aria-label={rowLabel(t(lang, "raidReferencedBy", refs.length), rowToken)}
      className={`ml-1 inline-flex items-center rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-ui-purple/90 ${INTERACTIVE}`}
    >
      {t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D)}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
