"use client";
// Two-way calendar sync SP5: while the app is open this runner fires each entity's
// BACKGROUND `pull` (task/raid/change/absence) on mount, on tab re-focus, and every
// 15 minutes. Each pull self-gates on its own `.auto` enablement and early-returns
// when disabled/popout, so this runner only owns the CADENCE. It owns NO React state
// — args are mirrored behind refs so the tick callback stays stable and the
// interval/visibility listener subscribe exactly once (also keeps us clear of the
// banned react-hooks/set-state-in-effect rule — no render state here).
import { useEffect, useRef } from "react";

const AUTO_PULL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface CalendarAutoPullArgs {
  /** Mount gate: m365Configured && !isPopout. */
  enabled: boolean;
  /** Per-entity background pulls; each is a no-op when its own `.auto` is off. */
  pulls: readonly (() => Promise<void>)[];
}

export function useCalendarAutoPull({ enabled, pulls }: CalendarAutoPullArgs): void {
  // Mirror args into refs so the tick callback can stay stable (no deps that
  // change each render) and the listener/interval subscribe exactly once.
  const enabledRef = useRef(enabled);
  const pullsRef = useRef(pulls);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { pullsRef.current = pulls; }, [pulls]);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (!enabledRef.current) return;
      if (isRunningRef.current) return; // a run is already in flight
      isRunningRef.current = true;
      try {
        // Serial: a slow reconcile on one entity must not overlap the next.
        for (const p of pullsRef.current) {
          try {
            await p();
          } catch (e) {
            console.warn("calendar auto-pull failed", e);
          }
        }
      } finally {
        isRunningRef.current = false;
      }
    };

    // Fire on mount.
    void tick();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = setInterval(() => { void tick(); }, AUTO_PULL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
    };
  }, []);
}
