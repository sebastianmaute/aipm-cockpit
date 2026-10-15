// The KPI strip's simulated cells (§502): pure, i18n-free, React-free.

import type { AppForecast } from "./forecast/app-forecast";
import type { SimMarkers } from "./sim-explainer";

/** SPI at or above this with a chance on time under `DIVERGENT_LOW_CHANCE` reads as ahead-but-doubtful. */
const SPI_AHEAD = 1.0;
const DIVERGENT_LOW_CHANCE = 0.5;
/** SPI under this with a chance on time at or above `DIVERGENT_HIGH_CHANCE` reads as behind-but-likely. */
const SPI_BEHIND = 0.9;
const DIVERGENT_HIGH_CHANCE = 0.8;

export type KpiSimulation = {
  /** ISO date by which 8 in 10 simulated runs finished. */
  p80: string;
  chanceOnTime: number | null;
  estimateCoverage: number;
  divergent: boolean;
  explainer: { windowDays: number; distribution: Int32Array; trials: number; markers: SimMarkers };
};

/** True when the earned-value SPI and the simulated chance on time tell opposite stories. */
export function isDivergent(spi: number | null, chance: number | null): boolean {
  if (spi === null || chance === null) return false;
  return (spi >= SPI_AHEAD && chance < DIVERGENT_LOW_CHANCE) || (spi < SPI_BEHIND && chance >= DIVERGENT_HIGH_CHANCE);
}

/** The strip's simulation, or null when the forecast is insufficient or P80 lies beyond the horizon. */
export function kpiSimulation(f: AppForecast, spi: number | null): KpiSimulation | null {
  if (f.kind !== "forecast" || f.p80 === null) return null;
  return {
    p80: f.p80,
    chanceOnTime: f.chanceOnTime,
    estimateCoverage: f.estimateCoverage,
    divergent: isDivergent(spi, f.chanceOnTime),
    explainer: { windowDays: f.windowDays, distribution: f.distribution, trials: f.trials, markers: f.markers },
  };
}
