// src/app/action-chips.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import { FOCUS_RING } from "./interaction-styles";
import { TIER_RAG } from "./next-actions/action-cta";
import { Dot } from "./dot";

const MAX_CHIPS = 3;

/** Open-CTA actions targeting `view` (used by the data-view strip + report cards). */
export function chipsForView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return actions.filter((a) =>
    a.cta.kind === "open"
      ? a.cta.view === view
      : a.cta.kind === "open-tasks-for" && view === "open-points",
  );
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
          title={t(lang, action.why.key, ...(action.why.params ?? []))}
          className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-muted ${FOCUS_RING}`}
        >
          <Dot color={TIER_RAG[action.tier as "now" | "soon"].dot} size="xs" />
          <span className="max-w-[16rem] truncate">
            {t(lang, action.title.key, ...(action.title.params ?? []))}
          </span>
        </button>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className={`inline-flex items-center rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted ${FOCUS_RING}`}
        >
          {t(lang, "actionChipsMore", extra)}
        </button>
      )}
    </div>
  );
}
