"use client";
// src/app/timelog-not-configured.tsx
// Empty state for the Time bookings view while the Timelog integration is
// switched off — the not-configured line, a Settings deep-link button, and the
// escape hatch below.
//
// ★ Its own module because `timelog-panel.tsx` sits three lines under the
//   800-line size ratchet; this is ~20 lines and cannot go inline there.
//
// ★★★ THE CLEAR-ALL BRANCH IS AN ESCAPE HATCH, NOT DECORATION.
//     `canClearAllFetched` (timelog-guards.ts) deliberately omits
//     `isMisconfigured`, and its docblock says why: the fetched cache is local
//     data the user already HAS, and a Timelog they cannot reach is exactly the
//     state in which someone wants to clear stale bookings. Hiding the page
//     without carrying Clear-all forward would strand them with data they can
//     neither refresh nor remove — the precise trap that omission prevents.
//     Every OTHER Timelog action reaches the network and is correctly gone.
import type { RefObject } from "react";
import { t, type Lang } from "./i18n";
import { Button } from "./button";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";

export function TimelogNotConfigured({
  lang,
  paneRef,
  onConfigure,
  hasFetched,
  canClearAll,
  onClearAll,
}: {
  lang: Lang;
  /** `useResizable`'s ref. The empty state carries the SAME pane wrapper the
   *  full page uses, so switching the integration off does not change how the
   *  view sizes itself. Optional so the component can be unit-tested alone. */
  paneRef?: RefObject<HTMLDivElement | null>;
  /** Settings → Integrations deep-link. Absent in a popout, which has no
   *  Settings to navigate to — mirrors `chat-panel.tsx`'s `onConfigureAi`,
   *  where a button with nowhere to go is simply not rendered. */
  onConfigure?: () => void;
  /** A cached fetch exists, so there is something to clear — and something to
   *  EXPLAIN. Gates the block; whether the button works is `canClearAll`. */
  hasFetched: boolean;
  /**
   * `canClearAllFetched(...)` as the panel evaluates it, threaded in rather than
   * re-derived here.
   *
   * ★★★ IT IS FALSE IN A POPOUT, and this prop exists because the button was
   * rendered without it: the block is gated on `hasFetched`, which is seeded
   * from the CACHE, so a popout over a project with cached bookings drew a
   * fully live-looking Clear-all whose click the handler's own guard silently
   * swallowed. Disabled (not hidden) mirrors the full page's toolbar, which
   * evaluates this same predicate for the same button.
   */
  canClearAll: boolean;
  onClearAll: () => void;
}) {
  return (
    <div ref={paneRef} className={`print-root space-y-3 ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <p className="text-sm text-muted-foreground">{t(lang, "timelogNotConfigured")}</p>
      {onConfigure && <Button onClick={onConfigure}>{t(lang, "timelogConfigure")}</Button>}
      {hasFetched && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-muted-foreground">{t(lang, "timelogCachedWhileOff")}</p>
          <Button variant="secondary" disabled={!canClearAll} onClick={onClearAll}>{t(lang, "clearAll")}</Button>
        </div>
      )}
    </div>
  );
}
