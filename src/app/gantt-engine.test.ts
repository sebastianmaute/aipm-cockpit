import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGanttRows,
  clampNameColWidth,
  DAY_ROW_HEIGHT_PX,
  DEFAULT_PREFS,
  fmtWeekdayShort,
  GANTT_NAME_COL_MAX,
  GANTT_NAME_COL_MIN,
  HEADER_HEIGHT_PX,
  HEADER_ROW_HEIGHT_PX,
  LEFT_GUTTER_PX,
  loadPrefs,
  milestoneSlipDays,
  type PlacedMilestone,
  type PlacedTask,
  savePrefs,
} from "./gantt-engine";
import type { Milestone, Task } from "./types";

const PREFS_KEY = "aipm-cockpit:gantt-prefs";

describe("loadPrefs multi-select filters", () => {
  beforeEach(() => window.localStorage.clear());

  // Under the v2 schema an empty status list means "show nothing", so the
  // default is every status ticked. Priorities/assignees keep empty = all.
  it("defaults statuses to every bucket, priorities/assignees to empty (= all)", () => {
    const p = loadPrefs();
    expect([...p.statuses].sort()).toEqual(["completed", "open", "overdue"]);
    expect(p.priorities).toEqual([]);
    expect(p.assignees).toEqual([]);
  });

  it("parses saved arrays, filtering out invalid entries and de-duping", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statuses: ["open", "bogus", "overdue", "open"],
        priorities: ["High", "NotAPriority", "Low"],
        assignees: ["Sofia", "", "Sofia", "Bob"],
      }),
    );
    const p = loadPrefs();
    expect(p.statuses).toEqual(["open", "overdue"]);
    expect(p.priorities).toEqual(["High", "Low"]);
    expect(p.assignees).toEqual(["Sofia", "Bob"]);
  });

  it("migrates legacy scalar filter keys to single-element arrays", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ status: "overdue", priority: "High", assignee: "Sofia" }),
    );
    const p = loadPrefs();
    expect(p.statuses).toEqual(["overdue"]);
    expect(p.priorities).toEqual(["High"]);
    expect(p.assignees).toEqual(["Sofia"]);
  });

  it("treats the legacy 'all'/'All' sentinels as no filter", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ status: "all", priority: "All", assignee: "All" }),
    );
    const p = loadPrefs();
    // The blob carries no `v`, so the status sentinel parses to [] and then
    // migrates to every bucket — which is what "all" meant. The other two
    // filters still express "no filter" as an empty list.
    expect([...p.statuses].sort()).toEqual(["completed", "open", "overdue"]);
    expect(p.priorities).toEqual([]);
    expect(p.assignees).toEqual([]);
  });
});

describe("clampNameColWidth", () => {
  it("clamps below min and above max, passes through in-range", () => {
    expect(clampNameColWidth(50)).toBe(GANTT_NAME_COL_MIN);
    expect(clampNameColWidth(9999)).toBe(GANTT_NAME_COL_MAX);
    expect(clampNameColWidth(300)).toBe(300);
  });
  it("falls back to the default for a non-finite value", () => {
    expect(clampNameColWidth(Number.NaN)).toBe(LEFT_GUTTER_PX);
  });
});

describe("milestoneSlipDays", () => {
  it("is positive when the live date is later than the baseline (slipped)", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-06")).toBe(5);
  });
  it("is negative when the live date is earlier than the baseline (pulled in)", () => {
    expect(milestoneSlipDays("2026-06-10", "2026-06-07")).toBe(-3);
  });
  it("is zero when the dates match", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-01")).toBe(0);
  });
  it("returns null when either date is unparseable", () => {
    expect(milestoneSlipDays("not-a-date", "2026-06-01")).toBeNull();
    expect(milestoneSlipDays("2026-06-01", "")).toBeNull();
  });
});

describe("buildGanttRows milestone placement", () => {
  // Rows are built from PAIRS — a task with its bar, a milestone with its parsed
  // date — because the caller leaves out anything the chart cannot draw (§273).
  const task = (id: number, endIso: string): PlacedTask => ({
    task: { id, taskName: `T${id}` } as unknown as Task,
    bar: { start: new Date(endIso), end: new Date(endIso) },
  });
  const milestone = (id: number, date: string, achievedDate?: string): PlacedMilestone => ({
    milestone: { id, name: `M${id}`, date, achievedDate, linkedTaskIds: [] } as Milestone,
    date: new Date(date),
  });
  // Serialize a row list to compact keys for readable assertions.
  const keys = (rows: ReturnType<typeof buildGanttRows>): string[] =>
    rows.map((r) => (r.kind === "task" ? `t${r.task.id}` : `m${r.milestone.id}`));

  // Two tasks ending 2026-01-10 and 2026-02-10.
  const tasks = [task(1, "2026-01-10"), task(2, "2026-02-10")];

  it("'below' places every task first, then all milestones in date order", () => {
    const ms = [milestone(10, "2026-01-20"), milestone(11, "2026-03-01")];
    expect(keys(buildGanttRows(tasks, ms, "below"))).toEqual([
      "t1",
      "t2",
      "m10",
      "m11",
    ]);
  });

  it("'inline' splices each non-achieved milestone at its due-date position", () => {
    // m10 (01-20) sits after t1 (01-10) but before t2 (02-10); m11 (03-01) is
    // after every task so it lands at the end.
    const ms = [milestone(10, "2026-01-20"), milestone(11, "2026-03-01")];
    expect(keys(buildGanttRows(tasks, ms, "inline"))).toEqual([
      "t1",
      "m10",
      "t2",
      "m11",
    ]);
  });

  it("'inline' keeps achieved milestones at the end", () => {
    // ★ A milestone whose date does not parse is no longer representable here:
    // GanttPanel leaves it out before pairing (§273), and `gantt.test.tsx` pins
    // that. Both milestones below would inline by date if they were not achieved.
    const ms = [
      milestone(20, "2026-01-05", "2026-01-06"), // achieved → end
      milestone(21, "2026-01-07", "2026-01-08"), // achieved → end
    ];
    expect(keys(buildGanttRows(tasks, ms, "inline"))).toEqual([
      "t1",
      "t2",
      "m20",
      "m21",
    ]);
  });
});

describe("prefs v2 migration", () => {
  beforeEach(() => window.localStorage.clear());

  it("a legacy blob with an empty statuses array migrates to all statuses ticked", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sort: "auto", statuses: [] }),
    );
    expect([...loadPrefs().statuses].sort()).toEqual([
      "completed",
      "open",
      "overdue",
    ]);
  });

  it("a legacy blob with a non-empty statuses array is left alone", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sort: "auto", statuses: ["overdue"] }),
    );
    expect(loadPrefs().statuses).toEqual(["overdue"]);
  });

  it("a v2 blob with an empty statuses array keeps it empty", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ v: 2, sort: "auto", statuses: [] }),
    );
    expect(loadPrefs().statuses).toEqual([]);
  });

  it("savePrefs stamps the version, so an emptied filter survives a reload", () => {
    // The round trip is the point: without the version stamp the migration
    // above would re-expand a deliberately-emptied filter on every load and
    // the "show nothing" state would be unreachable.
    savePrefs({ ...DEFAULT_PREFS, statuses: [] });
    expect(loadPrefs().statuses).toEqual([]);
  });

  it("defaults the new display toggles when absent", () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 2, statuses: [] }));
    const p = loadPrefs();
    expect(p.showHolidays).toBe(true);
    expect(p.showAbsences).toBe(true);
    expect(p.showDependencies).toBe(true);
    expect(p.showMilestones).toBe(true);
    expect(p.showGrid).toBe(false);
  });

  it("honours a stored false for each display toggle", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        v: 2,
        statuses: [],
        showHolidays: false,
        showAbsences: false,
        showDependencies: false,
        showMilestones: false,
        showGrid: true,
      }),
    );
    const p = loadPrefs();
    expect(p.showHolidays).toBe(false);
    expect(p.showAbsences).toBe(false);
    expect(p.showDependencies).toBe(false);
    expect(p.showMilestones).toBe(false);
    expect(p.showGrid).toBe(true);
  });

  it("DEFAULT_PREFS ticks every status", () => {
    expect([...DEFAULT_PREFS.statuses].sort()).toEqual([
      "completed",
      "open",
      "overdue",
    ]);
  });
});

describe("fmtWeekdayShort", () => {
  // 2026-08-07 is a Friday in UTC.
  const friday = new Date(Date.UTC(2026, 7, 7));

  it("formats the short weekday in English", () => {
    expect(fmtWeekdayShort(friday, "en-US")).toBe("Fri");
  });

  it("treats en-GB as English, mirroring fmtMonth", () => {
    expect(fmtWeekdayShort(friday, "en-GB")).toBe("Fri");
  });

  it("formats the short weekday in German", () => {
    expect(fmtWeekdayShort(friday, "de")).toBe("Fr");
  });

  // ★ The guard that matters. Every date in this module is UTC-built and read
  //   with getUTCDay(); formatting in the host zone shifts the label by a day
  //   for any negative-offset zone. Which zone the runner happens to be in
  //   would otherwise decide whether this assertion can fail at all — under
  //   UTC (CI) or a positive offset (CET, this project's dev machines) a UTC
  //   midnight formats as the SAME calendar day with `timeZone: "UTC"`
  //   deleted, so the test would pass over the bug. The zone is therefore
  //   pinned to a negative-offset one for the duration of the assertion and
  //   restored afterwards, even on failure. Node re-reads `process.env.TZ` on
  //   assignment and notifies V8's date cache, which is what makes setting it
  //   mid-process take effect (same pattern as `resource-calendar.test.tsx`).
  it("reads the date in UTC, not the host zone", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York"; // UTC-4 in August
    try {
      // 2026-08-03 is a UTC Monday; the oracle is the hardcoded run of
      // weekdays, not another date-API call that could share the same bug.
      const expected = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.UTC(2026, 7, 3 + i)); // Mon 3rd .. Sun 9th
        expect(fmtWeekdayShort(d, "en-US")).toBe(expected[i]);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  });
});

describe("gantt header layout constants", () => {
  it("gives the day row more height than the month row, for the two-line label", () => {
    expect(DAY_ROW_HEIGHT_PX).toBeGreaterThan(HEADER_ROW_HEIGHT_PX);
  });

  // ★ NARROW BY CONSTRUCTION — read this before trusting it. `HEADER_HEIGHT_PX`
  //   is itself written as `HEADER_ROW_HEIGHT_PX + DAY_ROW_HEIGHT_PX`, so both
  //   sides of this assertion move together and it CANNOT catch a future height
  //   edit leaving the total stale (an earlier comment here claimed it could).
  //   The one mutation it does catch is the total drifting back to a form that
  //   is not the sum of the two bands — the literal `HEADER_ROW_HEIGHT_PX * 2`
  //   it used to be, or a hardcoded number. That the RENDERED header actually
  //   spans its two rendered bands is pinned in `gantt-chrome.test.tsx`, which
  //   sums the DOM rather than the constants.
  it("totals the two header rows exactly", () => {
    expect(HEADER_HEIGHT_PX).toBe(HEADER_ROW_HEIGHT_PX + DAY_ROW_HEIGHT_PX);
  });
});
