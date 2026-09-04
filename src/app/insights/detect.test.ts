import { describe, it, expect } from "vitest";
import type { Task, Milestone, RaidItem, BudgetBucket, ResourcePlan, Role, Resource } from "../types";
import {
  CORE_INSIGHT_TYPES,
  detectInsights,
  type InsightInput,
  MILESTONE_SLIP_MIN_REBASELINES,
  STALLED_WORK_MIN,
  BUDGET_VARIANCE_PCT,
  RAID_AGING_DAYS,
  STALE_DAYS,
} from "./detect";
import { sanitizeInsights } from "./sanitize-insights";

const TODAY = "2026-06-15";

// --- minimal factories (only the fields each detector reads) ---------------
function task(over: Partial<Task>): Task {
  return {
    id: 1, taskName: "T", assignee: "", assigneeEmail: "",
    dueDate: "2026-06-01", lastUpdateDate: TODAY,
    priority: "Medium", status: "To Do", blockers: "", description: "",
    ...over,
  };
}
function milestone(over: Partial<Milestone>): Milestone {
  return { id: 1, name: "M", date: "2026-06-01", linkedTaskIds: [], ...over };
}
function raid(over: Partial<RaidItem>): RaidItem {
  return {
    id: 1, category: "R", title: "R1", status: "Open", linkedTaskIds: [],
    raisedDate: "2026-06-01", causedByRaidIds: [], stakeholderIds: [], ...over,
  };
}
function bucket(over: Partial<BudgetBucket>): BudgetBucket {
  return {
    id: 1, name: "B", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [], ...over,
  };
}
const PLAN: ResourcePlan = {
  startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR",
};

function input(over: Partial<InsightInput>): InsightInput {
  return {
    tasks: [], milestones: [], raid: [], budgets: [], roles: [], resources: [], plan: null,
    priorOverdueCount: null, timelogViolations: null, holidaySet: new Set<string>(), ...over,
  };
}
function detect(over: Partial<InsightInput>) {
  return detectInsights(input(over), TODAY);
}

describe("milestoneSlip", () => {
  it("pins the rebaseline threshold to the source", () => {
    expect(MILESTONE_SLIP_MIN_REBASELINES).toBe(2);
  });

  it("fires for a milestone overdue vs its target date", () => {
    const out = detect({ milestones: [milestone({ id: 7, name: "Go-live", date: "2026-06-01" })] });
    const slips = out.filter((i) => i.type === "milestoneSlip");
    expect(slips).toHaveLength(1);
    expect(slips[0].entityRef).toEqual({ view: "milestones", id: 7 });
    expect(slips[0].severity).toBe("high");
    expect(slips[0].data.name).toBe("Go-live");
  });

  it("does not fire for a future (on-track) milestone", () => {
    const out = detect({ milestones: [milestone({ date: "2026-12-01" })] });
    expect(out.filter((i) => i.type === "milestoneSlip")).toHaveLength(0);
  });

  it("does not fire for an achieved milestone", () => {
    const out = detect({ milestones: [milestone({ date: "2026-06-01", achievedDate: "2026-05-30" })] });
    expect(out.filter((i) => i.type === "milestoneSlip")).toHaveLength(0);
  });
});

describe("overdueTrend", () => {
  const overdueTasks = [
    task({ id: 1, dueDate: "2026-06-01" }),
    task({ id: 2, dueDate: "2026-06-02" }),
  ];

  it("fires when current overdue count exceeds the prior count", () => {
    const out = detect({ tasks: overdueTasks, priorOverdueCount: 1 });
    const trend = out.filter((i) => i.type === "overdueTrend");
    expect(trend).toHaveLength(1);
    expect(trend[0].key).toBe("overdueTrend");
    expect(trend[0].entityRef).toBeUndefined();
    expect(trend[0].severity).toBe("low");
    expect(trend[0].data.delta).toBe(1);
  });

  it("returns none when the prior count is unknown (null)", () => {
    const out = detect({ tasks: overdueTasks, priorOverdueCount: null });
    expect(out.filter((i) => i.type === "overdueTrend")).toHaveLength(0);
  });

  it("returns none when current is not greater than prior", () => {
    const out = detect({ tasks: overdueTasks, priorOverdueCount: 5 });
    expect(out.filter((i) => i.type === "overdueTrend")).toHaveLength(0);
  });
});

describe("stalledWork", () => {
  it("pins the stale-days threshold to the task-attention value", () => {
    expect(STALE_DAYS).toBe(14);
  });

  it("fires when active stale/blocked/dep-blocked tasks reach the threshold", () => {
    // blocked active tasks, one per required count
    const tasks = Array.from({ length: STALLED_WORK_MIN }, (_, i) =>
      task({ id: i + 1, blockers: "waiting on vendor" }));
    const out = detect({ tasks });
    const stalled = out.filter((i) => i.type === "stalledWork");
    expect(stalled).toHaveLength(1);
    expect(stalled[0].key).toBe("stalledWork");
    expect(stalled[0].entityRef).toBeUndefined();
    expect(stalled[0].severity).toBe("medium");
    expect(stalled[0].data.count).toBe(STALLED_WORK_MIN);
  });

  it("counts a stale task at exactly STALE_DAYS since last update", () => {
    // 14 days before TODAY = 2026-06-01
    const tasks = Array.from({ length: STALLED_WORK_MIN }, (_, i) =>
      task({ id: i + 1, lastUpdateDate: "2026-06-01" }));
    expect(detect({ tasks }).filter((i) => i.type === "stalledWork")).toHaveLength(1);
  });

  it("does not fire below the threshold", () => {
    const tasks = Array.from({ length: STALLED_WORK_MIN - 1 }, (_, i) =>
      task({ id: i + 1, blockers: "blocked" }));
    expect(detect({ tasks }).filter((i) => i.type === "stalledWork")).toHaveLength(0);
  });

  it("does not count merely-unassigned or finished tasks", () => {
    const tasks = [
      // unassigned but fresh — not stalled
      ...Array.from({ length: STALLED_WORK_MIN }, (_, i) =>
        task({ id: i + 1, assignee: "", lastUpdateDate: TODAY })),
      // blocked but Done — finished, excluded
      task({ id: 99, status: "Done", completedDate: TODAY, blockers: "blocked" }),
    ];
    expect(detect({ tasks }).filter((i) => i.type === "stalledWork")).toHaveLength(0);
  });
});

describe("budgetVariance", () => {
  it("returns none when plan is null even if budgets are passed", () => {
    const b = bucket({ allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 200 } }] });
    expect(detect({ budgets: [b], plan: null }).filter((i) => i.type === "budgetVariance")).toHaveLength(0);
  });

  it("fires when a bucket's variance meets the threshold", () => {
    const actual = 100 * (1 + BUDGET_VARIANCE_PCT / 100); // exactly at threshold
    const b = bucket({ name: "Dev PO", allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": actual } }] });
    const out = detect({ budgets: [b], plan: PLAN });
    const bv = out.filter((i) => i.type === "budgetVariance");
    expect(bv).toHaveLength(1);
    expect(bv[0].key).toBe("budgetVariance");
    expect(bv[0].entityRef).toBeUndefined();
    expect(bv[0].severity).toBe("medium");
    expect(bv[0].data.name).toBe("Dev PO");
  });

  it("does not fire under the threshold", () => {
    const b = bucket({ allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 105 } }] });
    expect(detect({ budgets: [b], plan: PLAN }).filter((i) => i.type === "budgetVariance")).toHaveLength(0);
  });

  // Regression guard for the empty-resources budgetFollowsPlan bug: when the plan
  // follows planning, the budget engine must derive budget HOURS from the linked
  // resource's planned capacity — forwarding roles/resources is required, else
  // budgetHours collapses to 0 and the overrun is silently dropped.
  it("fires when plan.budgetFollowsPlan and actual exceeds planned capacity", () => {
    // Jan 2026 = 22 workdays × 8h = 176h planned at 100% util; actual 220 → 25% > 10.
    const role: Role = { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 };
    const resource: Resource = { id: 5, firstName: "R5", lastName: "", roleId: 3, utilizationMode: "percent", utilization: { "2026-01": 100 } };
    const janPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR", budgetFollowsPlan: true };
    const b = bucket({
      name: "Capacity PO", startDate: "2026-01-01", endDate: "2026-01-31",
      allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 220 } }],
    });
    const out = detect({ budgets: [b], plan: janPlan, roles: [role], resources: [resource] });
    const bv = out.filter((i) => i.type === "budgetVariance");
    expect(bv).toHaveLength(1);
    expect(bv[0].data.name).toBe("Capacity PO");
  });
});

describe("raidAging", () => {
  it("pins the aging-days threshold to the source", () => {
    expect(RAID_AGING_DAYS).toBe(7);
  });

  it("fires for an active item past target with no recent update", () => {
    // targetDate past; last touch 14d ago >= 7
    const item = raid({ id: 3, title: "Vendor risk", status: "Open", targetDate: "2026-06-01", localModifiedAt: "2026-06-01T09:00:00Z" });
    const out = detect({ raid: [item] });
    const aging = out.filter((i) => i.type === "raidAging");
    expect(aging).toHaveLength(1);
    expect(aging[0].entityRef).toEqual({ view: "raid", id: 3 });
    expect(aging[0].severity).toBe("medium");
    expect(aging[0].data.name).toBe("Vendor risk");
  });

  it("fires at exactly RAID_AGING_DAYS since last update", () => {
    // 7 days before TODAY = 2026-06-08
    const item = raid({ targetDate: "2026-06-01", localModifiedAt: "2026-06-08T09:00:00Z" });
    expect(detect({ raid: [item] }).filter((i) => i.type === "raidAging")).toHaveLength(1);
  });

  it("does not fire for a recently updated item", () => {
    const item = raid({ targetDate: "2026-06-01", localModifiedAt: `${TODAY}T09:00:00Z` });
    expect(detect({ raid: [item] }).filter((i) => i.type === "raidAging")).toHaveLength(0);
  });

  it("does not fire for an inactive (closed) item", () => {
    const item = raid({ status: "Closed", closedDate: "2026-06-10", targetDate: "2026-06-01", localModifiedAt: "2026-06-01T09:00:00Z" });
    expect(detect({ raid: [item] }).filter((i) => i.type === "raidAging")).toHaveLength(0);
  });

  it("does not fire when the target date has not passed", () => {
    const item = raid({ targetDate: "2026-12-01", localModifiedAt: "2026-06-01T09:00:00Z" });
    expect(detect({ raid: [item] }).filter((i) => i.type === "raidAging")).toHaveLength(0);
  });
});

describe("composition", () => {
  it("returns [] for empty input", () => {
    expect(detectInsights(input({}), TODAY)).toEqual([]);
  });

  it("orders by severity desc then key asc", () => {
    const out = detectInsights(
      input({
        milestones: [milestone({ id: 1, date: "2026-06-01" })], // high milestoneSlip
        tasks: [task({ id: 1, dueDate: "2026-06-01" }), task({ id: 2, dueDate: "2026-06-02" })], // low overdueTrend
        priorOverdueCount: 1,
        raid: [raid({ id: 1, targetDate: "2026-06-01", localModifiedAt: "2026-06-01T09:00:00Z" })], // medium raidAging
        budgets: [bucket({ name: "PO", allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 200 } }] })], // medium budgetVariance
        plan: PLAN,
      }),
      TODAY,
    );
    expect(out.map((i) => i.key)).toEqual([
      "milestoneSlip:1", // high
      "budgetVariance",  // medium (key asc before raidAging)
      "raidAging:1",     // medium
      "overdueTrend",    // low
    ]);
  });
});

describe("timelog guardrail insights", () => {
  const violation = {
    rule: "timelogCapPerDay" as const,
    timelogUserId: 7,
    resourceId: 40,
    count: 2,
    worstHours: 12,
    threshold: 8,
    // Two NON-ADJACENT breaching days, so a `data` assertion below cannot pass
    // by accident against a single-day range or a swapped pair.
    firstViolationDate: "2026-02-03",
    lastViolationDate: "2026-02-19",
  };
  const ada: Resource = {
    id: 40, firstName: "Ada", lastName: "Lovelace",
    roleId: null, utilizationMode: "percent", utilization: {},
  };

  it("emits nothing when violations are null", () => {
    const out = detect({ timelogViolations: null });
    expect(out.filter((i) => i.type.startsWith("timelog"))).toEqual([]);
  });

  it("names the person from the linked resource", () => {
    const out = detect({ timelogViolations: [violation], resources: [ada] });
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g).toBeDefined();
    expect(g?.key).toBe("timelog:timelogCapPerDay:7");
    expect(g?.severity).toBe("medium");
    expect(g?.entityRef).toEqual({ view: "resources", id: 40 });
    expect(g?.data).toEqual({
      person: "Ada Lovelace", count: 2, worstHours: 12, threshold: 8,
      firstViolationDate: "2026-02-03", lastViolationDate: "2026-02-19",
      // The identity the reconcile's SCOPE check reads. Deliberately the raw
      // timelog userId and not the resource id: `dailyUsers` records who the
      // FETCH covered, and a fetch knows people by their timelog id — a person
      // with no link has one of these and no resource id at all.
      timelogUserId: 7,
    });
  });

  // ★★ The two dates are the whole reason a later reconcile can tell "this rule
  // ran and found nothing" apart from "the roll no longer covers the days this
  // insight was about". They must reach `data` UNSWAPPED and unrounded — an
  // exact-object assertion above already pins the set of keys; this pins each
  // date to its own end against a range whose two days differ.
  it("carries the violation's first and last violating day into data", () => {
    const out = detect({ timelogViolations: [violation], resources: [ada] });
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g?.data.firstViolationDate).toBe("2026-02-03");
    expect(g?.data.lastViolationDate).toBe("2026-02-19");
  });

  // ★★★ Not decoration: `sanitizeData` is what every LOAD path runs, and it
  // keeps only finite numbers and strings. If it ever narrowed to numbers, the
  // dates would vanish on reload while every in-memory test above stayed green
  // — the insight would silently go back to being unwindowed.
  it("keeps both dates through the persisted-insight sanitiser", () => {
    const out = detect({ timelogViolations: [violation], resources: [ada] });
    const g = out.find((i) => i.type === "timelogCapPerDay");
    const [restored] = sanitizeInsights([{
      id: 1, key: g!.key, type: g!.type, severity: g!.severity, data: g!.data,
      status: "active", firstSeenAt: "2026-02-20", lastSeenAt: "2026-02-20", occurrences: 1,
    }]);
    expect(restored.data.firstViolationDate).toBe("2026-02-03");
    expect(restored.data.lastViolationDate).toBe("2026-02-19");
  });

  // No entityRef without a link: InsightEntityRef requires a real workspace id,
  // and the recommendation-replay path resolves it as a real row.
  it("omits entityRef and identifies the person by TimeLog id when unlinked", () => {
    const out = detect({ timelogViolations: [{ ...violation, resourceId: null }] });
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g?.entityRef).toBeUndefined();
    expect(g?.data.person).toBe("#7");
  });

  // A DANGLING link (the resource was deleted) must behave like no link at all —
  // it is the id-resolution, not the link's presence, that decides.
  it("omits entityRef when the linked resource no longer exists", () => {
    const out = detect({ timelogViolations: [violation], resources: [{ ...ada, id: 41 }] });
    const g = out.find((i) => i.type === "timelogCapPerDay");
    expect(g?.entityRef).toBeUndefined();
    expect(g?.data.person).toBe("#7");
  });

  it("emits one insight per violation, all at medium severity", () => {
    const out = detect({
      timelogViolations: [
        violation,
        { ...violation, rule: "timelogNonWorkingDay" as const, timelogUserId: 8, resourceId: null, threshold: 0 },
      ],
    });
    const guardrails = out.filter((i) => i.type.startsWith("timelog"));
    expect(guardrails.map((i) => i.key)).toEqual([
      "timelog:timelogCapPerDay:7",
      "timelog:timelogNonWorkingDay:8",
    ]);
    expect(guardrails.every((i) => i.severity === "medium")).toBe(true);
  });
});

// ★★★ The list was entirely unpinned: gutting it at the call site left every
// test green while making every core insight IMMORTAL — never resolved, never
// pruned. (A grep count once quoted here refuted itself — the comment became
// one of the matches, so nobody could reproduce the number.) `task-manager.guardrail-reconcile
// .test.tsx` now kills that mutant behaviourally; this pins the membership.
describe("CORE_INSIGHT_TYPES", () => {
  it("is exactly the five non-guardrail types", () => {
    // Deliberately a hand-written list, not derived from `INSIGHT_TYPES` minus
    // the rule ids — a derived expectation restates the code and pins nothing.
    // Same precedent, and the same reason, as `METRIC_FIELD` in outcome.test.ts.
    // Adding an insight type is meant to land here and force the decision of
    // whether it can go dark on a device.
    expect([...CORE_INSIGHT_TYPES].sort()).toEqual([
      "budgetVariance",
      "milestoneSlip",
      "overdueTrend",
      "raidAging",
      "stalledWork",
    ]);
  });

  // ★★ Membership is NOT a licence to clear, which is the correction this slice
  // made to the list's own docstring. `overdueTrend` is in the list AND goes
  // dark without a per-device landing snapshot, so a reader who takes the list
  // as "always evaluated" reintroduces the defect. Pinned so a future edit that
  // re-asserts the old invariant has to confront this line.
  it("includes overdueTrend, which is nonetheless not always evaluated", () => {
    expect(CORE_INSIGHT_TYPES).toContain("overdueTrend");
    const overdue = [task({ id: 1, dueDate: "2026-06-01" }), task({ id: 2, dueDate: "2026-06-02" })];
    // The positive control is what stops this being vacuous: the SAME tasks
    // that produce a detection with a snapshot produce NONE without one, so the
    // absence is attributable to `priorOverdueCount`, not to the fixture.
    const withSnapshot = detect({ tasks: overdue, priorOverdueCount: 1 });
    expect(withSnapshot.filter((i) => i.type === "overdueTrend")).toHaveLength(1);
    const noSnapshot = detect({ tasks: overdue, priorOverdueCount: null });
    expect(noSnapshot.filter((i) => i.type === "overdueTrend")).toHaveLength(0);
  });
});
