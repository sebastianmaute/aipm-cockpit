"use client";

// Suggested-prompt chip strip for the AI Assistant. Extracted from chat-panel's
// empty-state so the chips can render in a PERSISTENT strip below the output for
// the whole session, not only when the transcript is empty.

import { t, type Lang } from "./i18n";
import { CHAT_ONLY_PROMPTS, CHAT_STARTER_PROMPTS, type PromptDef } from "./ask-claude-prompts";
import { Button } from "./button";

// A starter chip: a prompt plus whether clicking it sends immediately or just
// fills the input. Every chip here auto-sends — each body is a complete brief,
// so there is nothing for the user to fill in first.
type PromptChip = PromptDef & { autoSend: boolean };

// ★ The four starters lead; "process an attachment" trails because it is the
// only CONDITIONAL one — it does nothing useful until a file is attached.
// ★★ FOUNDATIONAL_PROMPTS is deliberately NOT spread in here any more. It is
// still live: the header Ask-Claude menu serves it (`promptsFor`), so do not
// delete it on the assumption this was its only consumer.
export const PROMPT_CHIPS: PromptChip[] = [
  ...[...CHAT_STARTER_PROMPTS, ...CHAT_ONLY_PROMPTS].map((p) => ({ ...p, autoSend: true })),
];

export function ChatPromptChips({
  lang,
  onPick,
}: {
  lang: Lang;
  onPick: (body: string, autoSend: boolean) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label={t(lang, "chatSuggestedPrompts")}>
      {PROMPT_CHIPS.map((chip) => (
        <li key={chip.labelKey}>
          <Button
            onClick={() => onPick(t(lang, chip.bodyKey), chip.autoSend)}
            variant="secondary" size="xs"
          >
            {t(lang, chip.labelKey)}
          </Button>
        </li>
      ))}
    </ul>
  );
}
