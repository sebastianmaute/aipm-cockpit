import { beforeAll, describe, expect, it } from "vitest";
import { formatAbsenceClash } from "./absence-clash-notice";
import type { AbsenceClash } from "./absence-clash";
import { loadI18n } from "./i18n";

const onDate: AbsenceClash = {
  which: "due",
  person: "Maya Patel",
  resourceId: 1,
  reason: "date-on-absence",
  date: "2026-11-05",
  ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
};
const span: AbsenceClash = {
  person: "Maya Patel",
  reason: "absent-most-of-span",
  ranges: [
    { start: "2026-11-03", end: "2026-11-07" },
    { start: "2026-11-20", end: "2026-11-20" },
  ],
};

describe("formatAbsenceClash", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("names the due date (EN)", () => {
    expect(formatAbsenceClash(onDate, "en-US")).toBe("Maya Patel is absent on the due date, Nov 05 (Nov 03–Nov 07).");
  });

  it("names the start date and the milestone date (EN)", () => {
    expect(formatAbsenceClash({ ...onDate, which: "start" }, "en-US")).toBe("Maya Patel is absent on the start date, Nov 05 (Nov 03–Nov 07).");
    expect(formatAbsenceClash({ ...onDate, which: "milestone" }, "en-US")).toBe("Maya Patel is absent on the milestone date, Nov 05 (Nov 03–Nov 07).");
  });

  it("says the person is away for most of this task's working days, listing every range (EN)", () => {
    expect(formatAbsenceClash(span, "en-US")).toBe(
      "Maya Patel is away for most of this task's working days (Nov 03–Nov 07, Nov 20).",
    );
  });

  it("is written in German (DE)", () => {
    expect(formatAbsenceClash(onDate, "de")).toBe("Maya Patel ist am Fälligkeitsdatum, 05. Nov., abwesend (03. Nov.–07. Nov.).");
    expect(formatAbsenceClash({ ...onDate, which: "start" }, "de")).toBe("Maya Patel ist am Startdatum, 05. Nov., abwesend (03. Nov.–07. Nov.).");
    expect(formatAbsenceClash({ ...onDate, which: "milestone" }, "de")).toBe("Maya Patel ist am Meilensteintermin, 05. Nov., abwesend (03. Nov.–07. Nov.).");
    expect(formatAbsenceClash(span, "de")).toBe(
      "Maya Patel ist an den meisten Arbeitstagen dieser Aufgabe abwesend (03. Nov.–07. Nov., 20. Nov.).",
    );
  });
});
