"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { TIPS, tipIndexForDay } from "./tips";
import type { DensityClasses } from "./dashboard-density";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { useSettings } from "./use-settings";
import { Button } from "./button";

// Per-device tip state (NOT workspace data): which tip + whether dismissed today.
const KEY = "aipm-cockpit:tip-state";
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
 *  in the render body (react-hooks purity). Gated by the global "Show tips"
 *  setting (`showViewHints`), the same umbrella that drives the per-view Help
 *  callouts, so one Settings control turns off all tips. */
export function DashboardTipCard({ lang, dc, isPopout = false }: DashboardTipCardProps) {
  const { settings } = useSettings();
  const [today] = useState(() => Math.floor(Date.now() / 86_400_000));
  const [stored] = useState(loadTipState);
  const [index, setIndex] = useState(() =>
    typeof stored.index === "number" ? tipIndexForDay(stored.index) : tipIndexForDay(today),
  );
  const [dismissed, setDismissed] = useState(() => stored.dismissedDay === today);

  if (settings.showViewHints === false || dismissed || TIPS.length === 0) return null;

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
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "dashboardTipLabel")}
        </span>
        <p className="flex-1 text-sm text-foreground">{TIPS[index]}</p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            onClick={next}
            variant="secondary" size="xs"
          >
            {t(lang, "dashboardTipNext")}
          </Button>
          {/* ★ The dismiss sits beside the text "Next tip" button and MUST keep
              reading as its pair — at f6e85d55 the two carried byte-identical
              classNames. Next is now the shared `xs` Button: py-1.5 (12px) + a
              16px line + 2px border = 30px. `bordered` at `md` is p-1.5 (12px)
              + a 16px icon + 2px border = 30px, so the pair matches again; at
              the default `sm` (p-1) it would be 26px, and with a 12px icon 22px.
              jsdom has no layout, so nothing here can test the height; the
              class recipe is the only guard. */}
          <IconButton
            variant="bordered"
            size="md"
            onClick={dismiss}
            label={t(lang, "dashboardTipDismiss")}
            title={t(lang, "dashboardTipDismiss")}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
