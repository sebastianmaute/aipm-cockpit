// src/app/next-actions/providers/change-pending.ts
import { describe, expect, it } from "vitest";
import { SCOPE_PENDING_RED } from "../../change-log";
import type { ChangeItem } from "../../types";
import { ACTION_WEIGHTS, scoreAction } from "../score";
import type { ActionInput } from "../types";
import { changePendingProvider } from "./change-pending";

// ---------------------------------------------------------------------------
// Minimal ChangeItem fixture factory (mirrors change-log.test.ts)
// ---------------------------------------------------------------------------
function ci(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1,
    title: "t",
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-06-01",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Minimal ActionInput factory (all required fields; only `changes` matters here)
// ---------------------------------------------------------------------------
function input(changes: ChangeItem[]): ActionInput {
  return {
    tasks: [],
    raid: [],
    changes,
    milestones: [],
    stakeholders: [],
    commsReminders: [],
    dashboard: {} as ActionInput["dashboard"],
    features: [],
    today: "2026-06-13",
    now: new Date("2026-06-13"),
    reminderLeadDays: 3,
    dueSoonWorkdays: 5,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName: "",
  };
}

// ---------------------------------------------------------------------------

describe("changePendingProvider", () => {
  const W = ACTION_WEIGHTS;

  it("honors an overridden scopePendingRed threshold", () => {
    const three = [ci({ id: 1 }), ci({ id: 2 }), ci({ id: 3 })];
    // Default threshold is 5 → no aggregate with 3 pending.
    expect(changePendingProvider.provide(input(three)).some((a) => a.id === "change-pending:all:aggregate")).toBe(false);
    // Override to 3 → aggregate fires.
    const out = changePendingProvider.provide({ ...input(three), scopePendingRed: 3 });
    expect(out.some((a) => a.id === "change-pending:all:aggregate")).toBe(true);
  });

  it("emits aggregate action when pending count >= SCOPE_PENDING_RED (5)", () => {
    const changes = Array.from({ length: SCOPE_PENDING_RED }, (_, i) =>
      ci({ id: i + 1, status: "Under Review" }),
    );
    const actions = changePendingProvider.provide(input(changes));

    const agg = actions.find((a) => a.id === "change-pending:all:aggregate");
    expect(agg).toBeDefined();
    expect(agg!.title.key).toBe("actionChangeAggTitle");
    expect(agg!.title.params![0]).toBe(SCOPE_PENDING_RED); // pending.length
    expect(agg!.why.key).toBe("actionChangeAggWhy");
    expect(agg!.why.params).toBeUndefined(); // RAG word baked into the string (localizable)
    expect(agg!.source).toBe("change-pending");
    expect(agg!.cta).toEqual({ kind: "open", view: "changes", id: 0 });
    // Score must include riskCritical, impactScopePending, and clarityBonus
    const expectedScore = scoreAction({ risk: W.riskCritical, impact: W.impactScopePending, clarity: W.clarityBonus });
    expect(agg!.score).toBe(expectedScore);
  });

  it("emits NO actions when pending count < threshold AND no Red-impact items", () => {
    // 4 pending items (below threshold=5), none Critical/High impact
    const changes = Array.from({ length: SCOPE_PENDING_RED - 1 }, (_, i) =>
      ci({ id: i + 1, status: "Proposed", impact: "Medium" }),
    );
    const actions = changePendingProvider.provide(input(changes));
    expect(actions).toHaveLength(0);
  });

  it("emits per-item action for pending change with Red impact (Critical), regardless of aggregate", () => {
    // Only 1 pending item — below aggregate threshold — but impact is "Critical" → "R"
    const changes = [ci({ id: 42, status: "Proposed", impact: "Critical", title: "Big Risk" })];
    const actions = changePendingProvider.provide(input(changes));

    const item = actions.find((a) => a.id === "change-pending:42:item");
    expect(item).toBeDefined();
    expect(item!.title.key).toBe("actionChangeItemTitle");
    expect(item!.title.params![0]).toBe("Big Risk");
    expect(item!.why.key).toBe("actionChangeItemWhy");
    expect(item!.why.params![0]).toBe("Critical");
    expect(item!.source).toBe("change-pending");
    expect(item!.cta).toEqual({ kind: "open", view: "changes", id: 42 });
  });

  it("emits per-item action for pending change with High impact (also maps to Red)", () => {
    const changes = [ci({ id: 7, status: "Under Review", impact: "High", title: "High Impact" })];
    const actions = changePendingProvider.provide(input(changes));

    const item = actions.find((a) => a.id === "change-pending:7:item");
    expect(item).toBeDefined();
    expect(item!.why.params![0]).toBe("High");
  });

  it("ignores terminal/non-pending changes (Approved, Rejected, Implemented, Deferred)", () => {
    const changes = [
      ci({ id: 1, status: "Approved", impact: "Critical" }),
      ci({ id: 2, status: "Rejected", impact: "Critical" }),
      ci({ id: 3, status: "Implemented", impact: "Critical" }),
      ci({ id: 4, status: "Deferred", impact: "Critical" }),
    ];
    const actions = changePendingProvider.provide(input(changes));
    // No pending items → no aggregate; non-pending items excluded from per-item scan
    expect(actions).toHaveLength(0);
  });

  it("emits both aggregate and per-item when threshold met and Red-impact items present", () => {
    const changes = [
      // 5 pending → triggers aggregate
      ...Array.from({ length: SCOPE_PENDING_RED }, (_, i) =>
        ci({ id: i + 1, status: "Proposed", impact: "Low" }),
      ),
      // 1 extra pending with Critical impact → triggers per-item
      ci({ id: 99, status: "Proposed", impact: "Critical", title: "Critical Change" }),
    ];
    const actions = changePendingProvider.provide(input(changes));

    expect(actions.some((a) => a.id === "change-pending:all:aggregate")).toBe(true);
    expect(actions.some((a) => a.id === "change-pending:99:item")).toBe(true);
  });

  it("aggregate action pending count param reflects actual pending count", () => {
    // 7 total changes: 6 pending (>= 5), 1 non-pending
    const changes = [
      ...Array.from({ length: 6 }, (_, i) => ci({ id: i + 1, status: "Proposed" })),
      ci({ id: 99, status: "Approved" }),
    ];
    const actions = changePendingProvider.provide(input(changes));
    const agg = actions.find((a) => a.id === "change-pending:all:aggregate");
    expect(agg).toBeDefined();
    expect(agg!.title.params![0]).toBe(6); // only 6 are pending
  });

  it("includes the clarity bonus in the aggregate score", () => {
    const changes = Array.from({ length: SCOPE_PENDING_RED }, (_, i) => ci({ id: i + 1 }));
    const actions = changePendingProvider.provide(input(changes));
    const agg = actions.find((a) => a.id === "change-pending:all:aggregate");
    expect(agg!.score).toBe(W.riskCritical + W.impactScopePending + W.clarityBonus);
  });

  it("includes the clarity bonus in the per-item score", () => {
    const changes = [ci({ id: 1, status: "Proposed", impact: "Critical", title: "Risk" })];
    const actions = changePendingProvider.provide(input(changes));
    const item = actions.find((a) => a.id === "change-pending:1:item");
    expect(item!.score).toBe(W.riskCritical + W.clarityBonus);
  });
});
