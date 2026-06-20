// src/app/next-actions/index.ts
//
// Public entry for the suggested-next-actions engine. SP2 imports
// `computeNextActions` + the types from here.
import { computeNextActions as run } from "./engine";
import { taskDueProvider } from "./providers/task-due";
import { raidProvider } from "./providers/raid";
import { changePendingProvider } from "./providers/change-pending";
import { milestoneProvider } from "./providers/milestone";
import { budgetProvider } from "./providers/budget";
import { stakeholderCommsProvider } from "./providers/stakeholder-comms";
import { scheduleProvider } from "./providers/schedule";
import { workloadProvider } from "./providers/workload";
import { committeeInfoProvider } from "./providers/committee-info";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

/** The real provider set, in a deterministic order. */
export const ALL_PROVIDERS: readonly ActionProvider[] = [
  taskDueProvider,
  raidProvider,
  changePendingProvider,
  milestoneProvider,
  budgetProvider,
  stakeholderCommsProvider,
  scheduleProvider,
  workloadProvider,
  committeeInfoProvider,
];

/** Compute the ranked suggested actions from the app's current signals. */
export function computeNextActions(input: ActionInput): SuggestedAction[] {
  return run(input, ALL_PROVIDERS);
}

export type { SuggestedAction, ActionInput, ActionTier, ActionSource, ActionCta } from "./types";
