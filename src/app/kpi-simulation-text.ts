// Words for the simulation gap (§502), shared by the KPI strip and the Forecast tile so both say the same thing.

import { localeFor } from "./date-format";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { type Lang, t } from "./i18n";
import type { KpiSimulationGap } from "./kpi-simulation";

/** The line shown in place of a simulated value: which history floor is short, or that P80 lies
 *  beyond the horizon. Plain muted text at every call site, NOT sim-styled: it is a statement about
 *  the data, not a simulated value. */
export function simulationGapText(lang: Lang, gap: KpiSimulationGap): string {
  switch (gap.kind) {
    case "finished": return t(lang, "kpiSimNeedsFinished", gap.finished, gap.needed);
    case "days": return t(lang, "kpiSimNeedsDays", gap.days, gap.needed);
    case "beyond": return t(lang, "kpiSimBeyondHorizon", MAX_HORIZON_WORKING_DAYS.toLocaleString(localeFor(lang)));
  }
}
