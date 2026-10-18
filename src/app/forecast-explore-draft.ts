// An Explore request as an unsaved scenario (§502 part 4, spec §3.4): the name, the one change row of the chosen
// lever, and the other reaching lever as the alternative. Each row is the change the lever search probed
// (`leverChange`, people sized by `placeholderWho` from the comparison's context), so the draft's column shows the
// number its row did. React-free; takes `lang` only to format the names.

import { type Lang, t, tPlural } from "./i18n";
import type { ScheduleContext } from "./forecast-added-people";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import { SCENARIO_NAME_MAX, isScenarioNameTaken, type ForecastScenario } from "./forecast-scenarios";
import { leverChange, placeholderWho, type LeverKind, type LeverTarget } from "./forecast-levers";
import type { ScenarioDraft } from "./use-forecast-scenarios";
import type { ForecastDraftRequest } from "./workspace-tab-context";

const ELLIPSIS = "…";
type Lever = { kind: LeverKind; n: number };

export function leverPhrase(lang: Lang, kind: LeverKind, n: number): string {
  return kind === "people" ? tPlural(lang, "forecastExplorePeople", n, n) : tPlural(lang, "forecastLeverTasks", n, n);
}

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/** The draft name within `budget` characters: the milestone part is shortened with an ellipsis, the lever kept. */
function fitName(lang: Lang, targetName: string, phrase: string, budget: number): string {
  const full = t(lang, "forecastExploreDraftName", targetName, phrase);
  if (full.length <= budget) return full;
  const room = Math.max(1, budget - (full.length - targetName.length) - ELLIPSIS.length);
  return t(lang, "forecastExploreDraftName", `${cutWhole(targetName, room).trimEnd()}${ELLIPSIS}`, phrase);
}

/** The first `room` UTF-16 units of `s` (the name limit counts units), never ending on half a surrogate pair. */
function cutWhole(s: string, room: number): string {
  const cut = s.slice(0, room);
  const last = cut.charCodeAt(cut.length - 1);
  const splitsPair = last >= HIGH_SURROGATE_MIN && last <= HIGH_SURROGATE_MAX && s.length > cut.length;
  return splitsPair ? cut.slice(0, -1) : cut;
}

/**
 * A default name that always passes Save: at most SCENARIO_NAME_MAX characters, and free in `list` — a taken one
 * gets " (2)", " (3)", … (the suffix counts toward the limit, so the milestone part gives way to it).
 */
export function exploreDraftName(lang: Lang, targetName: string, phrase: string, list: readonly ForecastScenario[]): string {
  for (let k = 1; ; k += 1) {
    const suffix = k === 1 ? "" : ` (${k})`;
    const name = `${fitName(lang, targetName, phrase, SCENARIO_NAME_MAX - suffix.length)}${suffix}`;
    if (!isScenarioNameTaken(list, name, null)) return name;
  }
}

function leverSeed(
  lang: Lang, target: LeverTarget, targetName: string, lever: Lever, context: ScheduleContext, input: ScenarioRunInput,
  list: readonly ForecastScenario[],
): ScenarioDraft | null {
  const sized = lever.kind === "people" ? placeholderWho(context, input.directory) : null;
  if (lever.kind === "people" && sized === null) return null;
  // The engine's default label is English; the draft the PM sees carries the translated placeholder name.
  const who = sized === null ? null : { ...sized, label: t(lang, "forecastScenarioPlaceholder") };
  return {
    name: exploreDraftName(lang, targetName, leverPhrase(lang, lever.kind, lever.n), list),
    changes: [leverChange(lever.kind, lever.n, target, who, input.today)],
  };
}

export type ExploreSeeds = {
  seed: ScenarioDraft;
  /** What `seed` stands for ("+2 people on Go-live"), so the editor can offer it back after a swap. */
  seedLabel: string;
  alt?: { label: string; seed: ScenarioDraft };
};

/** The seeds an Explore request opens; null when its milestone is gone or neither lever can be drafted. */
export function exploreSeeds(
  lang: Lang, req: ForecastDraftRequest, context: ScheduleContext, input: ScenarioRunInput, list: readonly ForecastScenario[],
): ExploreSeeds | null {
  const { target } = req;
  const name = target.kind === "milestone"
    ? input.milestones.find((m) => m.id === target.id)?.name
    : t(lang, "forecastRangePlanEnd");
  if (name === undefined) return null;
  const label = (lever: Lever) => t(lang, "forecastExploreAltLabel", leverPhrase(lang, lever.kind, lever.n), name);
  const first = { lever: req, seed: leverSeed(lang, target, name, req, context, input, list) };
  const second = req.alt === null ? null : { lever: req.alt, seed: leverSeed(lang, target, name, req.alt, context, input, list) };
  const usable = [first, second].flatMap((x) => (x !== null && x.seed !== null ? [{ lever: x.lever, seed: x.seed }] : []));
  if (usable.length === 0) return null;
  const [main, other] = usable;
  return {
    seed: main.seed,
    seedLabel: label(main.lever),
    alt: other === undefined ? undefined : { label: label(other.lever), seed: other.seed },
  };
}
