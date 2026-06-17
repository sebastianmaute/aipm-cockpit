"use client";

// Header dropdown that offers AI-assistant prompts for the current view. Same
// open/close/outside-click/Escape pattern as ExportMenu. Picking a prompt calls
// onAsk(promptBody) — wired upstream to requestChat(body, true), which switches
// to the chat tab and auto-sends.
import { useEffect, useRef, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { AppView } from "./nav-config";
import { promptsForView, type PromptDef } from "./ask-claude-prompts";

function PromptSection({
  lang,
  titleKey,
  items,
  onPick,
}: {
  lang: Lang;
  titleKey: TranslationKey;
  items: PromptDef[];
  onPick: (def: PromptDef) => void;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(lang, titleKey)}
      </h3>
      <ul className="space-y-0.5">
        {items.map((def) => (
          <li key={def.labelKey}>
            <button
              type="button"
              onClick={() => onPick(def)}
              className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
            >
              {t(lang, def.labelKey)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskClaudeMenu({
  lang,
  currentView,
  onAsk,
}: {
  lang: Lang;
  currentView: AppView;
  onAsk: (promptBody: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { onPage, general } = promptsForView(currentView);

  function pick(def: PromptDef) {
    setOpen(false);
    onAsk(t(lang, def.bodyKey));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "aiAskClaude")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t(lang, "aiAskClaude")}
        className="inline-flex items-center gap-1.5 rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path d="M10 1.5l1.6 4.3 4.3 1.6-4.3 1.6L10 13.3 8.4 9 4.1 7.4l4.3-1.6L10 1.5zM15.5 12l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
        </svg>
        <span>{t(lang, "aiAskClaude")}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "aiAskClaude")}
          className="absolute right-0 top-full z-40 mt-2 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-3"
        >
          {onPage.length > 0 && (
            <PromptSection lang={lang} titleKey="aiAskClaudeOnPage" items={onPage} onPick={pick} />
          )}
          <PromptSection lang={lang} titleKey="aiAskClaudeGeneral" items={general} onPick={pick} />
        </div>
      )}
    </div>
  );
}
