// BrowserBackend (IndexedDB) round-trip for the KV-blob entities that the
// record-diff stores don't cover: project status, milestones, and changes.
// Uses fake-indexeddb to provide a real IDB implementation under jsdom.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createBackend, emptyWorkspace } from "./storage";
import { KV_PLAN_KEY, idbSet } from "./idb";
import type { ChangeItem, Milestone, ProjectStatus, Stakeholder } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", impactDescription: "2 sprints", scheduleImpactDays: 10, costImpact: 5000,
  requestedBy: "Ann", raisedDate: "2026-06-01", decisionBy: "Bob", decisionDate: "2026-06-09",
  resolutionNotes: "ok", linkedTaskIds: [3, 4], linkedRaidIds: [7], stakeholderIds: [], localModifiedAt: "2026-06-09T10:00:00.000Z",
};
const milestone: Milestone = {
  id: 2, name: "Go live", date: "2026-12-01", linkedTaskIds: [5],
};
const status: ProjectStatus = { ragOverride: "R", narrative: "x" };
const stakeholder: Stakeholder = {
  id: 3, name: "Dana", organization: "Acme", category: "Sponsor",
  influence: "High", interest: "High", raci: { "2": "A" },
  localModifiedAt: "2026-06-09T10:00:00.000Z",
};

describe("BrowserBackend KV persistence", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases.
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("round-trips changes, milestones, status, and stakeholders across a fresh load", async () => {
    const ws = { ...emptyWorkspace(), changes: [change], milestones: [milestone], status, stakeholders: [stakeholder] };

    await createBackend({ kind: "browser" }).save(ws);

    const loaded = await createBackend({ kind: "browser" }).load();
    expect(loaded.changes).toHaveLength(1);
    expect(loaded.changes?.[0]).toMatchObject({ id: 1, title: "Widen scope", linkedRaidIds: [7] });
    expect(loaded.milestones).toHaveLength(1);
    expect(loaded.milestones?.[0]).toMatchObject({ id: 2, name: "Go live" });
    expect(loaded.status).toMatchObject({ ragOverride: "R", narrative: "x" });
    expect(loaded.stakeholders).toHaveLength(1);
    expect(loaded.stakeholders?.[0]).toMatchObject({ id: 3, name: "Dana", category: "Sponsor", raci: { "2": "A" } });
  });
});

// This backend reads the KV plan blob VERBATIM and casts it — it never runs
// `sanitizePlan`, unlike every other load funnel. `ResourcePlan.currency` is
// now the `BudgetCurrency` union, so a workspace stored before that narrowing
// can carry a value the type forbids. Seeding the KV key directly is the only
// honest reproduction: `save()` takes a typed `ResourcePlan` and cannot express
// the legacy blob.
describe("BrowserBackend plan currency coercion", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  // ★ The two "untouched" tests below carry a REVERSED window and an explicit
  // `budgetFollowsPlan: false` for a reason: those are the two shapes a full
  // `sanitizePlan` would visibly rewrite. Each lives in its own test with its
  // own fixture because a single test aborts at its first failing expect, so
  // one fixture could only ever prove one of them.
  it("coerces an out-of-union stored currency to EUR without rewriting the window", async () => {
    // Stored REVERSED on purpose — a verbatim read never normalised the window,
    // so legacy blobs can hold one. `sanitizePlan` would swap it.
    await idbSet(KV_PLAN_KEY, {
      startDate: "2026-09-30", endDate: "2026-03-01",
      granularity: "week", currency: "CHF",
    });

    const loaded = await createBackend({ kind: "browser" }).load();

    expect(loaded.plan.currency).toBe("EUR");
    expect(loaded.plan.startDate).toBe("2026-09-30");
    expect(loaded.plan.endDate).toBe("2026-03-01");
    expect(loaded.plan.granularity).toBe("week");
  });

  it("keeps an explicit budgetFollowsPlan: false while coercing the currency", async () => {
    // `sanitizePlan` sparse-emits this key, so it would DROP a stored `false`.
    await idbSet(KV_PLAN_KEY, {
      startDate: "2026-03-01", endDate: "2026-09-30",
      granularity: "month", currency: "CHF", budgetFollowsPlan: false,
    });

    const loaded = await createBackend({ kind: "browser" }).load();

    expect(loaded.plan.currency).toBe("EUR");
    expect(loaded.plan.budgetFollowsPlan).toBe(false);
  });

  it("leaves a supported stored currency untouched", async () => {
    // Anti-vacuity control: a coercion returning "EUR" unconditionally, or one
    // that replaces the plan wholesale, fails here rather than above.
    await idbSet(KV_PLAN_KEY, {
      startDate: "2026-03-01", endDate: "2026-09-30",
      granularity: "week", currency: "USD",
    });

    const loaded = await createBackend({ kind: "browser" }).load();

    expect(loaded.plan.currency).toBe("USD");
    expect(loaded.plan.startDate).toBe("2026-03-01");
  });
});
