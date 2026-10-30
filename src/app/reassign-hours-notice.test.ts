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
    shortfallPeriods: [],
    receiverCapPeriods: [],
    ...over,
  };
}

const plan = (moves: TaskHoursMove[], overCapacity: HoursMovePlan["overCapacity"] = []): HoursMovePlan => ({
  moves,
  nextResources: [],
  edits: [],
  overCapacity,
});

const skippedBatch = (): TaskHoursMove[] => [
  ...Array.from({ length: 5 }, (_, i) => move({ taskId: 100 + i, perPeriod: [], movedHours: 0, reason: "noEstimate" })),
  ...Array.from({ length: 3 }, (_, i) => move({ taskId: 200 + i, perPeriod: [], movedHours: 0, reason: "closed" })),
  move({ taskId: 300, perPeriod: [], movedHours: 0, shortfallHours: 4 }),
  move({ taskId: 301, perPeriod: [], movedHours: 0, receiverCapHours: 2 }),
];

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
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h).",
    );
  });
  it("shortfall, receiver cap and outside-window parts", () => {
    const m = move({
      shortfallHours: 4, shortfallPeriods: ["2026-09"],
      receiverCapHours: 6, receiverCapPeriods: ["2026-10"], receiverCapLimit: "percent",
      outsideWindowHours: 2,
    });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). Not in Maya Patel's plan in Sep: 4 h. Kept with Maya Patel, as Liam Foster is at 100 % in Oct: 6 h. Outside the plan: 2 h.",
    );
  });
  it("names the hours limit for an hours-mode receiver", () => {
    const m = move({ receiverCapHours: 6, receiverCapPeriods: ["2026-10"], receiverCapLimit: "hours" });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). Kept with Maya Patel, as Liam Foster is at the 1,000 h limit in Oct: 6 h.",
    );
  });
  it("shows the period list to a tenth so it adds up to the total", () => {
    const m = move({
      movedHours: 10,
      perPeriod: [{ periodKey: "2026-09", hours: 3.3 }, { periodKey: "2026-10", hours: 3.3 }, { periodKey: "2026-11", hours: 3.4 }],
    });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "Moved 10 h from Maya Patel to Liam Foster (Sep: 3.3 h, Oct: 3.3 h, Nov: 3.4 h).",
    );
  });
  it("over capacity comes last", () => {
    const text = hoursMoveNotice(plan([move()], [{ resourceId: 2, periodKey: "2026-09", percent: 130 }]), ctx("en-US"));
    expect(text).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). Liam Foster is now at 130 % in Sep.",
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
      "Moved 24 h for 3 tasks from Maya Patel to Liam Foster (Sep: 12 h, Oct: 12 h).",
    );
  });
  it("one sentence per giver/receiver pair, then reasons", () => {
    const moves = [
      move(),
      move({ taskId: 11, fromResourceId: 3, toResourceId: 2, movedHours: 0.5, perPeriod: [{ periodKey: "2026-09", hours: 0.5 }] }),
      move({ taskId: 12, perPeriod: [], movedHours: 0, reason: "closed" }),
    ];
    expect(hoursMoveNotice(plan(moves), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). Moved 0.5 h from Ana to Liam Foster (Sep: 0.5 h). UI is closed, so no planned hours moved.",
    );
  });
  it("says why when the giver has nothing planned (all shortfall)", () => {
    const m = move({ perPeriod: [], movedHours: 0, shortfallHours: 8, shortfallPeriods: ["2026-09", "2026-10"] });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Maya Patel has no planned hours in Sep, Oct.",
    );
  });
  it("says why when the receiver has no room (all receiver cap)", () => {
    const m = move({ perPeriod: [], movedHours: 0, receiverCapHours: 8, receiverCapPeriods: ["2026-09"], receiverCapLimit: "percent" });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Liam Foster is at 100 % in Sep.",
    );
    const h = move({ perPeriod: [], movedHours: 0, receiverCapHours: 8, receiverCapPeriods: ["2026-09"], receiverCapLimit: "hours" });
    expect(hoursMoveNotice(plan([h]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Liam Foster is at the 1,000 h limit in Sep.",
    );
  });
  it("shows a moved entry and a zero-moved entry of the same pair", () => {
    const zero = move({ taskId: 11, perPeriod: [], movedHours: 0, shortfallHours: 3, shortfallPeriods: ["2026-10"] });
    expect(hoursMoveNotice(plan([move(), zero]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). No planned hours moved for API: Maya Patel has no planned hours in Oct.",
    );
  });
  it("summarises several skipped tasks by reason, once (final review)", () => {
    expect(hoursMoveNotice(plan([move(), ...skippedBatch()]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). No planned hours moved for 10 tasks: no remaining estimate (5), closed (3), nothing planned (1), receiver full (1).",
    );
  });
  it("keeps the per-task sentence when only one task is skipped", () => {
    expect(hoursMoveNotice(plan([move(), move({ taskId: 12, perPeriod: [], movedHours: 0, reason: "closed" })]), ctx("en-US"))).toBe(
      "Moved 16 h from Maya Patel to Liam Foster (Sep: 8 h, Oct: 8 h). UI is closed, so no planned hours moved.",
    );
  });
  it("gives a zero-moved task with both a shortfall and a full receiver both sentences", () => {
    const m = move({
      perPeriod: [], movedHours: 0,
      shortfallHours: 4, shortfallPeriods: ["2026-09"],
      receiverCapHours: 4, receiverCapPeriods: ["2026-10"], receiverCapLimit: "percent",
    });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBe(
      "No planned hours moved for Data migration: Maya Patel has no planned hours in Sep. No planned hours moved for Data migration: Liam Foster is at 100 % in Oct.",
    );
  });
  it("returns null for a zero-moved entry whose giver is unknown", () => {
    const m = move({ fromResourceId: undefined, perPeriod: [], movedHours: 0, shortfallHours: 4, shortfallPeriods: ["2026-09"] });
    expect(hoursMoveNotice(plan([m]), ctx("en-US"))).toBeNull();
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
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep: 8 Std., Okt: 8 Std.).",
    );
  });
  it("renders a batch", () => {
    const moves = [
      move({ taskId: 10, movedHours: 8, perPeriod: [{ periodKey: "2026-09", hours: 8 }] }),
      move({ taskId: 11, movedHours: 8, perPeriod: [{ periodKey: "2026-10", hours: 8 }] }),
    ];
    expect(hoursMoveNotice(plan(moves), ctx("de"))).toBe(
      "16 Std. für 2 Aufgaben von Maya Patel auf Liam Foster verschoben (Sep: 8 Std., Okt: 8 Std.).",
    );
  });
  it("renders over capacity with a week label", () => {
    const p = plan([move({ perPeriod: [{ periodKey: "2026-W38", hours: 16 }] })], [
      { resourceId: 2, periodKey: "2026-W38", percent: 130 },
    ]);
    expect(hoursMoveNotice(p, ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (KW 38: 16 Std.). Liam Foster ist jetzt bei 130 % in KW 38.",
    );
  });
  it("renders a shortfall", () => {
    expect(hoursMoveNotice(plan([move({ shortfallHours: 4, shortfallPeriods: ["2026-09"] })]), ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep: 8 Std., Okt: 8 Std.). Nicht im Plan von Maya Patel in Sep: 4 Std.",
    );
  });
  it("renders a receiver cap and the hours limit", () => {
    const pct = move({ receiverCapHours: 6, receiverCapPeriods: ["2026-10"], receiverCapLimit: "percent" });
    expect(hoursMoveNotice(plan([pct]), ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep: 8 Std., Okt: 8 Std.). Bei Maya Patel geblieben, da Liam Foster in Okt bei 100 % ist: 6 Std.",
    );
    const hrs = move({ receiverCapHours: 6, receiverCapPeriods: ["2026-10"], receiverCapLimit: "hours" });
    expect(hoursMoveNotice(plan([hrs]), ctx("de"))).toBe(
      "16 Std. von Maya Patel auf Liam Foster verschoben (Sep: 8 Std., Okt: 8 Std.). Bei Maya Patel geblieben, da Liam Foster in Okt an der Grenze von 1.000 Std. ist: 6 Std.",
    );
  });
  it("renders a reason and a zero-moved shortfall", () => {
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, reason: "noEstimate" })]), ctx("de"))).toBe(
      "Data migration hat keine Restschätzung, daher wurden keine geplanten Stunden verschoben.",
    );
    expect(hoursMoveNotice(plan([move({ perPeriod: [], movedHours: 0, shortfallHours: 8, shortfallPeriods: ["2026-09"] })]), ctx("de"))).toBe(
      "Für Data migration wurden keine geplanten Stunden verschoben: Maya Patel hat in Sep keine geplanten Stunden.",
    );
  });
  it("renders a zero-moved full receiver, at 100 % and at the hours limit", () => {
    const pct = move({ perPeriod: [], movedHours: 0, receiverCapHours: 8, receiverCapPeriods: ["2026-09"], receiverCapLimit: "percent" });
    expect(hoursMoveNotice(plan([pct]), ctx("de"))).toBe(
      "Für Data migration wurden keine geplanten Stunden verschoben: Liam Foster ist in Sep bei 100 %.",
    );
    const hrs = move({ perPeriod: [], movedHours: 0, receiverCapHours: 8, receiverCapPeriods: ["2026-09"], receiverCapLimit: "hours" });
    expect(hoursMoveNotice(plan([hrs]), ctx("de"))).toBe(
      "Für Data migration wurden keine geplanten Stunden verschoben: Liam Foster ist in Sep an der Grenze von 1.000 Std.",
    );
  });
  it("summarises several skipped tasks by reason", () => {
    expect(hoursMoveNotice(plan(skippedBatch()), ctx("de"))).toBe(
      "Für 10 Aufgaben wurden keine geplanten Stunden verschoben: keine Restschätzung (5), abgeschlossen (3), nichts geplant (1), Empfänger voll (1).",
    );
  });
});
