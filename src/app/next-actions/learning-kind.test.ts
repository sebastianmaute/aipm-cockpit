import { describe, expect, it } from "vitest";
import { canonicalLearningKind, learningKindOf, LEARNING_WHY_ALIAS } from "./learning-kind";
import { taskDueProvider } from "./providers/task-due";
import type { ActionInput } from "./types";
import type { Task } from "../types";
import { en } from "../i18n";

function input(tasks: Task[]): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: {} as ActionInput["dashboard"], features: [], today: "2026-06-15", now: new Date("2026-06-15T00:00:00Z"),
    reminderLeadDays: 7, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
    projectName: "",
  } as ActionInput;
}
const base = { assignee: "", assigneeEmail: "", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium", blockers: "", description: "" } as const;

// §778 — the providers pick a singular why key by count ("…One"), so one signal
// was learned and overridden as two kinds. The learning kind now ignores that
// display-only split.
describe("learningKindOf (§778)", () => {
  it("gives a task 1 and a task 3 working days overdue the same learning kind", () => {
    // 2026-06-15 is a Monday: due Friday → 1 working day overdue, due Wednesday → 3.
    const [one] = taskDueProvider.provide(input([{ ...base, id: 1, taskName: "A", dueDate: "2026-06-12" } as Task]));
    const [three] = taskDueProvider.provide(input([{ ...base, id: 2, taskName: "B", dueDate: "2026-06-10" } as Task]));
    expect(one.why.key).toBe("actionTaskWhyOverdueOne");
    expect(three.why.key).toBe("actionTaskWhyOverdue");
    expect(learningKindOf(one)).toBe("task-due:actionTaskWhyOverdue");
    expect(learningKindOf(three)).toBe(learningKindOf(one));
  });

  it("gives a task due in 1 and in 2 working days the same learning kind", () => {
    const [one] = taskDueProvider.provide(input([{ ...base, id: 1, taskName: "A", dueDate: "2026-06-16" } as Task]));
    const [two] = taskDueProvider.provide(input([{ ...base, id: 2, taskName: "B", dueDate: "2026-06-17" } as Task]));
    expect(one.why.key).toBe("actionTaskWhySoonOne");
    expect(two.why.key).toBe("actionTaskWhySoon");
    expect(learningKindOf(one)).toBe(learningKindOf(two));
  });
});

describe("canonicalLearningKind (§778)", () => {
  it("maps a stored singular kind to its plural sibling and leaves others alone", () => {
    expect(canonicalLearningKind("raid:actionRaidWhyReviewStaleOne")).toBe("raid:actionRaidWhyReviewStale");
    expect(canonicalLearningKind("raid:actionRaidWhyReviewStale")).toBe("raid:actionRaidWhyReviewStale");
    expect(canonicalLearningKind("milestone:actionMilestoneWhyOverdue")).toBe("milestone:actionMilestoneWhyOverdue");
  });
  it("passes through a kind with no why key, or a prototype name, unchanged", () => {
    expect(canonicalLearningKind("legacykind")).toBe("legacykind");
    expect(canonicalLearningKind("raid:constructor")).toBe("raid:constructor");
    expect(canonicalLearningKind("raid:toString")).toBe("raid:toString");
  });
});

// §778 (e) — derived, so a new provider cannot reintroduce the split: every
// count-variant why key in the EN dictionary ("…One", "…Below1") is aliased, and
// every alias points at a real key that is itself canonical.
describe("LEARNING_WHY_ALIAS covers every count variant (§778)", () => {
  const whyKeys = Object.keys(en).filter((k) => /^action[A-Za-z]*Why[A-Za-z0-9]*$/.test(k));
  const variants = whyKeys.filter((k) => /(One|Below1)$/.test(k));

  it("finds the variants it is meant to cover", () => {
    // Reproduce: grep -cE "^\s*action[A-Za-z]*Why[A-Za-z0-9]*(One|Below1):" src/app/i18n.ts
    expect(variants.length).toBeGreaterThanOrEqual(7);
  });
  it("aliases every variant why key", () => {
    expect(variants.filter((k) => !Object.hasOwn(LEARNING_WHY_ALIAS, k))).toEqual([]);
  });
  it("aliases only real keys, onto real canonical keys", () => {
    for (const [from, to] of Object.entries(LEARNING_WHY_ALIAS)) {
      expect(Object.hasOwn(en, from), from).toBe(true);
      expect(Object.hasOwn(en, to), to).toBe(true);
      expect(Object.hasOwn(LEARNING_WHY_ALIAS, to), `${to} is itself aliased`).toBe(false);
    }
  });
  it("leaves every non-variant why key as its own kind", () => {
    const moved = whyKeys
      .filter((k) => !variants.includes(k))
      .filter((k) => canonicalLearningKind(`raid:${k}`) !== `raid:${k}`);
    expect(moved).toEqual([]);
  });
});
