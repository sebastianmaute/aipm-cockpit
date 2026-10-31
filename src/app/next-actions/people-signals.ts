// src/app/next-actions/people-signals.ts
//
// AI people protection (spec layer 1): which Action Center signals are ABOUT a person. Under protection,
// every list of actions handed to an AI context builder drops these ("Analyze with AI", the weight-
// suggestion context, a scheduled job's derived queue), all through `isPeopleSignalAction`.
// Pure and i18n-free; classified by the action's SOURCE, never its text.
import type { ActionSource, SuggestedAction } from "./types";

/** ★ A total record, so a new `ActionSource` does not compile until someone decides whether it names people. */
const NAMES_A_PERSON: Record<ActionSource, boolean> = {
  workload: true, // one person's overload or over-allocation, by name
  "stakeholder-comms": true, // a reminder to contact a named stakeholder
  "task-due": false,
  raid: false,
  "change-pending": false,
  milestone: false,
  budget: false,
  schedule: false,
  committee: false,
  "task-attention": false,
  "project-meta": false,
  "forecast-sim": false,
};

/** True for an action about one person (workload, stakeholder comms). */
export function isPeopleSignalAction(action: Pick<SuggestedAction, "source">): boolean {
  return NAMES_A_PERSON[action.source];
}

/** The actions an AI context may carry: all of them, or, under people protection, all but the people signals. */
export function actionsForAi<T extends Pick<SuggestedAction, "source">>(actions: readonly T[], peopleProtected: boolean): readonly T[] {
  return peopleProtected ? actions.filter((a) => !isPeopleSignalAction(a)) : actions;
}
