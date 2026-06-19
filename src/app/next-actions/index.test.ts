// src/app/next-actions/index.test.ts
//
// Integration test for the assembled next-actions engine (Task 10 / SP1 final).
// Verifies that ALL_PROVIDERS wire up correctly and that the public
// computeNextActions() entry point honours module gating, dismissals, ordering,
// and tier classification.
import { describe, expect, it } from "vitest";
import { computeNextActions } from "./index";
import type { ActionInput } from "./types";
import type { Task, RaidItem, ChangeItem, Milestone } from "../types";
import type { DashboardModel } from "../dashboard";
import type { FeatureModuleId } from "../feature-modules";

// ---------------------------------------------------------------------------
// Shared today anchor (all fixtures keyed relative to this date)
// ---------------------------------------------------------------------------
const TODAY = "2026-06-15";

// ---------------------------------------------------------------------------
// Fixture factories — shapes copied verbatim from per-provider test files
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 7,
    taskName: "Ship feature",
    dueDate: "2026-06-10", // < TODAY → overdue
    assignee: "",
    assigneeEmail: "",
    lastUpdateDate: "2026-06-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

function makeCriticalRaid(overrides: Partial<RaidItem> = {}): RaidItem {
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

function makePendingChange(overrides: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1,
    title: "Change",
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-06-01",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...overrides,
  };
}

function makeOverdueMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 1,
    name: "Phase 1 Complete",
    date: "2026-06-01", // < TODAY → overdue; score = urgencyOverdue(40)+impactBlocksMilestone(20) = 60
    linkedTaskIds: [],
    ...overrides,
  };
}

function makeDashboard(
  budgetEffective: "R" | "A" | "G" | null,
  cpi: number | null,
): DashboardModel {
  return {
    budget: { effective: budgetEffective },
    evm: { cpi },
  } as unknown as DashboardModel;
}

// All module IDs that providers declare
const ALL_FEATURES: readonly FeatureModuleId[] = [
  "raid",
  "changes",
  "milestones",
  "budget",
  "stakeholders",
];

// ---------------------------------------------------------------------------
// Baseline input: one signal per provider so all emit at least one action
// ---------------------------------------------------------------------------
function baseInput(): ActionInput {
  return {
    // task-due: one overdue task
    tasks: [makeTask()],
    // raid: one Critical non-terminal Risk item
    raid: [makeCriticalRaid()],
    // change-pending: 6 Proposed items → aggregate fires (threshold = SCOPE_PENDING_RED = 5)
    changes: Array.from({ length: 6 }, (_, i) => makePendingChange({ id: i + 1 })),
    // milestone: one overdue milestone (score = 60 → tier "now")
    milestones: [makeOverdueMilestone()],
    stakeholders: [],
    commsReminders: [], // stakeholder-comms won't fire, keeping sources simpler
    dashboard: makeDashboard("R", 0.7),
    features: ALL_FEATURES,
    today: TODAY,
    now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 3,
    dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName: "Demo",
  };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("computeNextActions integration", () => {
  it("returns actions from at least 4 distinct sources given the baseline input", () => {
    const input = baseInput();
    const out = computeNextActions(input);
    const sources = new Set(out.map((a) => a.source));
    // task-due, raid, change-pending, milestone, budget all have signals → 5 sources
    expect(sources.size).toBeGreaterThanOrEqual(4);
  });

  it("returns actions sorted by score descending", () => {
    const out = computeNextActions(baseInput());
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].score).toBeGreaterThanOrEqual(out[i + 1].score);
    }
  });

  it("top action has tier 'now' (overdue milestone scores 60, meets TIER_NOW)", () => {
    const out = computeNextActions(baseInput());
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].tier).toBe("now");
  });

  it("disabling the raid module removes all raid actions", () => {
    const input = baseInput();
    const noRaid: ActionInput = {
      ...input,
      features: input.features.filter((f) => f !== "raid"),
    };
    const out = computeNextActions(noRaid);
    expect(out.every((a) => a.source !== "raid")).toBe(true);
  });

  it("a dismissed action id is absent from the result", () => {
    const input = baseInput();
    // First, get the full result to discover a real id
    const full = computeNextActions(input);
    expect(full.length).toBeGreaterThan(0);
    const targetId = full[0].id;

    const withDismissed: ActionInput = {
      ...input,
      dismissed: new Set([targetId]),
    };
    const out = computeNextActions(withDismissed);
    expect(out.every((a) => a.id !== targetId)).toBe(true);
  });
});
