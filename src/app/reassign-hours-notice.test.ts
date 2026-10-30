import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n } from "./i18n";
import { defaultPeriodLabel, hoursMoveNotice, type HoursMoveNoticeCtx } from "./reassign-hours-notice";
import { type HoursMovePlan, type TaskHoursMove } from "./reassign-hours";

const NAMES: Record<number, string> = { 1: "Maya Patel", 2: "Liam Foster", 3: "Ana" };
const TASKS: Record<number, string> = { 10: "Data migration", 11: "API", 12: "UI" };

function ctx(lang: HoursMoveNoticeCtx["lang"]): HoursMoveNoticeCtx {
  return {
    lang,
    resourceName: (id) => NAMES[id] ?? `#${id}`,
    periodLabel: (key) => defaultPeriodLabel(key, lang),
    taskName: (id) => TASKS[id] ?? `#${id}`,
  };
}

function move(over: Partial<TaskHoursMove> = {}): TaskHoursMove {
  return {
    taskId: 10,
    fromResourceId: 1,
    toResourceId: 2,
    perPeriod: [
      { periodKey: "2026-09", hours: 8 },
      { periodKey: "2026-10", hours: 8 },
    ],
    movedHours: 16,
    shortfallHours: 0,
    receiverCapHours: 0,
    outsideWindowHours: 0,
    ...over,
  };
}

const plan = (moves: TaskHoursMove[], overCapacity: HoursMovePlan["overCapacity"] = []): HoursMovePlan => ({
  moves,
  nextResources: [],
  edits: [],
  overCapacity,
});

describe("defaultPeriodLabel", () => {
  it("labels months and weeks (R1)", () => {
    expect(defaultPeriodLabel("2026-09", "en-US")).toBe("Sep");
    expect(defaultPeriodLabel("2026-01", "en-US")).toBe("Jan");
    expect(defaultPeriodLabel("2026-W38", "en-US")).toBe("W38");
    expect(defaultPeriodLabel("odd", "en-US")).toBe("odd");
  });
});

describe("hoursMoveNotice (EN)", () => {
  it("one task moved", () => {
    expect(hoursMoveNotice(plan([move()]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h).",
    );
  });
  it("shortfall, receiver cap and outside-window parts", () => {
    const m = move({ shortfallHours: 4, receiverCapHours: 6, outsideWindowHours: 2 });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h) (4 h not in Maya Patel's plan) (6 h kept: Liam Foster is at 100 %) (2 h outside the plan).",
    );
  });
  it("over capacity comes last", () => {
    const text = hoursMoveNotice(plan([move()], [{ resourceId: 2, periodKey: "2026-09", percent: 130 }]), ctx("en-US"));
    expect(text).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h). Liam Foster is now at 130 % in Sep.",
    );
  });
  it("each reason has its sentence", () => {
    const one = (reason: TaskHoursMove["reason"]) =>
      hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, reason })]), ctx("en-US"));
    expect(one("noEstimate")).toBe("Data migration has no remaining estimate, so no planned hours moved.");
    expect(one("closed")).toBe("Data migration is closed, so no planned hours moved.");
    expect(one("unlinked")).toBe("Data migration has an owner without a linked resource, so no planned hours moved.");
    expect(one("outsideWindow")).toBe("Data migration lies outside the resource plan, so no planned hours moved.");
  });
  it("sums a batch to one receiver per person", () => {
    const moves = [
      move({ taskId: 10, movedHours: 8, perPeriod: [{ periodKey: "2026-09", hours: 8 }] }),
      move({ taskId: 11, movedHours: 8, perPeriod: [{ periodKey: "2026-09", hours: 4 }, { periodKey: "2026-10", hours: 4 }] }),
      move({ taskId: 12, movedHours: 8, perPeriod: [{ periodKey: "2026-10", hours: 8 }] }),
    ];
    expect(hoursMoveNotice(plan(moves), ctx("en-US"))).toBe(
      "Moved 24 h for 3 tasks from Maya Patel to Liam Foster (Sep 12 h, Oct 12 h).",
    );
  });
  it("one sentence per giver/receiver pair, then reasons", () => {
    const moves = [
      move(),
      move({ taskId: 11, fromResourceId: 3, toResourceId: 2, movedHours: 0.5, perPeriod: [{ periodKey: "2026-09", hours: 0.5 }] }),
      move({ taskId: 12, perPeriod: [], movedHours: 0, reason: "closed" }),
    ];
    expect(hoursMoveNotice(plan(moves), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h). Moved 0.5 h from Ana to Liam Foster (Sep 0.5 h). UI is closed, so no planned hours moved.",
    );
  });
  it("returns null when everything is silent", () => {
    expect(hoursMoveNotice(plan([]), ctx("en-US"))).toBeNull();
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0 })]), ctx("en-US"))).toBeNull();
  });
});

describe("hoursMoveNotice (DE)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  it("renders German, with a German month label", () => {
    expect(hoursMoveNotice(plan([move()]), ctx("de"))).toBe(
      `${"16 Std. von Maya Patel auf Liam Foster verschoben"} (${defaultPeriodLabel("2026-09", "de")} 8 h, ${defaultPeriodLabel("2026-10", "de")} 8 h).`,
    );
  });
  it("renders a reason", () => {
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, reason: "noEstimate" })]), ctx("de"))).toBe(
      "Data migration hat keine Restschätzung, daher wurden keine geplanten Stunden verschoben.",
    );
  });
  it("pins the German month labels", () => {
    expect(defaultPeriodLabel("2026-09", "de")).toBe("Sep");
  });
});
