"use client";

// Shared per-row "Ask Claude" (inline AI edit) affordance for entity panels
// (RAID / change / milestone / stakeholder). The tasks table keeps its own
// inline button in task-row.tsx (shipped SP1); this component de-dups the four
// SP2 panels so the ✨ markup lives in one place. Presentational + props-only.
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

interface InlineAiEditButtonProps {
  lang: Lang;
  /** Row-unique suffix for the accessible name (RAID + Milestones are axe-scanned). */
  label: string;
  onClick: () => void;
}

export function InlineAiEditButton({ lang, label, onClick }: InlineAiEditButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Entity rows are clickable (row-click opens the editor) — don't let the
        // ✨ click bubble into that handler.
        e.stopPropagation();
        onClick();
      }}
      aria-label={`${t(lang, "inlineAiEdit")} – ${label}`}
      title={t(lang, "inlineAiEdit")}
      className={`rounded-md px-1.5 text-ui-dark-blue opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ui-dark-blue dark:text-ui-light-grey ${INTERACTIVE}`}
    >
      <SparklesIcon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
