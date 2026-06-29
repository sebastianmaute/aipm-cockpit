"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { TIPS, tipIndexForDay } from "./tips";
import type { DensityClasses } from "./dashboard-density";
import { INTERACTIVE } from "./interaction-styles";

// Per-device tip state (NOT workspace data): which tip + whether dismissed today.
const KEY = "lop-app:tip-state";
type TipState = { index?: number; dismissedDay?: number };

function loadTipState(): TipState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object") return v as TipState;
    }
  } catch {
    // ignore malformed/unavailable storage
  }
  return {};
}

function saveTipState(next: TipState, isPopout: boolean): void {
  if (isPopout) return; // popouts are read-only — never persist
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

interface DashboardTipCardProps {
  lang: Lang;
  dc: DensityClasses;
  isPopout?: boolean;
}

/** "Tip of the day" — a dismissable dashboard card that rotates one app tip per
 *  day. Day number + stored state are captured lazily so no `Date.now()` runs
 *  in the render body (react-hooks purity). */
export function DashboardTipCard({ lang, dc, isPopout = false }: DashboardTipCardProps) {
  const [today] = useState(() => Math.floor(Date.now() / 86_400_000));
  const [stored] = useState(loadTipState);
  const [index, setIndex] = useState(() =>
    typeof stored.index === "number" ? tipIndexForDay(stored.index) : tipIndexForDay(today),
  );
  const [dismissed, setDismissed] = useState(() => stored.dismissedDay === today);

  if (dismissed || TIPS.length === 0) return null;

  const next = () => {
    const ni = tipIndexForDay(index + 1);
    setIndex(ni);
    saveTipState({ ...loadTipState(), index: ni }, isPopout);
  };
  const dismiss = () => {
    setDismissed(true);
    saveTipState({ ...loadTipState(), dismissedDay: today }, isPopout);
  };

  return (
    <div className={`rounded-lg border border-line bg-surface ${dc.cardPad} shadow-[var(--shadow-card)]`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "dashboardTipLabel")}
        </span>
        <p className="flex-1 text-sm text-foreground">{TIPS[index]}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={next}
            className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "dashboardTipNext")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t(lang, "dashboardTipDismiss")}
            title={t(lang, "dashboardTipDismiss")}
            className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
