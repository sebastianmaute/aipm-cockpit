import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace } from "./workspace";
import { isDayKey } from "./actual-hours";
import { DEMO_AS_OF } from "./demo-workspace";
import { computeEvm } from "./evm";
import { EVM_INDEX_AMBER, EVM_INDEX_RED } from "./dashboard";

// The content contract of the hand-curated sample master: it is authored as of
// DEMO_AS_OF (mid-project) and exercises every feature a demo should show.
// Strict decode on purpose — the demo loads through the same path, and a
// record the sanitizers drop is a defect in the master, not in this test.
const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const ws = jsonToWorkspace(JSON.stringify(raw), { strict: true });
const AS_OF = DEMO_AS_OF;

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

  // ★★★ THE DEMO'S "At a glance" TILE SHOWS Effort SPI AND Effort CPI ONLY WHEN
  // THE MASTER AUTHORS EFFORT, and nothing else in the suite can see that. The
  // master shipped with ZERO tasks carrying `originalEstimateMinutes` or
  // `timeSpentMinutes`, so `computeEvm` returned `spi: null` / `cpi: null`
  // (`evm.ts` — null on a zero divisor), `dashboard-kpi-strip.tsx` hid both
  // cells, and the demo silently showed a three-cell strip for every release.
  // No gate objected: the fields are OPTIONAL, so a decode is clean without
  // them, and the golden fixtures pin whatever bytes the master happens to
  // have. This test is the only thing standing between a re-authored master and
  // that same silent regression.
  it("exercises the EVM indices, so the demo's At-a-glance strip shows five cells", () => {
    const evm = computeEvm(ws.tasks, AS_OF);
    // Both non-null is the property the tile actually reads.
    expect(evm.spi).not.toBeNull();
    expect(evm.cpi).not.toBeNull();
    // ★ NOT 1.00, deliberately: a demo whose indices both read exactly on-plan
    // teaches nothing about what they are for. Authored into the amber band
    // (`dashboard.ts` EVM_INDEX_AMBER 0.9 / EVM_INDEX_RED 0.8) so each drives a
    // visible RAG contribution without reading as a project in crisis.
    expect(evm.spi!).toBeGreaterThanOrEqual(EVM_INDEX_RED);
    expect(evm.spi!).toBeLessThan(EVM_INDEX_AMBER);
    expect(evm.cpi!).toBeGreaterThanOrEqual(EVM_INDEX_RED);
    expect(evm.cpi!).toBeLessThan(EVM_INDEX_AMBER);
    // The terms behind them, so a master that keeps estimates but drops booked
    // minutes (CPI's only input) fails here naming which half went missing.
    expect(ws.tasks.every((t) => (t.originalEstimateMinutes ?? 0) > 0)).toBe(true);
    expect(ws.tasks.filter((t) => (t.timeSpentMinutes ?? 0) > 0).length).toBeGreaterThanOrEqual(5);
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
