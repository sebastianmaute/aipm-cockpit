"use client";

// Ask-Claude chips for the Forecast view (§502): a small menu whose prompts send the user to the AI chat, where
// `get_forecast` answers. Same menu shape as `AskClaudeMenu` (trigger Button, `menuItemClass` items, dismissal
// through `usePopoverDismiss`); the prompts depend on the mode, so they live here and not in `ASK_CLAUDE_PROMPTS`.
import { useRef, useState } from "react";
import { SparklesIcon } from "./icons";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { Button } from "./button";
import { menuItemClass } from "./control-classes";
import { type Lang, t } from "./i18n";
import { useWorkspaceTab } from "./workspace-tab-context";
import type { MilestoneChance } from "./forecast/milestones";
import type { Milestone } from "./types";

/**
 * The milestone least likely to be on time in the run on screen: the lowest `chance`, a tie to the earlier date.
 * Only `state: "chance"` entries carry a chance, so overdue and unlinked milestones are skipped; null without a run.
 */
export function worstMilestoneName(
  milestones: readonly Milestone[],
  chances: readonly MilestoneChance[] | null,
): string | null {
  if (chances === null) return null;
  const byId = new Map(milestones.map((m) => [m.id, m]));
  let worst: { name: string; date: string; chance: number } | null = null;
  for (const c of chances) {
    if (c.state !== "chance") continue;
    const m = byId.get(c.id);
    if (m === undefined) continue;
    if (worst === null || c.chance < worst.chance || (c.chance === worst.chance && m.date < worst.date)) {
      worst = { name: m.name, date: m.date, chance: c.chance };
    }
  }
  return worst === null ? null : worst.name;
}

export function ForecastAskClaude({ lang, inScenarios, scenarioCount, worstMilestone }: {
  lang: Lang;
  inScenarios: boolean;
  scenarioCount: number;
  worstMilestone: string | null;
}) {
  const { requestChat } = useWorkspaceTab();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  usePopoverDismiss(open, ref, close);

  const items: { label: string; body: string }[] = [
    { label: t(lang, "forecastAskExplainLabel"), body: t(lang, "forecastAskExplainBody") },
  ];
  if (worstMilestone !== null) {
    items.push({
      label: t(lang, "forecastAskMilestoneLabel", worstMilestone),
      body: t(lang, "forecastAskMilestoneBody", worstMilestone),
    });
  }
  if (inScenarios && scenarioCount >= 1) {
    items.push({ label: t(lang, "forecastAskCompareLabel"), body: t(lang, "forecastAskCompareBody") });
  }
  if (inScenarios) {
    items.push({ label: t(lang, "forecastAskSuggestLabel"), body: t(lang, "forecastAskSuggestBody") });
  }

  const name = t(lang, "forecastAskClaude");
  return (
    <div ref={ref} className="relative shrink-0">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="xs"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5"
      >
        <SparklesIcon aria-hidden="true" className="h-4 w-4" />
        {name}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={name}
          className="absolute left-0 top-full z-40 mt-2 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-3"
        >
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className={menuItemClass()}
                  onClick={() => {
                    setOpen(false);
                    requestChat(item.body, true);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
