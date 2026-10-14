import { describe, expect, test } from "vitest";
import type { Task } from "../types";
import type { HistoryWindow } from "./constants";
import { dailyThroughput } from "./throughput";

// 2026-10-14 is a Wednesday. 2026-10-12 (Mon) is a holiday in this fixture.
const TODAY = "2026-10-14";
const HOLIDAYS: ReadonlySet<string> = new Set(["2026-10-12"]);

function task(over: Partial<Task>): Task {
  return { id: 1, title: "t", status: "Done", ...over } as Task;
}
function done(id: number, completedDate: string, minutes?: number): Task {
  return task({ id, status: "Done", completedDate, originalEstimateMinutes: minutes });
}
// Short windows (5, 3) keep the fixtures small; the engine takes any day count.
function run(tasks: Task[], window: number | "all" = 5, unit: "tasks" | "effort" = "tasks", today = TODAY) {
  return dailyThroughput({ tasks, today, window: window as HistoryWindow, holidaySet: HOLIDAYS, unit });
}

describe("dailyThroughput", () => {
  test("counts Done tasks per working day and keeps zero days", () => {
    // 5-day window ending Wed 14th: Oct 8, 9, 13, 14 are working; the 12th is a holiday -> 8,9,13,14 + 7.
    // The completion on the 7th opens the window there (R14), so the 8th and 9th are real zero days.
    const h = run([done(1, "2026-10-13"), done(2, "2026-10-13"), done(3, "2026-10-14"), done(4, "2026-10-07")]);
    expect(h.samples).toHaveLength(5);
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(4);
    expect(h.samples).toContain(0);
    expect(h.days[h.days.length - 1]).toBe(TODAY);
    expect(h.finished).toBe(4);
  });

  test("excludes Cancelled tasks", () => {
    const h = run([done(1, "2026-10-13"), task({ id: 2, status: "Cancelled", completedDate: "2026-10-13" })]);
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(1);
    expect(h.finished).toBe(1);
  });

  test("counts Done-without-date separately", () => {
    const h = run([task({ id: 1, status: "Done", completedDate: undefined }), done(2, "2026-10-13")]);
    expect(h.doneWithoutDate).toBe(1);
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(1);
  });

  test("moves a Saturday completion to Monday", () => {
    // Today Wed 14th, Saturday 10th -> next working day is Mon 12th (holiday) -> Tue 13th
    const h = run([done(1, "2026-10-10")]);
    expect(h.samples[h.days.indexOf("2026-10-13")]).toBe(1);
    const noHoliday = dailyThroughput({ tasks: [done(1, "2026-10-10")], today: TODAY, window: 5 as HistoryWindow, holidaySet: new Set(), unit: "tasks" });
    expect(noHoliday.samples[noHoliday.days.indexOf("2026-10-12")]).toBe(1);
  });

  test("moves a holiday completion to the next working day", () => {
    const h = run([done(1, "2026-10-12")]);
    expect(h.samples[h.days.indexOf("2026-10-13")]).toBe(1);
  });

  test("effort unit counts an unestimated Done task at unestimatedSize, default 0", () => {
    const tasks = [done(1, "2026-10-13", 30), done(2, "2026-10-13")];
    const total = (size?: number) =>
      dailyThroughput({ tasks, today: TODAY, window: 5 as HistoryWindow, holidaySet: HOLIDAYS, unit: "effort", unestimatedSize: size })
        .samples.reduce((a, b) => a + b, 0);
    expect(total()).toBe(30);
    expect(total(60)).toBe(90);
  });

  test("a shift that would pass today counts on the window's last working day, never dropped", () => {
    // Today Saturday 17th, done today: Monday 19th is past today, so it counts on Friday 16th.
    const sat = run([done(1, "2026-10-17")], 5, "tasks", "2026-10-17");
    expect(sat.finished, "a weekend completion on a weekend today is counted").toBe(1);
    expect(sat.days[sat.days.length - 1]).toBe("2026-10-16");
    expect(sat.samples[sat.days.indexOf("2026-10-16")]).toBe(1);
    // Today the Monday holiday 12th, done Sunday 11th: Tuesday 13th is past today, so Friday 9th.
    const holiday = run([done(1, "2026-10-11")], 5, "tasks", "2026-10-12");
    expect(holiday.samples[holiday.days.indexOf("2026-10-09")], "a holiday today counts on the day before").toBe(1);
    // Completion on Sunday with today Monday: next working day is today, counted there.
    const mon = run([done(1, "2026-10-18")], 5, "tasks", "2026-10-19");
    expect(mon.samples[mon.days.indexOf("2026-10-19")]).toBe(1);
  });

  test("ignores invalid and future completedDate", () => {
    const h = run([done(1, "2026-10-15"), done(2, "garbage"), done(3, "2026-13-45"), done(4, "")]);
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(0);
    expect(h.finished).toBe(0);
    // A blank string is no date at all, so it is the Done-without-date case, not an invalid one.
    expect(h.doneWithoutDate).toBe(1);
  });

  test("effort unit sums originalEstimateMinutes", () => {
    const h = run([done(1, "2026-10-13", 60), done(2, "2026-10-13", 30), done(3, "2026-10-14")], 5, "effort");
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(90);
    expect(h.finished).toBe(3);
  });

  test("window 'all' starts at the first completion", () => {
    const h = run([done(1, "2026-10-08"), done(2, "2026-10-14")], "all");
    expect(h.days[0]).toBe("2026-10-08");
    expect(h.days[h.days.length - 1]).toBe(TODAY);
    expect(h.samples.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test("excludes completions older than the window", () => {
    const h = run([done(1, "2026-09-01"), done(2, "2026-10-14")]);
    expect(h.finished).toBe(1);
  });

  test("a non-working today ends the window on the previous working day", () => {
    const h = run([done(1, "2026-10-16"), done(2, "2026-10-14")], 3, "tasks", "2026-10-17");
    expect(h.days).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(h.samples).toEqual([1, 0, 1]);
  });

  test("a fixed window starts no earlier than the first completion (R14)", () => {
    // Window 30 asks for 30 working days, but the team first finished on Thu 8th: the days before
    // are not real zero days. Oct 8, 9, 13, 14 remain (the 12th is a holiday).
    const h = run([done(1, "2026-10-08"), done(2, "2026-10-14")], 30);
    expect(h.days).toEqual(["2026-10-08", "2026-10-09", "2026-10-13", "2026-10-14"]);
    expect(h.samples).toEqual([1, 0, 0, 1]);
  });

  test("window 30 is 30 working days ending today when history is older (T1c)", () => {
    const h = run([done(1, "2026-06-01"), done(2, "2026-10-14")], 30);
    expect(h.days).toHaveLength(30);
    expect(h.days[29]).toBe(TODAY);
    // 30 working days back from Wed 14th, skipping the holiday on the 12th, starts on Wed 2 Sep.
    expect(h.days[0]).toBe("2026-09-02");
    expect(h.finished).toBe(1);
  });

  test("a fixed window with no completions is empty", () => {
    expect(run([], 30)).toEqual({ samples: [], days: [], finished: 0, doneWithoutDate: 0 });
  });

  test("window 'all' with no completions yields an empty history", () => {
    const h = run([], "all");
    expect(h).toEqual({ samples: [], days: [], finished: 0, doneWithoutDate: 0 });
  });
});
