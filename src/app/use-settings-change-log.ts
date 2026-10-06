// src/app/use-settings-change-log.ts
//
// The debounced, coarse "settings.updated" activity row: one ACTOR-LESS entry
// per burst of settings changes, minus the changes the AI already logged under
// its own "ai" actor (§160). Extracted from task-manager.tsx (§491); move-only.
//
// ★ No memoization to keep or justify. The state lives in refs and effects,
// and the one returned handler, `onSettingsLoggedByAi`, was an inline arrow at
// the dispatcher's call site before the move — a fresh identity every render —
// so it stays non-memoized (Extraction convention 1).
//
// ★★★ It must be handed the RAW, actor-less `logActivity`, never
// `logActivityUser` (the ★★★ note below says why). No test here can see what
// the call site passes; task-manager.activity-actor.test.tsx pins it through
// the real component, filtering the §160 rows on `actor === undefined`.
"use client";
import { useEffect, useRef } from "react";
import type { ActivityKind } from "./activity-log";
import { createSettingsLogger, SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import type { Settings } from "./settings-types";

export interface SettingsChangeLogDeps {
  settings: Settings;
  hydrated: boolean;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export function useSettingsChangeLog(deps: SettingsChangeLogDeps) {
  const { settings, hydrated, logActivity } = deps;

  // Debounced coarse "settings.updated" entry. Guards: (1) pre-hydration — the effect skips every run while `hydrated` is false; (2) initial mount — the first post-hydration run reflects the LOADED value, so `settingsInitialRef` suppresses it; (3) secrets — the entry carries no field values.
  // ★★★ THE ONE PRODUCTION SITE DELIBERATELY LEFT ON THE ACTOR-LESS `logActivity` — do NOT "finish the sweep" by stamping it `"user"`. It is an EFFECT over settings STATE, not a handler behind a gesture, so it cannot see its cause. A `"user"` stamp would be a guess. Absent is honest — nothing here knows who acted. ★★ STILL TRUE AFTER §160: the credit counter below does not teach this effect a cause, it only tells it that a change was ALREADY reported by someone who knew. Every row it still writes is one nothing can attribute, which is why it stays actor-less.
  const settingsLoggerRef = useRef(
    createSettingsLogger(() => logActivity("settings.updated"), SETTINGS_LOG_DEBOUNCE_MS),
  );
  const settingsInitialRef = useRef(true);
  // ★★★ §160 — settings changes the AI already logged an `"ai"` row for, which this effect must not report twice. A counter, not the time-window suppression flag that entry rejected: a human change after an AI one gets its own run, finds 0, and is logged normally.
  // ★★★ THE EFFECT CLEARS THE COUNTER, IT DOES NOT DECREMENT IT, and that asymmetry is the whole correctness argument. Credits are issued PER TOOL CALL but consumed PER EFFECT RUN, and React batches every `setSettings` of one assistant turn into ONE render — so "switch to German and turn off view hints" issues 2 credits against 1 run. Decrementing left the surplus alive indefinitely, and it silently ate the next genuine USER row, whenever that came. Clearing bounds the suppression to the turn that caused it: a leak cannot outlive the render it was created in.
  // ★★ RESIDUAL 1 (safe), deliberately accepted: if two AI settings writes in one turn are separated by a real macrotask (an intervening tool doing I/O), React renders twice, the second run finds 0 and adds one actor-less row. An EXTRA honest row beats a MISSING user row — never trade this back. Reasoning: open-followups §160.
  // ★★ RESIDUAL 2 (UNSAFE), and this comment used to claim to enumerate the residuals while listing only the harmless one: if a USER settings change and an AI write land in the SAME React batch, the single effect run consumes the credit and the USER's row is the one lost. That is §160's own failure mode, surviving at a much lower probability — the user would have to change a setting inside the same batch as an AI write, which needs a real concurrent interaction rather than an ordinary sequence. Not fixed because distinguishing the two writers inside one batch needs identity comparison, and both AI writers use functional setters (`setSettings(prev => …)`), so nothing the effect sees is reference-equal to what the dispatcher computed. Do not "close" it by switching those writers to direct-value setters: that walks into the documented "N saves in one tick" landmine.
  const aiSettingsCreditsRef = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    if (settingsInitialRef.current) {
      settingsInitialRef.current = false;
      return;
    }
    if (aiSettingsCreditsRef.current > 0) { aiSettingsCreditsRef.current = 0; return; }
    settingsLoggerRef.current.notifyChange();
  }, [settings, hydrated]);

  // ★★ Cancel only on UNMOUNT, never per run. A per-run cleanup fires BEFORE the
  // next effect body, so an AI write landing within the debounce window cancelled
  // the pending row and then early-returned without re-arming — the USER's change
  // vanished entirely. Behaviour-neutral on the normal path, since `notifyChange`
  // already restarts the timer itself.
  useEffect(() => {
    const logger = settingsLoggerRef.current;
    return () => logger.cancel();
  }, []);

  /** Credits one settings change the dispatcher already logged under the "ai" actor (§160). */
  const onSettingsLoggedByAi = () => { aiSettingsCreditsRef.current += 1; };

  return { onSettingsLoggedByAi };
}
