"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE, FOCUS_RING } from "./interaction-styles";

export interface HelpPanel {
  key: string;
  titleKey: TranslationKey;
  body: ReactNode;
}

/** Exclusive horizontal region for the Help-view top area: one panel selected
 *  at a time, the others collapse to a thin vertical bar. Implemented as a
 *  tablist (selecting a tab is idempotent — there is always exactly one open),
 *  NOT a disclosure: every panel body stays mounted and is `hidden`-toggled so
 *  each tab's `aria-controls` target is always in the DOM. Open-state is
 *  ephemeral (useState), never persisted. Stacks vertically on a narrow
 *  container; Left/Right arrows move the selection (roving tabindex). */
export function HelpCollapsibleRegion({ lang, panels }: { lang: Lang; panels: readonly HelpPanel[] }) {
  const [openKey, setOpenKey] = useState<string>(panels[0]?.key ?? "");
  if (panels.length === 0) return null;
  // Guard against drift: if `openKey` no longer names a panel (panels changed),
  // fall back to the first so the region never renders with nothing selected.
  const activeKey = panels.some((p) => p.key === openKey) ? openKey : panels[0].key;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    setOpenKey(panels[(idx + dir + panels.length) % panels.length].key);
  };

  return (
    <div
      role="tablist"
      aria-label={t(lang, "navHelp")}
      className="@container mb-2 shrink-0 print:hidden"
    >
      <div className="flex flex-col gap-2 @[560px]:h-60 @[560px]:flex-row">
        {panels.map((p, idx) => {
          const isOpen = p.key === activeKey;
          const tabId = `help-tab-${p.key}`;
          const panelId = `help-acc-${p.key}`;
          return (
            <section key={p.key} className={isOpen ? "flex min-h-0 flex-1 flex-col rounded-lg border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface" : "flex shrink-0"}>
              <button
                type="button"
                role="tab"
                id={tabId}
                aria-selected={isOpen}
                aria-controls={panelId}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => setOpenKey(p.key)}
                onKeyDown={(e) => onKeyDown(e, idx)}
                className={
                  isOpen
                    ? `flex shrink-0 items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-foreground ${FOCUS_RING}`
                    : `flex w-full shrink-0 items-center justify-center rounded-lg border border-line bg-surface py-2 text-AIPM-dark-blue hover:border-AIPM-dark-blue hover:bg-surface-muted @[560px]:h-full @[560px]:w-9 @[560px]:py-0 dark:text-AIPM-light-grey ${INTERACTIVE}`
                }
              >
                {isOpen ? (
                  <>
                    <span aria-hidden="true">▾</span> {t(lang, p.titleKey)}
                  </>
                ) : (
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide @[560px]:rotate-180 @[560px]:[writing-mode:vertical-rl]">
                    <span aria-hidden="true">▸</span> {t(lang, p.titleKey)}
                  </span>
                )}
              </button>
              <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={tabId}
                hidden={!isOpen}
                className="min-h-0 flex-1 overflow-auto px-3 pb-3 pr-2"
              >
                {p.body}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
