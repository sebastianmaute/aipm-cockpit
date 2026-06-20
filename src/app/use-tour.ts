"use client";

// Guided-tour open/index state + per-device tourSeen flag + render-time
// auto-launch (NO useEffect setState — banned). Modern-shell only.
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { clampStep, visibleSteps, type TourStep } from "./app-tour";
import type { FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";

interface UseTourArgs {
  layout: "modern" | "classic";
  isPopout: boolean;
  hydrated: boolean;
  tourSeen: boolean | undefined;
  features: readonly FeatureModuleId[];
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export interface UseTour {
  isOpen: boolean;
  index: number;
  steps: TourStep[];
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  done: () => void;
  showMe: (step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => void;
}

export function useTour({ layout, isPopout, hydrated, tourSeen, features, setSettings }: UseTourArgs): UseTour {
  const steps = useMemo(() => visibleSteps(features), [features]);
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [autoHandled, setAutoHandled] = useState(false);

  // Render-time auto-launch (guarded; runs once). NOT a useEffect.
  const eligible = hydrated && layout === "modern" && !isPopout && !tourSeen && steps.length > 0;
  if (eligible && !autoHandled) {
    setAutoHandled(true);
    setIsOpen(true);
    setIndex(0);
  }

  const markSeen = useCallback(() => setSettings((s) => ({ ...s, tourSeen: true })), [setSettings]);

  const start = useCallback(() => { setIndex(0); setIsOpen(true); }, []);
  const next = useCallback(() => setIndex((k) => clampStep(k + 1, steps.length)), [steps.length]);
  const back = useCallback(() => setIndex((k) => clampStep(k - 1, steps.length)), [steps.length]);
  const skip = useCallback(() => { setIsOpen(false); markSeen(); }, [markSeen]);
  const done = useCallback(() => { setIsOpen(false); markSeen(); }, [markSeen]);
  const showMe = useCallback((step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => {
    if (step.view) navigate(step.view);
  }, []);

  return { isOpen, index, steps, start, next, back, skip, done, showMe };
}
