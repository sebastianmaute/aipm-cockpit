"use client";
import { useCallback } from "react";
import type React from "react";

// APG-compliant keyboard roving for a `role="tablist"` strip. Attach the
// returned handler as `onKeyDown` on the tablist container; it drives WHICHEVER
// container fired the event (via `e.currentTarget`), so one hook instance can
// serve several tablists (e.g. the workspace primary + sub strips).
//
// Left/Right (and Up/Down) move focus to the previous/next tab and wrap; Home /
// End jump to the first / last. Activation is AUTOMATIC — the focused tab is
// clicked, so selection follows focus (matches the app's existing help-view
// tabs). This keeps the roving `tabIndex` declarative for callers: mark the
// active tab `tabIndex={0}` and the rest `-1`, and it stays correct because
// arrowing immediately makes the focused tab the active one.
const PREV = new Set(["ArrowLeft", "ArrowUp"]);
const NEXT = new Set(["ArrowRight", "ArrowDown"]);

export function useTablistRoving() {
  return useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const isPrev = PREV.has(e.key);
    const isNext = NEXT.has(e.key);
    const isHome = e.key === "Home";
    const isEnd = e.key === "End";
    if (!isPrev && !isNext && !isHome && !isEnd) return;

    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return; // focus isn't on a tab (e.g. a popout button)

    e.preventDefault();
    const last = tabs.length - 1;
    const next = isHome
      ? 0
      : isEnd
        ? last
        : isNext
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    const target = tabs[next];
    target.focus();
    target.click(); // automatic activation — selection follows focus
  }, []);
}
