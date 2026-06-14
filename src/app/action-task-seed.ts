// src/app/action-task-seed.ts
// Pure builder: turns a SuggestedAction into the prefill for a new task
// (taskName + a "From:" provenance note). No React, no side effects.
import { t, type Lang } from "./i18n";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { SuggestedAction } from "./next-actions/types";

export function buildTaskSeedFromAction(
  action: SuggestedAction,
  lang: Lang,
): { taskName: string; notes: string } {
  const taskName = t(lang, action.title.key, ...(action.title.params ?? []));
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const notes = t(lang, "actionCreatedFromNote", sourceLabel, why) + "\n\n";
  return { taskName, notes };
}
