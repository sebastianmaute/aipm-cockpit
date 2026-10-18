// The forecast's chance, date and "what it would take" wording (§502), React-free so the export rows
// (`export-forecast-decision-section.ts`) phrase a lever exactly as the badges do (`forecast-lever-cell.tsx`):
// one wording, two surfaces. `forecast-tables.tsx` re-exports `formatChance` / `formatWhen` for its callers.

import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear, formatHours } from "./forecast-format";
import type { TargetConfidence } from "./forecast-target";
import type { WhatItTakes } from "./forecast-levers";

const PERCENT = 100;

/** Whole percent; a chance short of certain that rounds to 100 reads "≥ 99 %". */
export function formatChance(chance: number, lang: Lang): string {
  const pct = Math.round(chance * PERCENT);
  if (chance < 1 && pct >= PERCENT) return t(lang, "forecastNearlyCertain");
  return t(lang, "forecastPercent", pct);
}

/** A When date, or "> 5 y" when the percentile ran past the horizon. */
export function formatWhen(date: string | null, lang: Lang): string {
  return date === null ? t(lang, "forecastBeyond") : formatDayMonthYear(date, localeFor(lang));
}

/** The lever texts in order — reaching levers first (prioritising, then people, then tasks; the later ones read
 *  "or …"), then what does not reach — and whether any lever reaches the goal. */
export function leverTexts(lang: Lang, r: WhatItTakes, goal: TargetConfidence): { texts: string[]; anyReaches: boolean } {
  const reach: string[] = [];
  const notes: string[] = [];
  if (r.prioritised !== null && r.prioritised >= goal / PERCENT) {
    reach.push(t(lang, "forecastLeverPrioritise", formatChance(r.prioritised, lang)));
  }
  if (r.people.state === "reaches") reach.push(tPlural(lang, "forecastLeverPeople", r.people.n, r.people.n));
  else if (r.people.state === "out-of-reach") notes.push(t(lang, "forecastLeverPeopleOutOfReach"));
  else if (r.people.state === "inert" && r.people.reason === "needs-booked-hours") notes.push(t(lang, "forecastLeverNeedsHours"));
  if (r.tasks.state === "reaches") {
    const tasks = tPlural(lang, "forecastLeverTasks", r.tasks.n, r.tasks.n);
    reach.push(r.tasks.hours === null ? tasks : t(lang, "forecastLeverWithHours", tasks, formatHours(r.tasks.hours, localeFor(lang))));
  }
  else if (r.tasks.state === "out-of-reach") notes.push(t(lang, "forecastLeverTasksOutOfReach"));
  else if (r.tasks.state === "inert" && r.tasks.reason === "too-few-tasks") notes.push(t(lang, "forecastLeverTasksTooFew"));
  if (r.prioritised !== null && r.prioritised < goal / PERCENT) notes.push(t(lang, "forecastLeverPrioritiseShort"));
  const texts = [...reach.map((s, i) => (i === 0 ? s : t(lang, "forecastLeverOr", s))), ...notes];
  return { texts, anyReaches: reach.length > 0 };
}
