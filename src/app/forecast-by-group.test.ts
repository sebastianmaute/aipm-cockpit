import { describe, expect, it } from "vitest";
import { forecastByGroup } from "./forecast-by-group";
import type { Task } from "./types";
import { workingDaysBefore } from "./working-days";

const TODAY = "2026-10-14";
const NONE: ReadonlySet<string> = new Set();
const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
const done = (id: number, completedDate: string, group: string): Task =>
  ({ id, taskName: `d${id}`, assignee: "", assigneeEmail: "", status: "Done", completedDate, group }) as Task;
const open = (id: number, group: string): Task => ({ id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do", group }) as Task;

describe("forecastByGroup (§502)", () => {
  const tasks: Task[] = [
    // "Build": a full history and a little open work.
    ...HISTORY.map((d, i) => done(1000 + i, d, "Build")),
    open(1, "Build"), open(2, "Build"),
    // "Docs": open work but only two finished tasks — below the floor.
    done(2000, HISTORY[0], "Docs"), done(2001, HISTORY[1], "Docs"), open(3, "Docs"),
    // "Archive": nothing open, so no row.
    done(3000, HISTORY[2], "Archive"),
    // Ungrouped, with a blank-but-spaced group.
    open(4, "  "),
  ];

  it("forecasts each group with open tasks on its own history, below-floor groups last", () => {
    const rows = forecastByGroup({ tasks, today: TODAY, holidaySet: NONE, planEnd: "2026-12-31" });
    expect(rows.map((r) => r.key)).toEqual(["Build", "Docs", ""]);
    const [build, docs, ungrouped] = rows;
    expect(build).toMatchObject({ kind: "forecast", open: 2 });
    expect(build.kind === "forecast" && build.chanceOnTime).toBe(1);
    expect(build.kind === "forecast" && build.p80 !== null && build.p80 >= TODAY).toBe(true);
    // The ungrouped row has no finished history of its own.
    expect(ungrouped).toMatchObject({ kind: "insufficient", open: 1, finished: 0 });
    expect(docs).toMatchObject({ kind: "insufficient", open: 1, finished: 2, neededFinished: 10 });
  });

  it("reads no chance on time without a valid plan end", () => {
    const rows = forecastByGroup({ tasks, today: TODAY, holidaySet: NONE, planEnd: "" });
    expect(rows[0]).toMatchObject({ key: "Build", kind: "forecast", chanceOnTime: null });
  });

  it("returns no rows when nothing is open", () => {
    expect(forecastByGroup({ tasks: [done(1, HISTORY[0], "A")], today: TODAY, holidaySet: NONE, planEnd: "2026-12-31" })).toEqual([]);
  });
});
