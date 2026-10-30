import { beforeAll, describe, expect, it } from "vitest";
import { formatAbsenceClash } from "./absence-clash-notice";
import type { AbsenceClash } from "./absence-clash";
import { loadI18n } from "./i18n";

const onDate: AbsenceClash = {
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

  it("says the person is absent on the date (EN)", () => {
    expect(formatAbsenceClash(onDate, "en-US")).toBe("Maya Patel is absent on the date (Nov 03–Nov 07).");
  });

  it("says the person is away for most of this task's working days, listing every range (EN)", () => {
    expect(formatAbsenceClash(span, "en-US")).toBe(
      "Maya Patel is away for most of this task's working days (Nov 03–Nov 07, Nov 20).",
    );
  });

  it("is written in German (DE)", () => {
    expect(formatAbsenceClash(onDate, "de")).toBe("Maya Patel ist am Termin abwesend (03. Nov.–07. Nov.).");
    expect(formatAbsenceClash(span, "de")).toBe(
      "Maya Patel ist an den meisten Arbeitstagen dieser Aufgabe abwesend (03. Nov.–07. Nov., 20. Nov.).",
    );
  });
});
