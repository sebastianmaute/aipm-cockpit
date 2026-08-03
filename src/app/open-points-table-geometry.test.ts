import { describe, expect, it } from "vitest";
import {
  GUTTER_WIDTH_PX,
  TASK_NAME_MIN_PX,
  colWidthStyle,
  tableMinWidthPx,
  visibleTaskCols,
} from "./open-points-table-geometry";
import { ALL_TASK_COLS, DEFAULT_COL_WIDTHS } from "./tasks-section-columns";

describe("visibleTaskCols", () => {
  // ★ Assert the WHOLE list, not a sampled pair. `indexOf("id") < indexOf("taskName")`
  //   catches a reversal and nothing else — it would pass a list that dropped or
  //   reordered any of the other 16. Order is load-bearing here: the colgroup maps
  //   this array positionally onto the rendered columns.
  it("drops hidden columns and preserves declaration order", () => {
    const hidden = new Set(["assignee", "sel"]);
    expect(visibleTaskCols(hidden)).toEqual(ALL_TASK_COLS.filter((c) => !hidden.has(c)));
  });

  it("returns every column when nothing is hidden", () => {
    // toHaveLength(18) would pass for 18 wrong strings.
    expect(visibleTaskCols(new Set())).toEqual([...ALL_TASK_COLS]);
  });
});

describe("tableMinWidthPx", () => {
  it("sums the gutter plus every visible column's width", () => {
    const width = tableMinWidthPx(["id", "taskName", "actions"], {});
    expect(width).toBe(
      GUTTER_WIDTH_PX + DEFAULT_COL_WIDTHS.id + TASK_NAME_MIN_PX + DEFAULT_COL_WIDTHS.actions,
    );
  });

  it("counts an un-sized taskName at the floor", () => {
    // ★ This case CANNOT distinguish floor logic from a generic default lookup:
    //   DEFAULT_COL_WIDTHS.taskName currently equals TASK_NAME_MIN_PX, so both
    //   spellings produce the same number. The first assertion pins that
    //   coincidence so a future change to either constant surfaces here rather
    //   than silently diverging; the discriminating case is
    //   "never drops below the floor for a user-sized taskName under it" below.
    expect(DEFAULT_COL_WIDTHS.taskName).toBe(TASK_NAME_MIN_PX);
    const width = tableMinWidthPx(["taskName"], {});
    expect(width).toBe(GUTTER_WIDTH_PX + TASK_NAME_MIN_PX);
  });

  it("honours a user-sized taskName above the floor", () => {
    const width = tableMinWidthPx(["taskName"], { taskName: 500 });
    expect(width).toBe(GUTTER_WIDTH_PX + 500);
  });

  it("never drops below the floor for a user-sized taskName under it", () => {
    // The floor is what guarantees the flex column stays readable once the
    // container is narrower than the table; honouring the smaller user width
    // here would force horizontal scroll later than intended and let the
    // titles collapse.
    const width = tableMinWidthPx(["taskName"], { taskName: 60 });
    expect(width).toBe(GUTTER_WIDTH_PX + TASK_NAME_MIN_PX);
  });

  // ★ Route through `visibleTaskCols` rather than two hand-written lists: the
  //   title claims something about HIDING, and hiding is what the pane actually
  //   does. Hand-written lists test the arithmetic while describing a scenario
  //   the test never runs.
  it("drops by exactly a column's width when that column is hidden", () => {
    const all = tableMinWidthPx(visibleTaskCols(new Set()), {});
    const without = tableMinWidthPx(visibleTaskCols(new Set(["priority"])), {});
    expect(all - without).toBe(DEFAULT_COL_WIDTHS.priority);
  });

  it("uses a user-sized width over the default", () => {
    expect(tableMinWidthPx(["id"], { id: 300 }) - tableMinWidthPx(["id"], {})).toBe(
      300 - DEFAULT_COL_WIDTHS.id,
    );
  });
});

// ★★ A column id with no DEFAULT_COL_WIDTHS entry is unreachable today — all 18
//    ids have one. It becomes reachable the moment somebody adds an id to
//    ALL_TASK_COLS without a default, and BOTH failure modes are silent: an
//    undefined width makes it a SECOND auto column (destroying the single-flex
//    -column premise the whole module rests on), and a 0 contribution
//    under-measures the table. Neither is visible in jsdom. Pinned so the two
//    functions cannot drift apart again.
describe("an unknown column id", () => {
  it("gets a real width, not undefined, so it never becomes a second flex column", () => {
    expect(colWidthStyle("notAColumn", {})).toBeGreaterThan(0);
  });

  it("contributes the same width to the table minimum that it renders at", () => {
    const rendered = colWidthStyle("notAColumn", {});
    const contributed = tableMinWidthPx(["notAColumn"], {}) - GUTTER_WIDTH_PX;
    expect(contributed).toBe(rendered);
  });
});

describe("colWidthStyle", () => {
  it("returns undefined for an un-sized taskName so it becomes the flex column", () => {
    expect(colWidthStyle("taskName", {})).toBeUndefined();
  });

  it("returns the user's width for a sized taskName", () => {
    expect(colWidthStyle("taskName", { taskName: 420 })).toBe(420);
  });

  it("returns the default for every other un-sized column", () => {
    expect(colWidthStyle("status", {})).toBe(DEFAULT_COL_WIDTHS.status);
    expect(colWidthStyle("actions", {})).toBe(DEFAULT_COL_WIDTHS.actions);
  });

  it("returns the user's width for a sized non-flex column", () => {
    expect(colWidthStyle("status", { status: 77 })).toBe(77);
  });
});
