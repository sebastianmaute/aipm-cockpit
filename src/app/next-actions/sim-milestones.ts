// src/app/next-actions/sim-milestones.ts
//
// §502 part 2 (spec §3.3) — the simulated "unlikely on time" milestone signal.
// Pure and i18n-free, like the engine. It is NOT a provider: its actions are
// merged into the GROUPS after `groupNextActions` (use-next-actions.ts), so they
// never enter the flat list that notifications, learning and the AI context
// read. A simulated chance must not pass for a measured signal anywhere.
import type { AppForecast } from "../forecast/app-forecast";
import { chancePercent } from "../kpi-simulation";
import type { Milestone } from "../types";
import type { ActionGroup } from "./group";
import { TIER_NOW, TIER_SOON } from "./score";
import type { SuggestedAction } from "./types";

/** A milestone whose simulated chance is below this raises the signal. */
export const SIM_UNLIKELY_BELOW = 0.5;

/** Always inside the soon band [TIER_SOON, TIER_NOW - 1]: a simulated nudge never
 *  outranks a measured `now` item, and a lower chance ranks higher. */
function simScore(chance: number): number {
  const span = TIER_NOW - 1 - TIER_SOON;
  return TIER_SOON + Math.round(((SIM_UNLIKELY_BELOW - chance) / SIM_UNLIKELY_BELOW) * span);
}

function simAction(m: Milestone, chance: number): SuggestedAction {
  const pct = chancePercent(chance);
  // `chance < SIM_UNLIKELY_BELOW` rules out "above99"; only "<1%" needs its own copy.
  const below1 = pct.kind === "below1";
  const percent = pct.kind === "exact" ? pct.percent : 0;
  return {
    id: `forecast-sim:milestone:${m.id}`,
    source: "forecast-sim",
    moduleId: "milestones",
    title: below1
      ? { key: "actionForecastSimTitleBelow1", params: [m.name] }
      : { key: "actionForecastSimTitle", params: [m.name, percent] },
    why: below1
      ? { key: "actionForecastSimWhyBelow1", params: [m.date] }
      : { key: "actionForecastSimWhy", params: [percent, m.date] },
    score: simScore(chance),
    tier: "soon",
    cta: { kind: "open", view: "forecast", id: m.id },
  };
}

/** One action per not-achieved milestone whose simulated chance is below
 *  `SIM_UNLIKELY_BELOW`; none for an insufficient forecast. Snoozed ids are
 *  dropped here — `computeNextActions` never sees these actions to filter them. */
export function buildSimMilestoneActions(args: {
  forecast: AppForecast;
  milestones: readonly Milestone[];
  dismissed: ReadonlySet<string>;
}): SuggestedAction[] {
  const { forecast, milestones, dismissed } = args;
  if (forecast.kind !== "forecast") return [];
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const out: SuggestedAction[] = [];
  for (const c of forecast.milestones) {
    if (c.state !== "chance" || c.chance >= SIM_UNLIKELY_BELOW) continue;
    const m = byId.get(c.id);
    if (!m || m.achievedDate) continue;
    const a = simAction(m, c.chance);
    if (!dismissed.has(a.id)) out.push(a);
  }
  return out;
}

const byScoreThenId = (x: SuggestedAction, y: SuggestedAction) => y.score - x.score || x.id.localeCompare(y.id);
const byScoreThenKey = (x: ActionGroup, y: ActionGroup) => y.score - x.score || x.key.localeCompare(y.key);

/** Merge the sim actions into already-built groups. A group for the same
 *  milestone (`milestones:<id>`) takes the action as an extra reason — its
 *  primary, score and tier stay the measured ones. Otherwise the action forms
 *  its own group. Sorted exactly as `groupNextActions` sorts. Returns new arrays. */
export function mergeSimActions(groups: readonly ActionGroup[], sim: readonly SuggestedAction[]): ActionGroup[] {
  const extraByKey = new Map<string, SuggestedAction[]>();
  const own: ActionGroup[] = [];
  const keys = new Set(groups.map((g) => g.key));
  for (const a of sim) {
    // The measured milestone group's key is `${cta.view}:${cta.id}` with view "milestones".
    const key = a.cta.kind === "open" ? `milestones:${a.cta.id}` : a.id;
    if (keys.has(key)) extraByKey.set(key, [...(extraByKey.get(key) ?? []), a]);
    else own.push({ key: a.id, primary: a, extra: [], score: a.score, tier: a.tier });
  }
  const merged = groups.map((g) => {
    const add = extraByKey.get(g.key);
    return add ? { ...g, extra: [...g.extra, ...add].sort(byScoreThenId) } : g;
  });
  return [...merged, ...own].sort(byScoreThenKey);
}
