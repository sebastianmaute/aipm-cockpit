"use client";

// The per-project "Use Monte Carlo forecasting" switch (§502). One control, two
// places: the Dashboard's Budget burn tile and the Edit project dialog. Both
// write `settingsOverrides.forecast`; this component only draws the toggle.

import { ToggleButton } from "./toggle-button";
import { PresentationChartLineIcon } from "./icons";
import { t, type Lang } from "./i18n";

interface SimulationSwitchProps {
  lang: Lang;
  pressed: boolean;
  onToggle: () => void;
  className?: string;
}

export function SimulationSwitch({ lang, pressed, onToggle, className }: SimulationSwitchProps) {
  return (
    <ToggleButton
      lang={lang}
      pressed={pressed}
      onToggle={onToggle}
      icon={<PresentationChartLineIcon aria-hidden="true" className="h-3.5 w-3.5" />}
      className={className}
    >
      {t(lang, "simulationShow")}
    </ToggleButton>
  );
}
