import { describe, expect, it } from "vitest";
import {
  AWAY_SUMMARY_MAX_LINES,
  absencesOfPerson,
  buildAwaySummary,
  milestoneClashes,
  taskClashes,
  type AbsenceCtx,
} from "./absence-clash";
import type { Absence, Resource, Task } from "./types";

const maya = { id: 1, firstName: "Maya", lastName: "Patel" } as Resource;
const liam = { id: 2, firstName: "Liam", lastName: "Foster" } as Resource;

function absence(over: Partial<Absence> & Pick<Absence, "assignee" | "startDate" | "endDate">): Absence {
  return { id: 1, type: "vacation", ...over } as Absence;
}

function ctx(absences: Absence[], holidays: string[] = [], resources: Resource[] = [maya, liam]): AbsenceCtx {
  return { absences, resources, holidaySet: new Set(holidays) };
}

// 2026-11-02 is a Monday.
const MAYA_WEEK = absence({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-03", endDate: "2026-11-07" });

describe("taskClashes: rule (a), a date on an absence day", () => {
  it("flags a due date inside an absence", () => {
    const out = taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-05" }, ctx([MAYA_WEEK]));
    expect(out).toEqual([
      {
        person: "Maya Patel",
        resourceId: 1,
        reason: "date-on-absence",
        which: "due",
        date: "2026-11-05",
        ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
      },
    ]);
  });

  it("flags a start date inside an absence", () => {
    const out = taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-04", dueDate: "2026-11-20" }, ctx([MAYA_WEEK]));
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("date-on-absence");
    expect(out[0].date).toBe("2026-11-04");
  });

  it("counts a weekend due date inside an absence as on an absence day", () => {
    const long = absence({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-02", endDate: "2026-11-15" });
    const out = taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-08" }, ctx([long]));
    expect(out[0]?.reason).toBe("date-on-absence");
  });

  it("returns nothing when the date is outside every absence", () => {
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-09" }, ctx([MAYA_WEEK]))).toEqual([]);
  });
});

describe("taskClashes: which date clashes", () => {
  const c = ctx([MAYA_WEEK]);
  it("says due when the due date is inside the absence", () => {
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-05" }, c)[0].which).toBe("due");
  });
  it("says start when only the START date is inside the absence", () => {
    const out = taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-04", dueDate: "2026-11-20" }, c);
    expect(out[0]).toMatchObject({ reason: "date-on-absence", which: "start", date: "2026-11-04" });
  });
  it("says milestone for a milestone date", () => {
    const out = milestoneClashes({ date: "2026-11-05", linkedTaskIds: [1] }, [{ id: 1, assignee: "Maya Patel", resourceId: 1 } as Task], c);
    expect(out[0].which).toBe("milestone");
  });
  it("sets no `which` on a span clash", () => {
    const out = taskClashes({ assignee: "Liam Foster", resourceId: 2, startDate: "2026-11-07", dueDate: "2026-11-12" },
      ctx([absence({ assignee: "Liam Foster", resourceId: 2, startDate: "2026-11-09", endDate: "2026-11-11" })]));
    expect(out[0].which).toBeUndefined();
  });
});

describe("clash person name", () => {
  it("is one line, so it is safe in a tool result", () => {
    const a = absence({ assignee: "x\n#9 away", startDate: "2026-11-03", endDate: "2026-11-07" });
    const out = taskClashes({ assignee: " x\n#9 away ", resourceId: undefined, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]));
    expect(out[0].person).toBe("x #9 away");
  });
});

describe("taskClashes: rule (b), absent most of the span", () => {
  // A Saturday start keeps the start and due dates off the absence, so only rule (b) can fire.
  // Sat 2026-11-07 .. Thu 2026-11-12: working days Mon 9, Tue 10, Wed 11, Thu 12 = 4.
  const task = { assignee: "Liam Foster", resourceId: 2, startDate: "2026-11-07", dueDate: "2026-11-12" } as const;
  const away = (startDate: string, endDate: string) => absence({ assignee: "Liam Foster", resourceId: 2, startDate, endDate });

  it("is not a clash at exactly half (2 of 4)", () => {
    expect(taskClashes(task, ctx([away("2026-11-09", "2026-11-10")]))).toEqual([]);
  });

  it("is a clash above half (3 of 4)", () => {
    const out = taskClashes(task, ctx([away("2026-11-09", "2026-11-11")]));
    expect(out).toEqual([
      { person: "Liam Foster", resourceId: 2, reason: "absent-most-of-span", ranges: [{ start: "2026-11-09", end: "2026-11-11" }] },
    ]);
  });

  it("excludes weekends from the span", () => {
    // Fri 11-06 .. Mon 11-09 = 2 working days; absent over the weekend only = 0 of them.
    const weekend = away("2026-11-07", "2026-11-08");
    expect(taskClashes({ ...task, startDate: "2026-11-06", dueDate: "2026-11-09" }, ctx([weekend]))).toEqual([]);
  });

  it("excludes holidays from the span", () => {
    // Sat 11-07 .. Thu 11-12 with Mon 9 a holiday = 3 working days; absent Mon-Tue = 1 of 3.
    expect(taskClashes(task, ctx([away("2026-11-09", "2026-11-10")], ["2026-11-09"]))).toEqual([]);
    // Holidays Wed and Thu leave Mon-Tue = 2 working days, both absent -> clash.
    expect(taskClashes(task, ctx([away("2026-11-09", "2026-11-10")], ["2026-11-11", "2026-11-12"]))[0]?.reason).toBe("absent-most-of-span");
  });

  it("does not apply rule (b) without a stored start date", () => {
    expect(taskClashes({ ...task, startDate: undefined, dueDate: "2026-12-10" }, ctx([away("2026-11-02", "2026-11-30")]))).toEqual([]);
  });

  it("prefers the more specific rule (a) when a date is also on the absence", () => {
    const out = taskClashes({ ...task, dueDate: "2026-11-11" }, ctx([away("2026-11-09", "2026-11-11")]));
    expect(out[0]?.reason).toBe("date-on-absence");
  });
});

describe("matcher: linked and unlinked people", () => {
  it("matches a linked task to a linked absence by id, ignoring a different typed name", () => {
    const a = absence({ assignee: "M. Patel", resourceId: 1, startDate: "2026-11-03", endDate: "2026-11-07" });
    const out = taskClashes({ assignee: "Someone Else", resourceId: 1, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]));
    expect(out).toHaveLength(1);
    expect(out[0].person).toBe("Maya Patel");
  });

  it("matches a linked task to an UNLINKED absence by the resource's name", () => {
    const a = absence({ assignee: "maya patel", startDate: "2026-11-03", endDate: "2026-11-07" });
    expect(taskClashes({ assignee: "", resourceId: 1, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]))).toHaveLength(1);
  });

  it("an unlinked task matches a linked absence by its typed assignee", () => {
    const a = absence({ assignee: "Maya Patel", resourceId: 2, startDate: "2026-11-03", endDate: "2026-11-07" });
    // The unlinked task matches on Absence.assignee, whatever that absence's resourceId says.
    expect(taskClashes({ assignee: "  MAYA patel ", resourceId: undefined, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]))).toHaveLength(1);
  });

  it("does not match a linked task to a linked absence of another resource with the same typed name", () => {
    const a = absence({ assignee: "Maya Patel", resourceId: 2, startDate: "2026-11-03", endDate: "2026-11-07" });
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]))).toEqual([]);
  });

  it("treats a dangling resourceId as unlinked and matches on the typed name", () => {
    const a = absence({ assignee: "Ghost", startDate: "2026-11-03", endDate: "2026-11-07" });
    const out = taskClashes({ assignee: "ghost", resourceId: 99, startDate: undefined, dueDate: "2026-11-04" }, ctx([a]));
    expect(out).toHaveLength(1);
    expect(out[0].resourceId).toBeUndefined();
    expect(out[0].person).toBe("ghost");
  });

  it("absencesOfPerson returns [] for a blank, unlinked name", () => {
    expect(absencesOfPerson({ name: "  " }, ctx([MAYA_WEEK]))).toEqual([]);
  });
});

describe("degenerate input: no warning, no crash", () => {
  it("a task with no due date and no start date", () => {
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "" }, ctx([MAYA_WEEK]))).toEqual([]);
  });

  it("a task with no owner", () => {
    expect(taskClashes({ assignee: "", resourceId: undefined, startDate: undefined, dueDate: "2026-11-04" }, ctx([MAYA_WEEK]))).toEqual([]);
  });

  it("an absence whose end is before its start", () => {
    // Reversed absence 07 -> 03 sits between the task's dates; read as a range it would cover 04..06.
    const bad = absence({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-07", endDate: "2026-11-03" });
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-02", dueDate: "2026-11-09" }, ctx([bad]))).toEqual([]);
    expect(buildAwaySummary({ absences: [bad], resources: [maya], from: "2026-11-02", to: "2026-11-30" })).toEqual([]);
  });

  it("a task whose due date is before its start date", () => {
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-09", dueDate: "2026-11-02" }, ctx([MAYA_WEEK]))).toEqual([]);
  });

  it("a milestone with no linked tasks", () => {
    expect(milestoneClashes({ date: "2026-11-04", linkedTaskIds: [] }, [], ctx([MAYA_WEEK]))).toEqual([]);
  });

  it("an absence with an unparseable date is ignored", () => {
    const bad = absence({ assignee: "Maya Patel", resourceId: 1, startDate: "soon", endDate: "later" });
    expect(taskClashes({ assignee: "Maya Patel", resourceId: 1, startDate: undefined, dueDate: "2026-11-04" }, ctx([bad]))).toEqual([]);
  });
});

describe("milestoneClashes", () => {
  const task = (id: number, assignee: string, resourceId?: number): Task => ({ id, assignee, resourceId } as Task);

  it("flags a milestone date on the absence of a linked task's owner", () => {
    const out = milestoneClashes({ date: "2026-11-05", linkedTaskIds: [10] }, [task(10, "Maya Patel", 1)], ctx([MAYA_WEEK]));
    expect(out).toHaveLength(1);
    expect(out[0].person).toBe("Maya Patel");
    expect(out[0].date).toBe("2026-11-05");
  });

  it("returns one clash per away owner and ignores tasks that are not linked", () => {
    const l = absence({ id: 2, assignee: "Liam Foster", resourceId: 2, startDate: "2026-11-05", endDate: "2026-11-05" });
    const out = milestoneClashes(
      { date: "2026-11-05", linkedTaskIds: [10, 11] },
      [task(10, "Maya Patel", 1), task(11, "Liam Foster", 2), task(12, "Maya Patel", 1)],
      ctx([MAYA_WEEK, l]),
    );
    expect(out.map((c) => c.person).sort()).toEqual(["Liam Foster", "Maya Patel"]);
  });

  it("reports one owner once when several linked tasks share them", () => {
    const out = milestoneClashes(
      { date: "2026-11-05", linkedTaskIds: [10, 11] },
      [task(10, "Maya Patel", 1), task(11, "maya patel", 1)],
      ctx([MAYA_WEEK]),
    );
    expect(out).toHaveLength(1);
  });

  it("skips unowned linked tasks and owners who are not away", () => {
    const out = milestoneClashes({ date: "2026-11-05", linkedTaskIds: [10, 11] }, [task(10, ""), task(11, "Liam Foster", 2)], ctx([MAYA_WEEK]));
    expect(out).toEqual([]);
  });
});

describe("buildAwaySummary", () => {
  const window = { from: "2026-11-02", to: "2026-11-30" };

  it("returns [] when nobody is away in the window", () => {
    expect(buildAwaySummary({ absences: [MAYA_WEEK], resources: [maya], from: "2026-12-01", to: "2026-12-28" })).toEqual([]);
    expect(buildAwaySummary({ absences: [], resources: [maya], ...window })).toEqual([]);
  });

  it("lists a header and one line per person with merged, clipped ranges", () => {
    const second = absence({ id: 2, assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-20", endDate: "2026-11-20" });
    const before = absence({ id: 3, assignee: "Liam Foster", resourceId: 2, startDate: "2026-10-28", endDate: "2026-11-03" });
    const lines = buildAwaySummary({ absences: [MAYA_WEEK, second, before], resources: [maya, liam], ...window });
    expect(lines).toEqual([
      "AWAY (absent days; type and reason not shown):",
      '#2|name: "Liam Foster" away 2026-11-02..2026-11-03',
      '#1|name: "Maya Patel" away 2026-11-03..2026-11-07, 2026-11-20',
    ]);
  });

  it("never shows the type or the note", () => {
    const secret = absence({ assignee: "Maya Patel", resourceId: 1, startDate: "2026-11-03", endDate: "2026-11-03", type: "sick", note: "chemo" });
    const text = buildAwaySummary({ absences: [secret], resources: [maya], ...window }).join("\n");
    expect(text).not.toMatch(/sick|chemo/i);
  });

  it("quotes a hostile name so it cannot start a line of its own", () => {
    const hostile = absence({ assignee: "x\n#9 away", startDate: "2026-11-03", endDate: "2026-11-03" });
    const lines = buildAwaySummary({ absences: [hostile], resources: [], ...window });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('#-|name: "x #9 away" away 2026-11-03');
  });

  it("caps the people lines and says how many were cut", () => {
    const people = Array.from({ length: 65 }, (_, i) =>
      absence({ id: i + 1, assignee: `Person ${String(i).padStart(2, "0")}`, startDate: "2026-11-03", endDate: "2026-11-03" }),
    );
    const lines = buildAwaySummary({ absences: people, resources: [], ...window });
    expect(AWAY_SUMMARY_MAX_LINES).toBe(60);
    expect(lines).toHaveLength(1 + 60 + 1);
    expect(lines[lines.length - 1]).toBe("…(5 more people truncated)");
  });

  it("returns [] for a malformed or reversed window", () => {
    const base = { absences: [MAYA_WEEK], resources: [maya] };
    expect(buildAwaySummary({ ...base, from: "2026-11-30", to: "2026-11-02" })).toEqual([]);
    expect(buildAwaySummary({ ...base, from: "soon", to: "2026-11-30" })).toEqual([]);
    expect(buildAwaySummary({ ...base, from: "2026-11-02", to: "" })).toEqual([]);
  });

  it("honours a smaller maxLines", () => {
    const people = [1, 2, 3].map((i) => absence({ id: i, assignee: `P${i}`, startDate: "2026-11-03", endDate: "2026-11-03" }));
    const lines = buildAwaySummary({ absences: people, resources: [], ...window, maxLines: 2 });
    expect(lines).toHaveLength(1 + 2 + 1);
    expect(lines[3]).toBe("…(1 more people truncated)");
  });
});
