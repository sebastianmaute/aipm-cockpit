"use client";

// Suggested-prompt chip strip for the AI Assistant. Extracted from chat-panel's
// empty-state so the chips can render in a PERSISTENT strip below the output for
// the whole session, not only when the transcript is empty.

import { t, type Lang } from "./i18n";
import { TRANSITION, PRESS } from "./interaction-styles";
import { CHAT_ONLY_PROMPTS, FOUNDATIONAL_PROMPTS, type PromptDef } from "./ask-claude-prompts";

// A starter chip: a prompt plus whether clicking it sends immediately
// (foundational prompts) or just fills the input (the legacy chips).
type PromptChip = PromptDef & { autoSend: boolean };

export const PROMPT_CHIPS: PromptChip[] = [
  { labelKey: "chatPromptUpdate", bodyKey: "chatPromptUpdateBody", autoSend: false },
  { labelKey: "chatPromptOverdue", bodyKey: "chatPromptOverdue", autoSend: false },
  { labelKey: "chatPromptAtRisk", bodyKey: "chatPromptAtRisk", autoSend: false },
  { labelKey: "chatPromptStatusUpdate", bodyKey: "chatPromptStatusUpdate", autoSend: false },
  ...[...FOUNDATIONAL_PROMPTS, ...CHAT_ONLY_PROMPTS].map((p) => ({ ...p, autoSend: true })),
];

export function ChatPromptChips({
  lang,
  onPick,
}: {
  lang: Lang;
  onPick: (body: string, autoSend: boolean) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Suggested prompts">
      {PROMPT_CHIPS.map((chip) => (
        <li key={chip.labelKey}>
          <button
            type="button"
            onClick={() => onPick(t(lang, chip.bodyKey), !!chip.autoSend)}
            className={`rounded-full border border-ui-dark-blue/40 bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue hover:bg-ui-dark-blue/10 focus:outline-none focus:ring-2 focus:ring-ui-dark-blue/50 dark:border-ui-dark-blue/60 dark:text-ui-dark-blue dark:hover:bg-ui-dark-blue/20 ${TRANSITION} ${PRESS}`}
          >
            {t(lang, chip.labelKey)}
          </button>
        </li>
      ))}
    </ul>
  );
}
