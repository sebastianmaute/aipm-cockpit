import { describe, expect, it } from "vitest";
import { UNASSIGNED_OWNER, computeRaidReport } from "./raid-report";
import type { RaidItem } from "./types";

const TODAY = "2026-05-28";

function item(p: Partial<RaidItem>): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "t",
    status: "Open",
    raisedDate: TODAY,
    linkedTaskIds: [],
    causedByRaidIds: [],
    ...p,
  } as RaidItem;
}

describe("computeRaidReport", () => {
  it("returns empty result for empty input", () => {
    const r = computeRaidReport([], TODAY);
    expect(r.tiles).toEqual({ openR: 0, openA: 0, openI: 0, openD: 0 });
    expect(r.bySeverity).toEqual([]);
    expect(r.byStatus).toEqual([]);
    expect(r.byOwner).toEqual([]);
    expect(r.byCategory).toHaveLength(4);
    expect(r.byCategory.every((row) => row.open === 0 && row.closed === 0 && row.overdue === 0)).toBe(true);
    expect(r.byAging.every((row) => row.open === 0)).toBe(true);
    expect(r.topOpen).toEqual([]);
    expect(r.fullDetail).toEqual([]);
  });

  it("tile counts respect 'open' per category", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "R", status: "Closed" }),
      item({ id: 3, category: "R", status: "Mitigated" }),
      item({ id: 4, category: "A", status: "Pending" }),
      item({ id: 5, category: "A", status: "Validated" }),
      item({ id: 6, category: "I", status: "Open" }),
      item({ id: 7, category: "I", status: "Resolved" }),
      item({ id: 8, category: "D", status: "In Progress" }),
      item({ id: 9, category: "D", status: "Delivered" }),
    ], TODAY);
    expect(r.tiles).toEqual({ openR: 1, openA: 1, openI: 1, openD: 1 });
  });

  it("By Severity counts each cell in the L/M/H/C × R/A/I/D matrix", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", severity: "Critical" }),
      item({ id: 2, category: "R", severity: "Critical" }),
      item({ id: 3, category: "I", severity: "High" }),
      item({ id: 4, category: "D", severity: "Medium" }),
      item({ id: 5, category: "A", severity: "Low" }),
    ], TODAY);
    const find = (sev: string) => r.bySeverity.find((row) => row.severity === sev)!;
    expect(find("Critical")).toEqual({ severity: "Critical", risks: 2, assumptions: 0, issues: 0, dependencies: 0, total: 2 });
    expect(find("High")).toEqual({ severity: "High", risks: 0, assumptions: 0, issues: 1, dependencies: 0, total: 1 });
    expect(find("Medium")).toEqual({ severity: "Medium", risks: 0, assumptions: 0, issues: 0, dependencies: 1, total: 1 });
    expect(find("Low")).toEqual({ severity: "Low", risks: 0, assumptions: 1, issues: 0, dependencies: 0, total: 1 });
  });

  it("By Severity omits Unrated row when every item has a severity", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", severity: "Critical" }),
    ], TODAY);
    expect(r.bySeverity.find((row) => row.severity === "Unrated")).toBeUndefined();
  });

  it("By Severity includes Unrated row when any item lacks severity", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "I", status: "Open" /* no severity */ }),
      item({ id: 2, category: "R", severity: "High" }),
    ], TODAY);
    const unrated = r.bySeverity.find((row) => row.severity === "Unrated");
    expect(unrated).toEqual({ severity: "Unrated", risks: 0, assumptions: 0, issues: 1, dependencies: 0, total: 1 });
  });

  it("By Status counts only open items", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "R", status: "Closed" }),
      item({ id: 3, category: "I", status: "In Progress" }),
    ], TODAY);
    const open = r.byStatus.find((row) => row.status === "Open")!;
    expect(open.count).toBe(1);
    expect(r.byStatus.find((row) => row.status === "Closed")).toBeUndefined();
  });

  it("By Status sorted by count desc", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open" }),
      item({ id: 2, category: "I", status: "In Progress" }),
      item({ id: 3, category: "I", status: "In Progress" }),
      item({ id: 4, category: "D", status: "Blocked" }),
    ], TODAY);
    expect(r.byStatus.map((row) => row.status)).toEqual(["In Progress", "Open", "Blocked"]);
  });

  it("By Owner: empty / whitespace owner normalized to sentinel", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", owner: "" }),
      item({ id: 2, category: "I", owner: "   " }),
      item({ id: 3, category: "A", owner: "Alex" }),
    ], TODAY);
    const sentinel = r.byOwner.find((row) => row.owner === UNASSIGNED_OWNER)!;
    expect(sentinel.total).toBe(2);
    expect(r.byOwner.find((row) => row.owner === "Alex")?.total).toBe(1);
  });

  it("By Owner sort: total desc, then owner asc", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", owner: "Bea" }),
      item({ id: 2, category: "I", owner: "Bea" }),
      item({ id: 3, category: "A", owner: "Alex" }),
      item({ id: 4, category: "D", owner: "Carl" }),
    ], TODAY);
    expect(r.byOwner.map((row) => row.owner)).toEqual(["Bea", "Alex", "Carl"]);
  });

  it("By Category: open/closed/overdue counts", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Open", targetDate: "2026-05-20" }),
      item({ id: 2, category: "R", status: "Open", targetDate: "2026-06-30" }),
      item({ id: 3, category: "R", status: "Closed" }),
      item({ id: 4, category: "I", status: "Open" }),
    ], TODAY);
    const rRow = r.byCategory.find((row) => row.category === "R")!;
    expect(rRow).toEqual({ category: "R", open: 2, closed: 1, overdue: 1 });
    const iRow = r.byCategory.find((row) => row.category === "I")!;
    expect(iRow.open).toBe(1);
    expect(iRow.overdue).toBe(0);
  });

  it("By Aging buckets at the boundaries", () => {
    const at = (n: number) => item({
      id: n,
      category: "R",
      status: "Open",
      raisedDate: addDays(TODAY, -n),
    });
    const r = computeRaidReport([at(0), at(30), at(31), at(60), at(61), at(90), at(91)], TODAY);
    const get = (b: "le30" | "31_60" | "61_90" | "gt90") => r.byAging.find((row) => row.bucket === b)!.open;
    expect(get("le30")).toBe(2);
    expect(get("31_60")).toBe(2);
    expect(get("61_90")).toBe(2);
    expect(get("gt90")).toBe(1);
  });

  it("Top 10 sorted by severity rank desc, age desc, id asc; cap = 10", () => {
    const items: RaidItem[] = [];
    for (let i = 1; i <= 12; i++) {
      items.push(item({ id: i, category: "I", severity: "Low", status: "Open" }));
    }
    items.push(item({ id: 100, category: "R", severity: "Critical", status: "Open" }));
    items.push(item({ id: 101, category: "R", severity: "High", status: "Open" }));
    const r = computeRaidReport(items, TODAY);
    expect(r.topOpen).toHaveLength(10);
    expect(r.topOpen[0]?.id).toBe(100);
    expect(r.topOpen[1]?.id).toBe(101);
  });

  it("Full Detail sorted by category (R, A, I, D) then id asc", () => {
    const r = computeRaidReport([
      item({ id: 3, category: "I" }),
      item({ id: 1, category: "R" }),
      item({ id: 2, category: "A" }),
      item({ id: 4, category: "D" }),
      item({ id: 5, category: "R" }),
    ], TODAY);
    expect(r.fullDetail.map((row) => row.id)).toEqual([1, 5, 2, 3, 4]);
  });

  it("clamps age to 0 when raisedDate is in the future", () => {
    const r = computeRaidReport([item({ id: 1, raisedDate: addDays(TODAY, 5) })], TODAY);
    expect(r.fullDetail[0].ageDays).toBe(0);
  });

  it("a closed item with a past target date is NOT overdue", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Closed", targetDate: "2026-05-20" }),
    ], TODAY);
    expect(r.fullDetail[0].overdue).toBe(false);
    expect(r.byCategory.find((row) => row.category === "R")!.overdue).toBe(0);
  });

  it("byOwner excludes closed items (only open work surfaces an owner)", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Closed", owner: "Dana" }),
    ], TODAY);
    expect(r.byOwner).toEqual([]);
  });

  it("a 'Mitigated' risk counts as closed (terminal-status set for R)", () => {
    const r = computeRaidReport([
      item({ id: 1, category: "R", status: "Mitigated" }),
    ], TODAY);
    expect(r.tiles.openR).toBe(0);
    expect(r.byCategory.find((row) => row.category === "R")!.closed).toBe(1);
  });
});

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
