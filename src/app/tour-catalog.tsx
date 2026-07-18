"use client";

// Presentational guided-tour catalog (Help SP4). Props-only (no context) so it
// unit-tests standalone, mirroring relations-map.tsx / view-callout.tsx. Each tour
// is a single clickable card; a completed tour shows a ✓ Done badge.
import { type Lang, t } from "./i18n";
import type { TourCatalogEntry } from "./app-tour";
import { INTERACTIVE } from "./interaction-styles";
import { Badge } from "./badge";
import { NavIcon } from "./nav-icons";

export interface TourCatalogProps {
  lang: Lang;
  tours: readonly TourCatalogEntry[];
  completedTours: readonly string[];
  onStartTour: (id: string) => void;
}

export function TourCatalog({ lang, tours, completedTours, onStartTour }: TourCatalogProps) {
  const done = new Set(completedTours);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tours.map((tour) => {
        const isDone = done.has(tour.id);
        return (
          <button
            key={tour.id}
            type="button"
            onClick={() => onStartTour(tour.id)}
            aria-label={`${t(lang, isDone ? "tourReplayCta" : "tourStartCta")} – ${t(lang, tour.titleKey)}`}
            className={`flex gap-3 rounded-md border border-line border-l-[3px] border-l-ui-dark-blue bg-surface p-3 text-left hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                isDone ? "bg-ui-green/15 text-ui-green-strong" : "bg-surface-muted text-ui-dark-blue"
              }`}
            >
              {isDone ? "✓" : <NavIcon view={tour.iconView} className="h-4 w-4" />}
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{t(lang, tour.titleKey)}</span>
                {isDone && (
                  <Badge pill size="sm" className="shrink-0 bg-ui-green/15 font-medium text-ui-green-strong">
                    <span aria-hidden="true">✓ </span>
                    {t(lang, "tourDoneBadge")}
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                {t(lang, "tourStepCount", String(tour.stepCount))}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(lang, tour.descKey)}</span>
              <span className="mt-1 block text-xs font-medium text-ui-dark-blue dark:text-ui-light-grey">
                {isDone ? t(lang, "tourReplayCta") : t(lang, "tourStartCta")} →
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
