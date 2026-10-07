import { beforeEach, describe, expect, test } from "vitest";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import { CAUSE_CYCLE_DIAG_CODE, formatCauseLinks, guardRaidWrite, logCauseCycleBreak, repairLoadedRaid } from "./raid-cause-repair";
import type { RaidItem } from "./types";

function item(id: number, causedByRaidIds: number[]): RaidItem {
  return { id, category: "R", title: `Item ${id}`, status: "Open", linkedTaskIds: [], causedByRaidIds, stakeholderIds: [], raisedDate: "2026-01-01" };
}

const logged = () => readDiagLog().filter((e) => e.code === CAUSE_CYCLE_DIAG_CODE).map((e) => e.fields);

describe("raid-cause-repair (§674)", () => {
  beforeEach(() => clearDiagLog());

  test("repairLoadedRaid removes a loop by ascending id and logs it as a load", () => {
    const out = repairLoadedRaid([item(1, [2]), item(2, [1])]);
    expect(out.map((r) => r.causedByRaidIds)).toEqual([[2], []]);
    expect(logged()).toEqual([{ count: 1, links: "2 caused by 1", on: "load" }]);
  });

  test("repairLoadedRaid returns the same array and logs nothing when there is no loop", () => {
    const raid = [item(1, []), item(2, [1])];
    expect(repairLoadedRaid(raid)).toBe(raid);
    expect(logged()).toEqual([]);
  });

  test("guardRaidWrite refuses the link the write added and logs it as a write", () => {
    const prior = [item(1, []), item(2, [1])];
    const out = guardRaidWrite([item(1, [2]), item(2, [1])], prior);
    expect(out.map((r) => r.causedByRaidIds)).toEqual([[], [1]]);
    expect(logged()).toEqual([{ count: 1, links: "1 caused by 2", on: "write" }]);
  });

  test("guardRaidWrite returns the same array and logs nothing when the write closes no loop", () => {
    const next = [item(1, []), item(2, [1])];
    expect(guardRaidWrite(next, [])).toBe(next);
    expect(logged()).toEqual([]);
  });

  test("logCauseCycleBreak logs nothing for an empty list", () => {
    logCauseCycleBreak([], "write");
    expect(logged()).toEqual([]);
  });

  test("formatCauseLinks joins every dropped link", () => {
    expect(formatCauseLinks([{ childId: 2, parentId: 1 }, { childId: 5, parentId: 4 }])).toBe("2 caused by 1, 5 caused by 4");
  });
});
