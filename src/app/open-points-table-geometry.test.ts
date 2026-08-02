import { describe, expect, it } from "vitest";
import {
  GUTTER_WIDTH_PX,
  TASK_NAME_MIN_PX,
  colWidthStyle,
  tableMinWidthPx,
  visibleTaskCols,
} from "./open-points-table-geometry";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";

describe("visibleTaskCols", () => {
  it("drops hidden columns and preserves declaration order", () => {
    const cols = visibleTaskCols(new Set(["assignee", "sel"]));
    expect(cols).not.toContain("assignee");
    expect(cols).not.toContain("sel");
    expect(cols.indexOf("id")).toBeLessThan(cols.indexOf("taskName"));
  });

  it("returns every column when nothing is hidden", () => {
    expect(visibleTaskCols(new Set())).toHaveLength(18);
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

  it("drops by exactly a column's width when that column is hidden", () => {
    const all = tableMinWidthPx(["id", "taskName", "priority"], {});
    const without = tableMinWidthPx(["id", "taskName"], {});
    expect(all - without).toBe(DEFAULT_COL_WIDTHS.priority);
  });

  it("uses a user-sized width over the default", () => {
    expect(tableMinWidthPx(["id"], { id: 300 }) - tableMinWidthPx(["id"], {})).toBe(
      300 - DEFAULT_COL_WIDTHS.id,
    );
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
