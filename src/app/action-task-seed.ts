// src/app/action-task-seed.ts
// Pure builder: turns a SuggestedAction into the prefill for a new task
// (taskName + a "From:" provenance note). No React, no side effects.
import { t, type Lang } from "./i18n";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { plainToHtml } from "./sanitize-html";
import type { SuggestedAction } from "./next-actions/types";
import { actionText } from "./action-text";

// Blank line after the provenance note so the user's own notes start on a fresh line.
const NOTES_SEED_SEPARATOR = "\n\n";

export function buildTaskSeedFromAction(
  action: SuggestedAction,
  lang: Lang,
): { taskName: string; description: string } {
  const taskName = actionText(lang, action.title);
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  const why = actionText(lang, action.why);
  const notes = t(lang, "actionCreatedFromNote", sourceLabel, why) + NOTES_SEED_SEPARATOR;
  return { taskName, description: plainToHtml(notes) };
}
