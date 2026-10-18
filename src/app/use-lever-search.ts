"use client";

// The lever search (§502, part 4) run off the render path: each probe is one 10,000-trial run (about 50-70 ms), so the
// search advances one probe per macrotask and the page stays responsive. State is only ever set from a timer callback
// (`react-hooks/set-state-in-effect` is banned), and a result is shown only while it belongs to the CURRENT input,
// goal and target list — a stale one reads as "pending" at render. What a NEW input must also drop is the per-goal cache:
// `sameRunOf` is that reset (it keeps the finished goals only for the same input and target list).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPlanSettled, planWhatItTakes, probeInput, settlePlan, stepPlan, type LeverTarget, type WhatItTakes, type WhatItTakesPlan,
} from "./forecast-levers";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ScheduleContext } from "./forecast-added-people";
import type { TargetConfidence } from "./forecast-target";

export type LeverValue = WhatItTakes | "pending";
export type LeverSearchArgs = {
  input: ScenarioRunInput | null;
  targets: readonly LeverTarget[];
  goal: TargetConfidence;
  enabled: boolean;
};

const EMPTY: ReadonlyMap<string, LeverValue> = new Map();

export function leverKey(target: LeverTarget): string {
  return target.kind === "milestone" ? `m:${target.id}` : "plan";
}

/** The targets a `targetsKey` names: the effect keys on the string, so a new-but-equal list never restarts the run. */
function targetsFromKey(key: string): LeverTarget[] {
  if (key === "") return [];
  return key.split("|").map((part): LeverTarget => (part === "plan" ? { kind: "planEnd" } : { kind: "milestone", id: Number(part.slice(2)) }));
}

/** At most this many finished goals are kept per (input, targets): the three target confidences. */
const MAX_CACHED_GOALS = 3;

type Values = ReadonlyMap<string, LeverValue>;
/** What the runs for ONE (input, targets) know: finished goals (oldest first, at most MAX_CACHED_GOALS) and the
 *  partial result of the goal now searching. A new input or target list replaces the whole thing. */
type Published = {
  input: ScenarioRunInput;
  targetsKey: string;
  finished: ReadonlyMap<TargetConfidence, Values>;
  running: { goal: TargetConfidence; values: Values } | null;
};

/**
 * The key is `leverKey(target)`. A target whose As-is chance is null (an overdue milestone, one with nothing linked,
 * an insufficient run, a plan end with no valid date) is OMITTED once the run has started — `whatItTakesSync` is null
 * for it. Until then every target reads "pending". `enabled: false` or a null input gives an empty map and schedules
 * nothing. Finished runs are kept per goal (at most three) for the current input identity and target list, so switching
 * back to a goal already searched, or re-enabling the same run, returns its values at once and searches nothing; a new
 * input or target list clears them.
 */
export function useLeverSearch({ input, targets, goal, enabled }: LeverSearchArgs): ReadonlyMap<string, LeverValue> {
  const targetsKey = useMemo(() => targets.map(leverKey).join("|"), [targets]);
  const [published, setPublished] = useState<Published | null>(null);
  // Which goals are finished for the current run (the effect's early exit; the values live in `published`).
  const finishedRef = useRef<{ input: ScenarioRunInput; targetsKey: string; goals: TargetConfidence[] } | null>(null);

  useEffect(() => {
    if (!enabled || input === null || targetsKey === "") return undefined;
    const run = input;
    const known = finishedRef.current;
    const sameRun = known !== null && known.input === input && known.targetsKey === targetsKey;
    if (sameRun && known.goals.includes(goal)) return undefined;
    if (!sameRun) finishedRef.current = { input, targetsKey, goals: [] };
    const list = targetsFromKey(targetsKey);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let context: ScheduleContext | null = null;
    const probes = probeInput(run);
    const plans = new Map<string, WhatItTakesPlan>();
    const values = new Map<string, LeverValue>();

    const sameRunOf = (prev: Published | null) => (prev !== null && prev.input === run && prev.targetsKey === targetsKey ? prev.finished : new Map<TargetConfidence, Values>());
    const publish = () => setPublished((prev) => ({
      input: run, targetsKey, finished: sameRunOf(prev), running: { goal, values: new Map(values) },
    }));
    const publishFinished = () => setPublished((prev) => {
      const finished = new Map(sameRunOf(prev));
      finished.delete(goal);
      finished.set(goal, new Map(values));
      while (finished.size > MAX_CACHED_GOALS) finished.delete(finished.keys().next().value as TargetConfidence);
      return { input: run, targetsKey, finished, running: null };
    });
    const schedule = () => { timer = setTimeout(step, 0); };

    function prepare(): void {
      const comparison = computeScenarioComparison(run, []);
      context = comparison.context;
      for (const target of list) {
        const plan = planWhatItTakes(run, comparison.context, target, goal, comparison.asIs);
        if (plan === null) continue;
        if (isPlanSettled(plan)) values.set(leverKey(target), settlePlan(plan));
        else { plans.set(leverKey(target), plan); values.set(leverKey(target), "pending"); }
      }
    }

    function probeOnce(): void {
      const first = plans.entries().next();
      if (first.done || context === null) return;
      const [key, plan] = first.value;
      const next = stepPlan(plan, probes, context);
      if (!isPlanSettled(next)) { plans.set(key, next); return; }
      plans.delete(key);
      values.set(key, settlePlan(next));
    }

    function step(): void {
      if (cancelled) return;
      if (context === null) prepare(); else probeOnce();
      if (cancelled) return;
      if (plans.size > 0) {
        publish();
        schedule();
        return;
      }
      publishFinished();
      const fin = finishedRef.current;
      if (fin !== null && fin.input === run && fin.targetsKey === targetsKey) {
        fin.goals = [...fin.goals.filter((g) => g !== goal), goal].slice(-MAX_CACHED_GOALS);
      }
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [input, targetsKey, goal, enabled]);

  return useMemo(() => {
    if (!enabled || input === null) return EMPTY;
    if (published !== null && published.input === input && published.targetsKey === targetsKey) {
      const finished = published.finished.get(goal);
      if (finished !== undefined) return finished;
      if (published.running !== null && published.running.goal === goal) return published.running.values;
    }
    return new Map<string, LeverValue>(targetsFromKey(targetsKey).map((t) => [leverKey(t), "pending"]));
  }, [enabled, input, goal, targetsKey, published]);
}
