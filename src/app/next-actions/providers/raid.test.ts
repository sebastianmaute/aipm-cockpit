// src/app/next-actions/providers/raid.test.ts
import { describe, expect, it } from "vitest";
import { raidProvider } from "./raid";
import type { ActionInput } from "../types";
import type { RaidItem } from "../../types";
import { ACTION_WEIGHTS } from "../score";

const TODAY = "2026-06-15";

function input(raid: RaidItem[]): ActionInput {
  return {
    tasks: [], raid, changes: [], milestones: [], stakeholders: [],
    dashboard: {} as ActionInput["dashboard"], features: [], today: TODAY, now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
    projectName: "",
  } as ActionInput;
}

/** Minimal non-terminal Risk item with Critical severity (severityRag→"R"). */
function criticalRisk(overrides: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "Server outage risk",
    status: "Open",
    severity: "Critical",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2026-05-01",
    ...overrides,
  };
}

/** Minimal non-terminal Assumption item with High severity (severityRag→"R"). */
function highAssumption(overrides: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 2,
    category: "A",
    title: "Vendor assumption",
    status: "Open",
    severity: "High",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2026-05-01",
    ...overrides,
  };
}

/** Minimal non-terminal Issue item with Medium severity (severityRag→"A"). */
function mediumIssue(overrides: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 3,
    category: "I",
    title: "Integration issue",
    status: "Open",
    severity: "Medium",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    raisedDate: "2026-05-01",
    ...overrides,
  };
}

describe("raidProvider — severity actions", () => {
  it("emits a severity action for a non-terminal Critical Risk item (RAG=R)", () => {
    const item = criticalRisk();
    const acts = raidProvider.provide(input([item]));
    const sev = acts.find((a) => a.id === "raid:1:severity");
    expect(sev).toBeDefined();
    expect(sev!.source).toBe("raid");
    expect(sev!.cta).toEqual({ kind: "open", view: "raid", id: 1 });
    expect(sev!.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.riskCritical);
    expect(sev!.title).toEqual({ key: "actionRaidTitle", params: [1, "Server outage risk"] });
    expect(sev!.why).toEqual({ key: "actionRaidWhySeverity", params: ["Critical"] });
  });

  it("emits a severity action for a non-terminal High Assumption item (RAG=R)", () => {
    const item = highAssumption();
    const acts = raidProvider.provide(input([item]));
    const sev = acts.find((a) => a.id === "raid:2:severity");
    expect(sev).toBeDefined();
    expect(sev!.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.riskHigh);
  });

  it("emits a severity action for a non-terminal Medium Issue item (RAG=A)", () => {
    const item = mediumIssue();
    const acts = raidProvider.provide(input([item]));
    const sev = acts.find((a) => a.id === "raid:3:severity");
    expect(sev).toBeDefined();
    expect(sev!.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.riskHigh);
  });

  it("skips severity action for a terminal Risk item (status=Closed)", () => {
    const item = criticalRisk({ status: "Closed" });
    const acts = raidProvider.provide(input([item]));
    expect(acts.find((a) => a.id === "raid:1:severity")).toBeUndefined();
  });

  it("skips severity action for a terminal Risk item (status=Realized)", () => {
    const item = criticalRisk({ status: "Realized" });
    const acts = raidProvider.provide(input([item]));
    expect(acts.find((a) => a.id === "raid:1:severity")).toBeUndefined();
  });

  it("skips severity action for item with Low severity (severityRag=G)", () => {
    const item = criticalRisk({ severity: "Low" });
    const acts = raidProvider.provide(input([item]));
    expect(acts.find((a) => a.id === "raid:1:severity")).toBeUndefined();
  });

  it("returns nothing for an empty raid list", () => {
    expect(raidProvider.provide(input([]))).toEqual([]);
  });
});

describe("raidProvider — review actions", () => {
  it("emits an overdue review action for an item past its targetDate", () => {
    // targetDate in the past → "overdue"; raisedDate within 30d → only overdue reason
    const item = criticalRisk({ id: 10, targetDate: "2026-05-01", raisedDate: "2026-05-14" });
    const acts = raidProvider.provide(input([item]));
    const rev = acts.find((a) => a.id === "raid:10:overdue");
    expect(rev).toBeDefined();
    expect(rev!.source).toBe("raid");
    expect(rev!.cta).toEqual({ kind: "open", view: "raid", id: 10 });
    expect(rev!.why.key).toBe("actionRaidWhyReviewOverdue");
    expect(rev!.why.params).toBeDefined();
    // daysOverdue = days from targetDate 2026-05-01 to today 2026-06-15 = 45
    expect((rev!.why.params as number[])[0]).toBe(45);
    // score includes urgencyOverdue contribution
    expect(rev!.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.urgencyOverdue);
  });

  it("emits a stale review action for an item not reviewed in >30 days", () => {
    // raisedDate 31 days ago, no targetDate → "stale"
    const item = criticalRisk({ id: 20, raisedDate: "2026-05-15" }); // 31 days before TODAY
    const acts = raidProvider.provide(input([item]));
    const rev = acts.find((a) => a.id === "raid:20:stale");
    expect(rev).toBeDefined();
    expect(rev!.why.key).toBe("actionRaidWhyReviewStale");
    expect((rev!.why.params as number[])[0]).toBeGreaterThanOrEqual(30);
  });

  it("emits both a severity action and a review action for the same item (distinct IDs)", () => {
    // Critical severity + past targetDate → two actions
    const item = criticalRisk({ id: 30, targetDate: "2026-05-01", raisedDate: "2026-05-14" });
    const acts = raidProvider.provide(input([item]));
    expect(acts.find((a) => a.id === "raid:30:severity")).toBeDefined();
    expect(acts.find((a) => a.id === "raid:30:overdue")).toBeDefined();
  });

  it("skips review action for a terminal item", () => {
    // Terminal items are excluded by getRaidReviewItems (isActive check)
    const item = criticalRisk({ id: 40, status: "Closed", targetDate: "2026-05-01", raisedDate: "2026-01-01" });
    const acts = raidProvider.provide(input([item]));
    expect(acts.find((a) => a.id.startsWith("raid:40:"))).toBeUndefined();
  });
});

describe("raidProvider — provider metadata", () => {
  it("has moduleId 'raid'", () => {
    expect(raidProvider.moduleId).toBe("raid");
  });
});
