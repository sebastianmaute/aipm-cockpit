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
  /** Null when nothing is open: there is no remaining work to cover. */
  estimateCoverage: number | null;
  divergent: boolean;
  explainer: { windowDays: number; distribution: Int32Array; trials: number; markers: SimMarkers };
};

/** True when the earned-value SPI and the simulated chance on time tell opposite stories. */
export function isDivergent(spi: number | null, chance: number | null): boolean {
  if (spi === null || chance === null) return false;
  return (spi >= SPI_AHEAD && chance < DIVERGENT_LOW_CHANCE) || (spi < SPI_BEHIND && chance >= DIVERGENT_HIGH_CHANCE);
}

/** A simulated chance as a whole percent. A chance that rounds to 100 but is under 1
 *  is "above 99", one that rounds to 0 but is over 0 is "below 1": a simulation must
 *  not read as certainty. Exactly 1 and exactly 0 stay 100 and 0. */
export type ChancePercent = { kind: "exact"; percent: number } | { kind: "above99" } | { kind: "below1" };

export function chancePercent(chance: number): ChancePercent {
  const percent = Math.round(chance * 100);
  if (percent >= 100 && chance < 1) return { kind: "above99" };
  if (percent <= 0 && chance > 0) return { kind: "below1" };
  return { kind: "exact", percent };
}

/** The signature of everything that changes the KPI tile's height with the simulation on: the chance
 *  cell, the divergence line and the coverage line (absent when nothing is open). While the simulation
 *  is null it is the switch state plus the gap's kind, so the gap line's appearance re-measures too.
 *  `useMeasuredHeights` has no ResizeObserver, so an input missing here leaves the tile at a stale height. */
export function kpiContentKey(sim: KpiSimulation | null, simulationOn: boolean, gap: KpiSimulationGap | null, pending = false): string {
  if (pending) return "sim:pending";
  return sim
    ? `sim:${sim.divergent}:${sim.chanceOnTime !== null}:${sim.estimateCoverage !== null}`
    : `sim:${simulationOn}:${gap?.kind ?? "none"}`;
}

/** The same for the Forecast tile: which of its slots exist (placeholders, the gap line alone, the
 *  headline and bar or the beyond-horizon line, the P95 wording) and how many at-risk rows render.
 *  Null = waiting for holidays (or the switch off, when the tile is not rendered at all). */
export function forecastTileContentKey(forecast: AppForecast | null, atRiskCount: number): string {
  if (forecast === null) return "fc:pending";
  if (forecast.kind === "insufficient") return "fc:insufficient";
  return `fc:${forecast.p80 === null ? "beyond" : "p80"}:${forecast.p95 === null}:${atRiskCount}`;
}

/** The Milestones tile's chips and explainer line: how many chips draw (0 = no chip, no explainer). */
export function milestoneChipsContentKey(forecast: AppForecast | null): string {
  const n = forecast?.kind === "forecast" ? forecast.milestones.filter((m) => m.state === "chance").length : 0;
  return `ms:${n}`;
}

/** Why the switch is on but the strip shows no simulated cell. */
export type KpiSimulationGap =
  | { kind: "finished"; finished: number; needed: number }
  | { kind: "days"; days: number; needed: number }
  | { kind: "beyond" };

/** The reason `kpiSimulation` returns null, or null when it does not. Too few
 *  finished tasks is named first when both floors are short. */
export function kpiSimulationGap(f: AppForecast): KpiSimulationGap | null {
  if (f.kind === "insufficient") {
    return f.finished < f.neededFinished
      ? { kind: "finished", finished: f.finished, needed: f.neededFinished }
      : { kind: "days", days: f.days, needed: f.neededDays };
  }
  return f.p80 === null ? { kind: "beyond" } : null;
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
