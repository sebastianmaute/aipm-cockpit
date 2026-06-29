"use client";

import { useEffect, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { matchesQuery, highlightSegments } from "./help-search";
import { navLabelKey } from "./nav-config";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

const sectionId = (id: string) => `help-sec-${id}`;

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
 *  help backbone grouped (Concepts · Workflows · Features · What's automated)
 *  with a grouped TOC, in-page related links, and search across everything. */
export function HelpView({
  lang,
  onTakeTour,
  pendingHelpConcept,
  onHelpConceptConsumed,
}: {
  lang: Lang;
  onTakeTour?: () => void;
  /** A concept id deep-linked from a per-view callout (SP2) — scroll to it. */
  pendingHelpConcept?: string | null;
  onHelpConceptConsumed?: () => void;
}) {
  const [query, setQuery] = useState("");
  const { ref, reset } = useResizable("lop-app:help-view-size");

  const groups = useMemo(() => {
    const matched = HELP_ENTRIES.filter((e) => matchesQuery(t(lang, e.titleKey), t(lang, e.bodyKey), query));
    return HELP_GROUP_ORDER.map((group) => ({ group, entries: matched.filter((e) => e.group === group) })).filter(
      (g) => g.entries.length > 0,
    );
  }, [lang, query]);

  const scrollToSection = (id: string) => {
    document.getElementById(sectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Deep-link from a per-view callout: scroll to the requested concept on
  // mount/change. Render-time reconcile + a nonce-keyed effect (mirrors
  // useDeepLinkRowFlash) — no set-state-in-effect; `handledConcept` seeded
  // `undefined` so a fresh mount that already sees the prop still fires.
  const [handledConcept, setHandledConcept] = useState<string | null | undefined>(undefined);
  const [scrollSeq, setScrollSeq] = useState(0);
  if (pendingHelpConcept !== undefined && pendingHelpConcept !== handledConcept) {
    setHandledConcept(pendingHelpConcept);
    if (pendingHelpConcept) setScrollSeq((s) => s + 1);
  }
  useEffect(() => {
    if (!handledConcept) return;
    document.getElementById(sectionId(handledConcept))?.scrollIntoView({ behavior: "smooth", block: "start" });
    onHelpConceptConsumed?.();
  }, [scrollSeq, handledConcept, onHelpConceptConsumed]);

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
        {groups.length === 0 ? (
          <p className="flex-1 p-10 text-center text-sm text-muted-foreground">{t(lang, "helpNoResults")}</p>
        ) : (
          <>
            {/* Grouped table of contents (left) — click to jump to a section */}
            <nav
              aria-label={t(lang, "helpContents")}
              className="hidden w-56 shrink-0 overflow-auto border-r border-line p-3 md:block print:hidden"
            >
              {groups.map(({ group, entries }) => (
                <div key={group} className="mb-3">
                  <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(lang, HELP_GROUP_LABEL[group])}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {entries.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => scrollToSection(e.id)}
                          className={`w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
                        >
                          {t(lang, e.titleKey)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            {/* Grouped content (right) */}
            <div className="min-h-0 flex-1 overflow-auto p-3 pr-2 print:max-h-none print:overflow-visible">
              {groups.map(({ group, entries }) => (
                <div key={group} className="mb-6">
                  <h2 className="mb-2 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {t(lang, HELP_GROUP_LABEL[group])}
                  </h2>
                  <div className="flex flex-col gap-4">
                    {entries.map((e) => (
                      <section key={e.id} id={sectionId(e.id)} className="scroll-mt-2">
                        <h3 className="mb-1 text-sm font-semibold text-foreground">
                          <Highlighted text={t(lang, e.titleKey)} query={query} />
                        </h3>
                        <p className="whitespace-pre-line text-sm text-muted-foreground">
                          <Highlighted text={t(lang, e.bodyKey)} query={query} />
                        </p>
                        {(e.relatedConcepts?.length ?? 0) > 0 || (e.relatedViews?.length ?? 0) > 0 ? (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            <span className="font-medium">{t(lang, "helpRelated")}:</span>{" "}
                            {e.relatedConcepts?.map((rid, idx) => {
                              const target = HELP_ENTRIES.find((x) => x.id === rid);
                              if (!target) return null;
                              return (
                                <span key={rid}>
                                  {idx > 0 ? ", " : ""}
                                  <button
                                    type="button"
                                    onClick={() => scrollToSection(rid)}
                                    className={`text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                                  >
                                    {t(lang, target.titleKey)}
                                  </button>
                                </span>
                              );
                            })}
                            {e.relatedViews?.map((v) => (
                              <span key={v} className="ml-2 italic">
                                {t(lang, navLabelKey(v))}
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </section>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
