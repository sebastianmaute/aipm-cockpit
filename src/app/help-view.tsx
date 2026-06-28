"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { HELP_SECTIONS } from "./help-sections";
import { matchesQuery, highlightSegments } from "./help-search";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

const sectionId = (key: string) => `help-sec-${key}`;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((seg, k) =>
        seg.match ? (
          <mark key={k} className="bg-AIPM-green/20 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** In-pane Help view (sidebar nav entry, below Settings). Renders the shared
 *  help sections (the same content as the floating top-bar Help panel) as a
 *  searchable, printable page. */
export function HelpView({ lang, onTakeTour }: { lang: Lang; onTakeTour?: () => void }) {
  const [query, setQuery] = useState("");
  const { ref, reset } = useResizable("lop-app:help-view-size");
  const filtered = useMemo(
    () => HELP_SECTIONS.filter((s) => matchesQuery(t(lang, s.titleKey), t(lang, s.bodyKey), query)),
    [lang, query],
  );

  const scrollToSection = (key: string) => {
    document.getElementById(sectionId(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "navHelp")}</h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "helpSearchPlaceholder")}
          aria-label={t(lang, "helpSearchPlaceholder")}
          className={`ml-2 min-w-[12rem] rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground ${FOCUS_RING} ${TRANSITION} print:hidden`}
        />
        <span className="ml-auto" />
        {onTakeTour && (
          <button
            type="button"
            onClick={onTakeTour}
            className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE} print:hidden`}
          >
            {t(lang, "tourLaunch")}
          </button>
        )}
        <PrintButton lang={lang} />
        <ResetSizeButton onClick={reset} lang={lang} />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line print:block print:overflow-visible">
        {filtered.length === 0 ? (
          <p className="flex-1 p-10 text-center text-sm text-muted-foreground">{t(lang, "helpNoResults")}</p>
        ) : (
          <>
            {/* Table of contents (left) — click to jump to a section */}
            <nav
              aria-label={t(lang, "helpContents")}
              className="hidden w-56 shrink-0 overflow-auto border-r border-line p-3 md:block print:hidden"
            >
              <ul className="flex flex-col gap-0.5">
                {filtered.map((s) => (
                  <li key={s.titleKey}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(s.titleKey)}
                      className={`w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
                    >
                      {t(lang, s.titleKey)}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Section content (right) */}
            <div className="min-h-0 flex-1 overflow-auto p-3 pr-2 print:max-h-none print:overflow-visible">
              <div className="flex flex-col gap-4">
                {filtered.map((s) => (
                  <section key={s.titleKey} id={sectionId(s.titleKey)} className="scroll-mt-2">
                    <h3 className="mb-1 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                      <Highlighted text={t(lang, s.titleKey)} query={query} />
                    </h3>
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      <Highlighted text={t(lang, s.bodyKey)} query={query} />
                    </p>
                  </section>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
