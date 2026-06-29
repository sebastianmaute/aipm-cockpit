"use client";

import { useEffect, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { HELP_ENTRIES } from "./help-content";
import { type AppView } from "./nav-config";
import { buildRelationsGraph } from "./relations-graph";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { RelationsMap } from "./relations-map";
import { TourCatalog } from "./tour-catalog";
import { HelpCollapsibleRegion, type HelpPanel } from "./help-collapsible-region";
import { InformationFlowsSection } from "./settings-sections/information-flows-section";
import type { TourCatalogEntry } from "./app-tour";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

/** In-pane Help view (sidebar nav entry, below Settings). Renders the shared
 *  help backbone grouped (Concepts · Workflows · Features · What's automated)
 *  with a grouped TOC, in-page related links, and search across everything. */
export function HelpView({
  lang,
  onTakeTour,
  pendingHelpConcept,
  onHelpConceptConsumed,
  onNavigateView,
  onStartTour,
  catalogTours,
  completedTours,
}: {
  lang: Lang;
  onTakeTour?: () => void;
  /** A concept id deep-linked from a per-view callout (SP2) — scroll to it. */
  pendingHelpConcept?: string | null;
  onHelpConceptConsumed?: () => void;
  /** Navigate to a related view from a concept's Related line (SP3). */
  onNavigateView?: (view: AppView) => void;
  /** Launch a themed tour by id (SP4). Present only in modern, non-popout. */
  onStartTour?: (id: string) => void;
  /** Tours available under the current feature set (SP4). */
  catalogTours?: readonly TourCatalogEntry[];
  /** Ids of completed tours, for the ✓ badge (SP4). */
  completedTours?: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const { ref, reset } = useResizable("lop-app:help-view-size");
  const graph = useMemo(() => buildRelationsGraph(HELP_ENTRIES), []);

  const scrollToSection = (id: string) => {
    document.getElementById(helpSectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    document.getElementById(helpSectionId(handledConcept))?.scrollIntoView({ behavior: "smooth", block: "start" });
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

      <HelpCollapsibleRegion
        lang={lang}
        panels={[
          ...(onStartTour
            ? ([
                {
                  key: "tours",
                  titleKey: "helpGuidedToursTitle",
                  body: (
                    <TourCatalog
                      lang={lang}
                      tours={catalogTours ?? []}
                      completedTours={completedTours ?? []}
                      onStartTour={onStartTour}
                    />
                  ),
                },
              ] as HelpPanel[])
            : []),
          {
            key: "connects",
            titleKey: "helpRelationsTitle",
            body: <RelationsMap graph={graph} lang={lang} onSelectConcept={scrollToSection} />,
          },
          {
            key: "flows",
            titleKey: "infoFlowsTitle",
            body: <InformationFlowsSection lang={lang} />,
          },
        ]}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line print:block print:overflow-visible">
        <HelpContentPane lang={lang} query={query} onNavigateView={onNavigateView} />
      </div>
    </div>
  );
}
