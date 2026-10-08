"use client";
// src/app/use-capped-groups.ts — the "Show more" cap the Kanban board and the
// swimlane view share (§5). Each group (a board column, a swimlane cell) renders
// at most KANBAN_COLUMN_PAGE cards, then a button that adds a page; printing
// renders every card; a deep link raises its group's limit in the same render;
// the first card a click reveals takes focus. Limits live as long as the
// component does: a remount starts every group at one page again.
//
// Design: docs/superpowers/specs/2026-10-08-kanban-column-cap-design.md. Moved
// here from task-kanban-board.tsx when the swimlane view took the same cap.
import { useEffect, useRef, useState } from "react";
import { usePrinting } from "./use-printing";
import { KANBAN_COLUMN_PAGE } from "./kanban-column-page";

export interface CappedGroups {
  /** How many of the group's cards to render: Infinity while printing. */
  limitOf: (key: string) => number;
  /** How many of the group's cards the cap hides (0 while printing). */
  hiddenOf: (key: string) => number;
  /** Add a page to the group. `container` holds the group's cards; the first one
   *  this reveals takes focus once it renders. */
  showMore: (key: string, container: Element | null) => void;
}

/**
 * @param groups every group's cards in render order, by group key.
 * @param flashId the deep-linked card id, or null.
 * @param cardSelector matches one group's card elements inside `container`.
 */
export function useCappedGroups(
  groups: ReadonlyMap<string, readonly { id: number }[]>,
  flashId: number | null,
  cardSelector: string,
): CappedGroups {
  // A missing entry means one page.
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  // ★ A deep link to a card past its group's cap. useDeepLinkRowFlash sets `flashId`
  //   during render and queries [data-deeplink-row] only on the NEXT animation frame, so
  //   the card must be in the DOM from this render: a render-time reconcile raises the
  //   group's limit here (React re-runs this render with it before committing). Not the
  //   hook's `scrollToId` callback: that runs from an effect, a commit too late, and an
  //   effect may not set state (set-state-in-effect is fatal). Seeded with a sentinel,
  //   not the live prop, so a fresh mount honours a pending flash (remount-swallow rule).
  const [seenFlash, setSeenFlash] = useState<number | null | undefined>(undefined);
  if (flashId !== seenFlash) {
    setSeenFlash(flashId);
    if (flashId != null) {
      for (const [key, cards] of groups) {
        const index = cards.findIndex((c) => c.id === flashId);
        if (index < 0) continue;
        // Only ever raise: a group the user already opened past the card stays open.
        if (index >= (limits[key] ?? KANBAN_COLUMN_PAGE)) {
          setLimits((prev) => ({
            ...prev,
            [key]: Math.max(prev[key] ?? KANBAN_COLUMN_PAGE, Math.ceil((index + 1) / KANBAN_COLUMN_PAGE) * KANBAN_COLUMN_PAGE),
          }));
        }
        break;
      }
    }
  }
  // ★ Focus after "Show more": the first card the click revealed takes focus. Without it a
  //   keyboard user lands on <body> when the last page removes the button, and below the
  //   new cards otherwise. The click records the container and the index here; the effect
  //   below focuses the card once it is in the DOM. A ref and a DOM call, no state.
  const reveal = useRef<{ container: Element; index: number } | null>(null);
  useEffect(() => {
    const target = reveal.current;
    if (!target) return;
    reveal.current = null;
    const card = target.container.querySelectorAll(cardSelector)[target.index];
    card?.querySelector<HTMLElement>("button, select, [tabindex]")?.focus();
  });
  // A printout must hold every card.
  const printing = usePrinting();
  const limitOf = (key: string): number => (printing ? Infinity : (limits[key] ?? KANBAN_COLUMN_PAGE));
  const hiddenOf = (key: string): number => {
    const total = groups.get(key)?.length ?? 0;
    return total - Math.min(total, limitOf(key));
  };
  const showMore = (key: string, container: Element | null): void => {
    const total = groups.get(key)?.length ?? 0;
    if (container) reveal.current = { container, index: Math.min(total, limitOf(key)) };
    setLimits((prev) => ({ ...prev, [key]: (prev[key] ?? KANBAN_COLUMN_PAGE) + KANBAN_COLUMN_PAGE }));
  };
  return { limitOf, hiddenOf, showMore };
}
