"use client";

import { useEffect, useMemo, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { HELP_ENTRIES } from "./help-content";
import { type AppView } from "./nav-config";
import { buildRelationsGraph } from "./relations-graph";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { ClearableSearchInput } from "./clearable-search-input";
import { RelationsMap } from "./relations-map";
import { TourCatalog } from "./tour-catalog";
import { InformationFlowsSection } from "./settings-sections/information-flows-section";
import type { TourCatalogEntry } from "./app-tour";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { useSettings } from "./use-settings";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { useTablistRoving } from "./use-tablist-roving";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

type HelpTab = "help" | "tours" | "connects" | "flows";

/** In-pane Help view (sidebar nav entry, below Settings). Mirrors the floating
 *  Help panel's layout: a tablist in the header (Help · Guided tours · How it
 *  all connects · Information flows) beside the search box; clicking a tab swaps
 *  the body and only the active tab's body mounts. The Help tab renders the
 *  shared grouped content backbone (grouped TOC, in-page related links, search
 *  across everything); the other tabs surface the tour catalog, the concept
 *  relations map, and the information-flows diagram. */
export function HelpView({
  lang,
  pendingHelpConcept,
  onHelpConceptConsumed,
  onNavigateView,
  onStartTour,
  catalogTours,
  completedTours,
}: {
  lang: Lang;
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
  const [tab, setTab] = useState<HelpTab>("help");
  // Device-global reading level. A local hook rather than a prop: the value is
  // needed by exactly this subtree, and `use-settings.ts` keeps every live
  // instance in step, so it cannot go stale against the Settings pane.
  const { settings } = useSettings();
  const { ref, reset } = useResizable("aipm-cockpit:help-view-size");
  const graph = useMemo(() => buildRelationsGraph(HELP_ENTRIES), []);

  const tabs: { key: HelpTab; labelKey: TranslationKey }[] = [
    { key: "help", labelKey: "navHelp" },
    ...(onStartTour ? ([{ key: "tours", labelKey: "helpGuidedToursTitle" }] as { key: HelpTab; labelKey: TranslationKey }[]) : []),
    { key: "connects", labelKey: "helpRelationsTitle" },
    { key: "flows", labelKey: "infoFlowsTitle" },
  ];
  // Drift guard: if the active key is no longer in the list (tours tab gated
  // away), fall back to the first tab.
  const activeTab: HelpTab = tabs.some((tb) => tb.key === tab) ? tab : "help";

  // Scroll-to-concept: only the active tab body is mounted, so jumping to a
  // concept switches to the Help tab and bumps a nonce; a nonce-keyed effect
  // scrolls once the Help content has committed. `scrollTarget` is never
  // cleared (re-selecting bumps the nonce) so there is no set-state-in-effect.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [scrollSeq, setScrollSeq] = useState(0);
  const goToConcept = (id: string) => {
    setTab("help");
    setScrollTarget(id);
    setScrollSeq((s) => s + 1);
  };

  // Deep-link from a per-view callout: route through goToConcept (switch to the
  // Help tab + scroll). Render-time reconcile + a nonce-keyed effect (mirrors
  // useDeepLinkRowFlash) — no set-state-in-effect; `handledConcept` seeded
  // `undefined` so a fresh mount that already sees the prop still fires.
  const [handledConcept, setHandledConcept] = useState<string | null | undefined>(undefined);
  if (pendingHelpConcept !== undefined && pendingHelpConcept !== handledConcept) {
    setHandledConcept(pendingHelpConcept);
    if (pendingHelpConcept) goToConcept(pendingHelpConcept);
  }
  useEffect(() => {
    if (!scrollTarget) return;
    document.getElementById(helpSectionId(scrollTarget))?.scrollIntoView({ behavior: "smooth", block: "start" });
    onHelpConceptConsumed?.();
  }, [scrollSeq, scrollTarget, onHelpConceptConsumed]);

  const roving = useTablistRoving();

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 border-b border-line pb-2 print:hidden">
        <div
          role="tablist"
          aria-label={t(lang, "navHelp")}
          onKeyDown={roving}
          className="flex flex-wrap items-center gap-1 print:hidden"
        >
          {tabs.map((tb) => {
            const isActive = tb.key === activeTab;
            return (
              <button
                key={tb.key}
                type="button"
                role="tab"
                id={`help-view-tab-${tb.key}`}
                aria-selected={isActive}
                aria-controls="help-view-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => setTab(tb.key)}
                className={
                  isActive
                    ? `rounded-md bg-ui-dark-blue px-3 py-1.5 text-sm font-semibold text-white ${FOCUS_RING}`
                    : `rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`
                }
              >
                {t(lang, tb.labelKey)}
              </button>
            );
          })}
        </div>
        {activeTab === "help" && (
          <ClearableSearchInput
            value={query}
            onClear={() => setQuery("")}
            clearLabel={`${t(lang, "clear")} – ${t(lang, "helpSearchPlaceholder")}`}
            className="min-w-[12rem] flex-1 print:hidden"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "helpSearchPlaceholder")}
              aria-label={t(lang, "helpSearchPlaceholder")}
              className={`w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none ${FOCUS_RING} ${TRANSITION}${query ? " pr-8" : ""}`}
            />
          </ClearableSearchInput>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2 print:hidden">
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>

      <div
        id="help-view-panel"
        role="tabpanel"
        aria-labelledby={`help-view-tab-${activeTab}`}
        className="flex min-h-0 flex-1 overflow-hidden print:block print:overflow-visible"
      >
        {activeTab === "help" && (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line print:block print:overflow-visible">
            <HelpContentPane
              lang={lang}
              query={query}
              onNavigateView={onNavigateView}
              readingLevel={settings.helpReadingLevel ?? "standard"}
            />
          </div>
        )}
        {activeTab === "tours" && (
          <div className="min-h-0 flex-1 overflow-auto pr-2">
            <TourCatalog
              lang={lang}
              tours={catalogTours ?? []}
              completedTours={completedTours ?? []}
              onStartTour={onStartTour ?? (() => {})}
            />
          </div>
        )}
        {activeTab === "connects" && (
          <div className="min-h-0 flex-1 overflow-auto pr-2">
            <RelationsMap graph={graph} lang={lang} onSelectConcept={goToConcept} />
          </div>
        )}
        {activeTab === "flows" && (
          <div className="min-h-0 flex-1 overflow-auto pr-2">
            <InformationFlowsSection lang={lang} maxWidth={720} />
          </div>
        )}
      </div>
    </div>
  );
}
