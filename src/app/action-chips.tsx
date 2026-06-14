// src/app/action-chips.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";

const TIER_DOT: Record<"now" | "soon", string> = {
  now: "bg-AIPM-pink",
  soon: "bg-AIPM-purple",
};
const MAX_CHIPS = 3;

/** Open-CTA actions targeting `view` (used by the data-view strip + report cards). */
export function chipsForView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return actions.filter((a) => a.cta.kind === "open" && a.cta.view === view);
}

interface ActionChipsProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
  onShowMore: () => void;
  className?: string;
}

export function ActionChips({ lang, actions, onOpen, onShowMore, className }: ActionChipsProps) {
  const ranked = actions.filter((a) => a.tier === "now" || a.tier === "soon");
  if (ranked.length === 0) return null;
  const shown = ranked.slice(0, MAX_CHIPS);
  const extra = ranked.length - shown.length;
  return (
    <div
      role="group"
      aria-label={t(lang, "actionChipsLabel")}
      className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
    >
      {shown.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onOpen(action)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-muted"
        >
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT[action.tier as "now" | "soon"]}`} />
          <span className="max-w-[16rem] truncate">
            {t(lang, action.title.key, ...(action.title.params ?? []))}
          </span>
        </button>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="inline-flex items-center rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted"
        >
          {t(lang, "actionChipsMore", extra)}
        </button>
      )}
    </div>
  );
}
