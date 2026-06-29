"use client";

import { useState, type ReactNode } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE, FOCUS_RING } from "./interaction-styles";

export interface HelpPanel {
  key: string;
  titleKey: TranslationKey;
  body: ReactNode;
}

/** Exclusive horizontal accordion for the Help-view top region. One panel open
 *  at a time; the others collapse to a thin vertical bar. Open-state ephemeral
 *  (useState), never persisted. Each bar/header is a keyboard button with
 *  aria-expanded/aria-controls. Stacks vertically on a narrow container. */
export function HelpCollapsibleRegion({ lang, panels }: { lang: Lang; panels: readonly HelpPanel[] }) {
  const [openKey, setOpenKey] = useState<string>(panels[0]?.key ?? "");
  if (panels.length === 0) return null;
  return (
    <div className="@container mb-2 shrink-0 print:hidden">
      <div className="flex flex-col gap-2 @[560px]:h-60 @[560px]:flex-row">
        {panels.map((p) => {
          const isOpen = p.key === openKey;
          const bodyId = `help-acc-${p.key}`;
          if (isOpen) {
            return (
              <section key={p.key} className="flex min-h-0 flex-1 flex-col rounded-lg border border-line border-l-[3px] border-l-AIPM-dark-blue bg-surface">
                <button
                  type="button"
                  aria-expanded="true"
                  aria-controls={bodyId}
                  onClick={() => setOpenKey(p.key)}
                  className={`flex shrink-0 items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-foreground ${FOCUS_RING}`}
                >
                  <span aria-hidden="true">▾</span> {t(lang, p.titleKey)}
                </button>
                <div id={bodyId} className="min-h-0 flex-1 overflow-auto px-3 pb-3 pr-2">
                  {p.body}
                </div>
              </section>
            );
          }
          return (
            <button
              key={p.key}
              type="button"
              aria-expanded="false"
              aria-controls={bodyId}
              onClick={() => setOpenKey(p.key)}
              className={`flex shrink-0 items-center justify-center rounded-lg border border-line bg-surface py-2 text-AIPM-dark-blue hover:border-AIPM-dark-blue hover:bg-surface-muted @[560px]:w-9 @[560px]:py-0 dark:text-AIPM-light-grey ${INTERACTIVE}`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide @[560px]:[writing-mode:vertical-rl] @[560px]:rotate-180">
                <span aria-hidden="true">▸</span> {t(lang, p.titleKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
