// src/app/action-task-seed.ts
// Pure builder: turns a SuggestedAction into the prefill for a new task
// (taskName + a "From:" provenance note). No React, no side effects.
import { t, type Lang } from "./i18n";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { plainToHtml } from "./sanitize-html";
import type { SuggestedAction } from "./next-actions/types";

// Blank line after the provenance note so the user's own notes start on a fresh line.
const NOTES_SEED_SEPARATOR = "\n\n";

export function buildTaskSeedFromAction(
  action: SuggestedAction,
  lang: Lang,
): { taskName: string; description: string } {
  const taskName = t(lang, action.title.key, ...(action.title.params ?? []));
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const notes = t(lang, "actionCreatedFromNote", sourceLabel, why) + NOTES_SEED_SEPARATOR;
  return { taskName, description: plainToHtml(notes) };
}
