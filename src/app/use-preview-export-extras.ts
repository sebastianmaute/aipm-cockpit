"use client";

// §502 part 4 — the export extras a document PREVIEW renders with. Spec §3.3: a lever search never runs on the render
// path. So where a download asks the synchronous source (`whatItTakesSync` per below-target milestone, up to about a
// second), a preview takes the decision with every take "pending" (`ForecastDecisionLive.base`) and fills the takes
// from its own `useLeverSearch`, one probe per macrotask; until a take settles its row reads "Working it out…".
// The search runs only while the previewed blocks hold a `forecastDecision` block; any other document gets the
// provider's extras unchanged and never asks for the section.

import { useMemo } from "react";
import type { DocBlock } from "./document-model";
import type { ExportExtras } from "./export-forecast-section";
import { useExportExtras } from "./export-extras-context";
import { withTakes } from "./forecast-decision";
import type { LeverTarget } from "./forecast-levers";
import { DEFAULT_TARGET_CONFIDENCE } from "./forecast-target";
import { leverKey, useLeverSearch } from "./use-lever-search";

const NO_TARGETS: readonly LeverTarget[] = [];

/** Whether `blocks` embed the forecast decision section. */
export function hasForecastDecisionBlock(blocks: readonly DocBlock[]): boolean {
  return blocks.some((b) => b.type === "dataSection" && b.key === "forecastDecision");
}

/** `blocks`: what the preview renders; pass none while nothing is shown (a closed history row), so nothing searches. */
export function usePreviewExportExtras(blocks: readonly DocBlock[] | null): ExportExtras {
  const extras = useExportExtras();
  const live = extras.forecastDecisionLive;
  const wants = live !== undefined && blocks !== null && hasForecastDecisionBlock(blocks);
  // Built once per live handle (the provider's memo); the same identity every render, so the search keys on it.
  const input = wants ? live.input() : null;
  const targets = useMemo<readonly LeverTarget[]>(
    () => (input === null ? NO_TARGETS : input.milestones.map((m): LeverTarget => ({ kind: "milestone", id: m.id }))),
    [input],
  );
  const levers = useLeverSearch({ input, targets, goal: live?.goal ?? DEFAULT_TARGET_CONFIDENCE, enabled: wants });
  return useMemo(() => {
    if (!wants || live === undefined) return extras;
    const base = live.base();
    const decision = base === null ? null : withTakes(base, (id) => levers.get(leverKey({ kind: "milestone", id })) ?? "pending");
    return { ...extras, forecastDecision: () => decision };
  }, [wants, live, levers, extras]);
}
