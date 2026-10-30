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
    expect(defaultPeriodLabel("2026-W38", "de")).toBe("KW 38");
    expect(defaultPeriodLabel("2026-10", "de")).toBe("Okt");
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
  it("says why when the giver has nothing planned (all shortfall)", () => {
    const m = move({ perPeriod: [], movedHours: 0, shortfallHours: 8 });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Maya Patel has no planned hours in that period.",
    );
  });
  it("says why when the receiver has no room (all receiver cap)", () => {
    const m = move({ perPeriod: [], movedHours: 0, receiverCapHours: 8 });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Liam Foster is at 100 %.",
    );
  });
  it("shows a moved entry and a zero-moved entry of the same pair", () => {
    const zero = move({ taskId: 11, perPeriod: [], movedHours: 0, shortfallHours: 3 });
    expect(hoursMoveNotice(plan([move(), zero]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h). No planned hours moved for API: Maya Patel has no planned hours in that period.",
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
  it("renders one task with Std. and German month labels", () => {
    expect(hoursMoveNotice(plan([move()]), ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep 8 Std., Okt 8 Std.).",
    );
  });
  it("renders a batch", () => {
    const moves = [
      move({ taskId: 10, movedHours: 8, perPeriod: [{ periodKey: "2026-09", hours: 8 }] }),
      move({ taskId: 11, movedHours: 8, perPeriod: [{ periodKey: "2026-10", hours: 8 }] }),
    ];
    expect(hoursMoveNotice(plan(moves), ctx("de"))).toBe(
      "16 Std. für 2 Aufgaben von Maya Patel auf Liam Foster verschoben (Sep 8 Std., Okt 8 Std.).",
    );
  });
  it("renders over capacity with a week label", () => {
    const p = plan([move({ perPeriod: [{ periodKey: "2026-W38", hours: 16 }] })], [
      { resourceId: 2, periodKey: "2026-W38", percent: 130 },
    ]);
    expect(hoursMoveNotice(p, ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (KW 38 16 Std.). Liam Foster ist jetzt bei 130 % in KW 38.",
    );
  });
  it("renders a shortfall", () => {
    expect(hoursMoveNotice(plan([move({ shortfallHours: 4 })]), ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep 8 Std., Okt 8 Std.) (4 Std. nicht im Plan von Maya Patel).",
    );
  });
  it("renders a reason and a zero-moved shortfall", () => {
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, reason: "noEstimate" })]), ctx("de"))).toBe(
      "Data migration hat keine Restschätzung, daher wurden keine geplanten Stunden verschoben.",
    );
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, shortfallHours: 8 })]), ctx("de"))).toBe(
      "Für Data migration wurden keine geplanten Stunden verschoben: Maya Patel hat in diesem Zeitraum keine geplanten Stunden.",
    );
  });
});
