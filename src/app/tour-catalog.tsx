"use client";

// Presentational guided-tour catalog (Help SP4). Props-only (no context) so it
// unit-tests standalone, mirroring relations-map.tsx / view-callout.tsx. Each tour
// is a single clickable card; a completed tour shows a ✓ Done badge.
import { type Lang, t } from "./i18n";
import type { TourCatalogEntry } from "./app-tour";
import { INTERACTIVE } from "./interaction-styles";

export interface TourCatalogProps {
  lang: Lang;
  tours: readonly TourCatalogEntry[];
  completedTours: readonly string[];
  onStartTour: (id: string) => void;
}

export function TourCatalog({ lang, tours, completedTours, onStartTour }: TourCatalogProps) {
  const done = new Set(completedTours);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {tours.map((tour) => {
        const isDone = done.has(tour.id);
        return (
          <button
            key={tour.id}
            type="button"
            onClick={() => onStartTour(tour.id)}
            aria-label={`${t(lang, "tourStartCta")} – ${t(lang, tour.titleKey)}`}
            className={`flex flex-col gap-1 rounded-md border border-line bg-surface p-3 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{t(lang, tour.titleKey)}</span>
              {isDone && (
                <span className="shrink-0 rounded-full bg-AIPM-green/15 px-2 py-0.5 text-[10px] font-medium text-AIPM-green-strong">
                  <span aria-hidden="true">✓ </span>
                  {t(lang, "tourDoneBadge")}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{t(lang, tour.descKey)}</span>
            <span className="mt-1 text-xs font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "tourStartCta")} →
            </span>
          </button>
        );
      })}
    </div>
  );
}
