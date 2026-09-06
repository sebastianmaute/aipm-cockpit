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
   * ★★ REQUIRED, NOT OPTIONAL. Everything the name carries ahead of this token
   * is derived from the REFERENCE COUNT alone (`raidReferencedByCount` and
   * `raidReferencedBy`), so it holds no row identity — without this token any
   * two rows whose counts match render two identically-named buttons (WCAG
   * 2.4.6). That does NOT need two tasks to share a name: "Alpha" and "Beta"
   * each linked to two RAID items is enough, and equal counts are the common
   * case. A required prop turns a missed caller into a tsc error rather than a
   * silent collision.
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
  // The badge's VISIBLE content — the short total. It is also the HEAD of the
  // accessible name below, so the two cannot drift.
  const countText = t(lang, "raidReferencedByCount", refs.length);
  // The per-category breakdown. Sighted shorthand, so it rides `title`, where
  // it FOLLOWS the name rather than fronting it — `title` is the accessible
  // description, so this changes WHEN it is read, not WHETHER.
  const mix = t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToRaid(taskId);
      }}
      // ★ `title` carries the per-category BREAKDOWN: `aria-label` wins the
      // NAME, so this is the accessible DESCRIPTION plus the hover tooltip —
      // the only place a sighted mouse user can still get the R/A/I/D split now
      // that the visible text is a total. Do not put the row identity here; it
      // would only lengthen a tooltip shown on the row already under the pointer.
      // ★★ DISCLOSED TRADE, deliberately kept: the R/A/I/D split moved from
      // always-visible text to `title`, so for SIGHTED users it is now reachable
      // by MOUSE HOVER ALONE — a keyboard or touch user gets the count and the
      // sentence but never the split. Screen-reader users are unaffected, since
      // `title` is the accessible description and is announced.
      title={mix}
      // ★★★ WCAG 2.5.3 (label in name): the accessible name must CONTAIN the
      // control's visible text. The visible text is `countText`, so the name
      // LEADS with it, then the spelled-out count, then the row token that
      // closes 2.4.6. Nesting `rowLabel` twice reuses the existing separator.
      // ★★ CONTAINMENT, NOT PREFIX — 2.5.3 is case-insensitive and
      // position-independent; front position here is the Understanding note's
      // best practice, not the criterion. Do not "enforce" prefixing elsewhere
      // on the strength of this line.
      // ★★ No gate can see a regression here: axe's `label-content-name-mismatch`
      // carries `wcag21a` but is also `experimental`, which axe's default
      // tagExclude drops, so the a11y gate never runs it. `task-raid-badge.test.tsx`
      // is the only detector of the CONTAINMENT property specifically. The exact
      // name, leading count included, is ALSO pinned in `task-row.test.tsx` and
      // `task-kanban-card.test.tsx`, so an ORDER mutant reddens three files.
      aria-label={rowLabel(rowLabel(countText, t(lang, "raidReferencedBy", refs.length)), rowToken)}
      className={`ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-ui-purple/90 ${INTERACTIVE}`}
    >
      {countText}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
