import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace } from "./workspace";
import { isDayKey } from "./actual-hours";

// The content contract of the hand-curated sample master: it is authored as of
// DEMO_AS_OF (mid-project) and exercises every feature a demo should show.
// Strict decode on purpose — the demo loads through the same path, and a
// record the sanitizers drop is a defect in the master, not in this test.
const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const ws = jsonToWorkspace(JSON.stringify(raw), { strict: true });
const AS_OF = "2026-09-18";

describe("sample master is current (as of DEMO_AS_OF)", () => {
  it("is mid-project on DEMO_AS_OF", () => {
    expect(ws.plan.startDate < AS_OF && AS_OF < ws.plan.endDate).toBe(true);
    const buckets = ws.budgets ?? [];
    expect(buckets.some((b) => b.endDate < AS_OF)).toBe(true);
    expect(buckets.some((b) => b.startDate <= AS_OF && AS_OF <= b.endDate)).toBe(true);
    expect(buckets.some((b) => b.startDate > AS_OF)).toBe(true);
  });

  it("exercises the budget features", () => {
    const b = ws.budgets ?? [];
    expect(ws.plan.budgetFollowsPlan).toBe(true);
    expect(ws.fxRates?.rates).toBeDefined();
    expect(ws.roles.every((r) => typeof r.order === "number")).toBe(true);
    // `rateBasis` is sparse: "hour" is the default and the sanitizer stores it as
    // ABSENT (only "day" survives), so an hourly role is one without "day".
    expect(ws.roles.some((r) => (r.rateBasis ?? "hour") === "hour")).toBe(true);
    expect(ws.roles.some((r) => r.rateBasis === "day")).toBe(true);
    expect(b.filter((x) => x.type === "fixed").length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => (x.disciplineAllocations?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => x.rateOverrideInternal !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(b.filter((x) => x.status === "closed").length).toBeGreaterThanOrEqual(2);
    expect(b.every((x) => typeof x.createdDate === "string")).toBe(true);
    const withDayActuals = b.filter((x) => x.allocations.some((a) => Object.keys(a.actualHours).some(isDayKey)));
    expect(withDayActuals.length).toBeGreaterThanOrEqual(3);
    const dayKeys = new Set(b.flatMap((x) => x.allocations.flatMap((a) => Object.keys(a.actualHours).filter(isDayKey))));
    expect(dayKeys.size).toBeGreaterThanOrEqual(15);
    expect([...dayKeys].every((k) => k <= AS_OF)).toBe(true);
  });

  it("seeds the previously empty slices", () => {
    expect(ws.activityLog?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(ws.insights?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ws.knowledgeItems?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ws.timelogLinks?.userLinks.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(ws.raid.filter((r) => (r.noteLog?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
    expect((ws.changes ?? []).filter((c) => (c.noteLog?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the deliberately-unseeded slices absent", () => {
    for (const k of ["documentAssets", "features", "fieldVisibility", "settingsOverrides", "budgetHistory"]) {
      expect(raw[k]).toBeUndefined();
    }
  });

  it("loses no record to the sanitizers (file count === decoded count, per slice)", () => {
    const decoded = ws as unknown as Record<string, unknown>;
    for (const k of ["tasks", "raid", "absences", "resources", "roles", "budgets", "milestones", "changes",
      "stakeholders", "activityLog", "insights", "knowledgeItems", "calendarEvents", "documents"] as const) {
      expect([k, (decoded[k] as unknown[] | undefined)?.length ?? 0])
        .toEqual([k, (raw[k] as unknown[] | undefined)?.length ?? 0]);
    }
  });
});
