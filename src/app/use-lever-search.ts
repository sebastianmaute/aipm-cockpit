"use client";

// The lever search (§502, part 4) run off the render path: each probe is one 10,000-trial run (about 50-70 ms), so the
// search advances one probe per macrotask and the page stays responsive. State is only ever set from a timer callback
// (`react-hooks/set-state-in-effect` is banned), and a result is shown only while it belongs to the CURRENT input,
// goal and target list — a stale one reads as "pending" at render, with no reset needed.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPlanSettled, planWhatItTakes, settlePlan, stepPlan, type LeverTarget, type WhatItTakes, type WhatItTakesPlan,
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

/** What a settled (or partly settled) run knows, and which run it belongs to. */
type Published = {
  input: ScenarioRunInput;
  goal: TargetConfidence;
  targetsKey: string;
  values: ReadonlyMap<string, LeverValue>;
};

/**
 * The key is `leverKey(target)`. A target whose As-is chance is null (an overdue milestone, one with nothing linked,
 * an insufficient run, a plan end with no valid date) is OMITTED once the run has started — `whatItTakesSync` is null
 * for it. Until then every target reads "pending". `enabled: false` or a null input gives an empty map and schedules
 * nothing. Only the LAST finished run is kept, per (input identity, goal, targets), so re-enabling the same one does not search again.
 */
export function useLeverSearch({ input, targets, goal, enabled }: LeverSearchArgs): ReadonlyMap<string, LeverValue> {
  const targetsKey = useMemo(() => targets.map(leverKey).join("|"), [targets]);
  const [published, setPublished] = useState<Published | null>(null);
  const finishedRef = useRef<{ input: ScenarioRunInput; goal: TargetConfidence; targetsKey: string } | null>(null);

  useEffect(() => {
    if (!enabled || input === null || targetsKey === "") return undefined;
    const run = input;
    const done = finishedRef.current;
    if (done !== null && done.input === input && done.goal === goal && done.targetsKey === targetsKey) return undefined;
    const list = targetsFromKey(targetsKey);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let context: ScheduleContext | null = null;
    const plans = new Map<string, WhatItTakesPlan>();
    const values = new Map<string, LeverValue>();

    const publish = () => setPublished({ input: run, goal, targetsKey, values: new Map(values) });
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
      const next = stepPlan(plan, run, context);
      if (!isPlanSettled(next)) { plans.set(key, next); return; }
      plans.delete(key);
      values.set(key, settlePlan(next));
    }

    function step(): void {
      if (cancelled) return;
      if (context === null) prepare(); else probeOnce();
      if (cancelled) return;
      publish();
      if (plans.size > 0) schedule();
      else finishedRef.current = { input: run, goal, targetsKey };
    }

    finishedRef.current = null;
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [input, targetsKey, goal, enabled]);

  return useMemo(() => {
    if (!enabled || input === null) return EMPTY;
    if (published !== null && published.input === input && published.goal === goal && published.targetsKey === targetsKey) {
      return published.values;
    }
    return new Map<string, LeverValue>(targetsFromKey(targetsKey).map((t) => [leverKey(t), "pending"]));
  }, [enabled, input, goal, targetsKey, published]);
}
