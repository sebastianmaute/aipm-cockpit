"use client";

// Guided-tour open/index/active-tour state + per-device tourSeen + completedTours,
// plus the render-time auto-launch (NO useEffect setState — banned). Modern-shell only.
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationKey } from "./i18n";
import { clampStep, visibleSteps, findTour, TOURS, type TourStep, type TourCatalogEntry } from "./app-tour";
import type { FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";

const DEFAULT_TOUR_ID = "getting-started";

interface UseTourArgs {
  layout: "modern" | "classic";
  isPopout: boolean;
  hydrated: boolean;
  tourSeen: boolean | undefined;
  completedTours: readonly string[] | undefined;
  features: readonly FeatureModuleId[];
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export interface UseTour {
  isOpen: boolean;
  index: number;
  steps: TourStep[];
  activeTourTitleKey: TranslationKey;
  catalogTours: TourCatalogEntry[];
  completedTours: readonly string[];
  start: (tourId?: string) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  done: () => void;
  showMe: (step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => void;
}

export function useTour({ layout, isPopout, hydrated, tourSeen, completedTours, features, setSettings }: UseTourArgs): UseTour {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [activeTourId, setActiveTourId] = useState<string>(DEFAULT_TOUR_ID);
  const [autoHandled, setAutoHandled] = useState(false);

  const activeTour = findTour(activeTourId) ?? TOURS[0];
  const steps = useMemo(() => visibleSteps(activeTour.steps, features), [activeTour, features]);

  const catalogTours = useMemo<TourCatalogEntry[]>(
    () =>
      TOURS.map((t) => ({ t, vis: visibleSteps(t.steps, features) }))
        .filter(({ vis }) => vis.length > 0)
        .map(({ t, vis }) => ({
          id: t.id,
          titleKey: t.titleKey,
          descKey: t.descKey,
          stepCount: vis.length,
          iconView: t.iconView,
        })),
    [features],
  );

  // Render-time auto-launch (guarded; runs once). NOT a useEffect. Launches the
  // default (getting-started) tour, which is already the active tour at mount.
  const eligible = hydrated && layout === "modern" && !isPopout && !tourSeen && steps.length > 0;
  if (eligible && !autoHandled) {
    setAutoHandled(true);
    setIsOpen(true);
    setIndex(0);
  }

  const start = useCallback((tourId?: string) => {
    setActiveTourId(tourId ?? DEFAULT_TOUR_ID);
    setIndex(0);
    setIsOpen(true);
  }, []);
  const next = useCallback(() => setIndex((k) => clampStep(k + 1, steps.length)), [steps.length]);
  const back = useCallback(() => setIndex((k) => clampStep(k - 1, steps.length)), [steps.length]);
  const skip = useCallback(() => {
    setIsOpen(false);
    setSettings((s) => ({ ...s, tourSeen: true }));
  }, [setSettings]);
  const done = useCallback(() => {
    setIsOpen(false);
    setActiveTourId((id) => {
      setSettings((s) => ({
        ...s,
        tourSeen: true,
        completedTours: Array.from(new Set([...(s.completedTours ?? []), id])),
      }));
      return id;
    });
  }, [setSettings]);
  const showMe = useCallback((step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => {
    if (step.view) navigate(step.view);
  }, []);

  return {
    isOpen,
    index,
    steps,
    activeTourTitleKey: activeTour.titleKey,
    catalogTours,
    completedTours: completedTours ?? [],
    start,
    next,
    back,
    skip,
    done,
    showMe,
  };
}
