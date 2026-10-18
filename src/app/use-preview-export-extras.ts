"use client";

// §502 part 4 — the export extras a document PREVIEW renders with. Spec §3.3: a lever search never runs on the render
// path. So where a download asks the synchronous source (`whatItTakesSync` per below-target milestone, up to about a
// second), a preview takes the decision with every take "pending" (`ForecastDecisionLive.base`) and fills the takes
// from its own `useLeverSearch`, one probe per macrotask; until a take settles its row reads "Working it out…".
// The search runs only while the previewed blocks hold a `forecastDecision` block; any other document gets the
// provider's extras unchanged and never asks for the section.

import { useMemo, useState } from "react";
import type { DocBlock } from "./document-model";
import type { ExportExtras } from "./export-forecast-section";
import { useExportExtras } from "./export-extras-context";
import { withTakes, type DecisionTake, type ForecastDecision, type ForecastDecisionLive } from "./forecast-decision";
import type { LeverTarget } from "./forecast-levers";
import { DEFAULT_TARGET_CONFIDENCE } from "./forecast-target";
import { leverKey, useLeverSearch } from "./use-lever-search";

const NO_TARGETS: readonly LeverTarget[] = [];

/** Whether `blocks` embed the forecast decision section. */
function hasForecastDecisionBlock(blocks: readonly DocBlock[]): boolean {
  return blocks.some((b) => b.type === "dataSection" && b.key === "forecastDecision");
}

/** Each below-target row as it reads: `id:settled` or `id:pending`. Row text changes only when this does. */
function takesSignature(base: ForecastDecision | null, takeOf: (id: number) => DecisionTake): string {
  return base === null || base.insufficient ? "" : base.below.map((m) => `${m.id}:${takeOf(m.id) === "pending" ? "pending" : "settled"}`).join("|");
}

type Held = { extras: ExportExtras; live: ForecastDecisionLive | undefined; wants: boolean; signature: string; value: ExportExtras };

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
  // ★ The search publishes a new map on EVERY probe, though most probes settle nothing. New extras then would re-render
  //   the whole document (`innerHTML`, and every asset image re-attached) once per probe, so the extras keep their
  //   identity until a below-target take settles (render-time reconcile: the last value is held in state).
  const base = wants ? live.base() : null;
  const takeOf = (id: number): DecisionTake => levers.get(leverKey({ kind: "milestone", id })) ?? "pending";
  const signature = takesSignature(base, takeOf);
  const [held, setHeld] = useState<Held | null>(null);
  if (held !== null && held.extras === extras && held.live === live && held.wants === wants && held.signature === signature) return held.value;
  const decision = base === null ? null : withTakes(base, takeOf);
  const value = wants ? { ...extras, forecastDecision: () => decision } : extras;
  setHeld({ extras, live, wants, signature, value });
  return value;
}
