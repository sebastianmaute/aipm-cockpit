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
  // The badge's VISIBLE content — the compact per-category glyph string. It is
  // also the head of the accessible name below, so the two cannot drift.
  const mix = t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D);
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
      // ★★★ WCAG 2.5.3 (label in name): the accessible name must CONTAIN the
      // control's visible text. The visible text is the glyph string `mix`,
      // so the name LEADS with it, then the spelled-out count, then the row
      // token that closes 2.4.6. Nesting `rowLabel` twice reuses the existing
      // separator and the two existing i18n keys — no new key, no untranslated
      // literal.
      // ★★ CONTAINMENT, NOT PREFIX — 2.5.3 is case-insensitive and
      // position-independent; front position here is the Understanding note's
      // best practice, not the criterion. Do not "enforce" prefixing elsewhere
      // on the strength of this line.
      // ★★ No gate can see a regression here: axe's `label-content-name-mismatch`
      // carries `wcag21a` but is also `experimental`, which axe's default
      // tagExclude drops, so the a11y gate never runs it. `task-raid-badge.test.tsx`
      // is the only detector.
      aria-label={rowLabel(rowLabel(mix, t(lang, "raidReferencedBy", refs.length)), rowToken)}
      className={`ml-1 inline-flex items-center rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-ui-purple/90 ${INTERACTIVE}`}
    >
      {mix}
    </button>
  );
}

export const RaidBadge = memo(RaidBadgeImpl);
