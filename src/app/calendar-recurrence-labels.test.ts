// src/app/calendar-recurrence-labels.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { loadI18n } from "./i18n";
import type { RecurrenceRule } from "./calendar-event";
import { recurrenceFrequencyText, recurrenceSummaryText } from "./calendar-recurrence-labels";

beforeAll(async () => {
  await loadI18n("de");
});

describe("recurrenceFrequencyText", () => {
  it("says Never when there is no rule", () => {
    expect(recurrenceFrequencyText(undefined, "en-US")).toBe("Never");
    expect(recurrenceFrequencyText(undefined, "de")).toBe("Nie");
  });

  it("names the frequency alone for an interval of 1", () => {
    expect(recurrenceFrequencyText({ freq: "daily", interval: 1 }, "en-US")).toBe("Daily");
    expect(recurrenceFrequencyText({ freq: "weekly", interval: 1 }, "de")).toBe("Wöchentlich");
    expect(recurrenceFrequencyText({ freq: "monthly", interval: 1 }, "en-US")).toBe("Monthly");
  });

  // §621 — a real plural, never the editor's "week(s)" unit label.
  it("uses a plural phrase for an interval above 1", () => {
    expect(recurrenceFrequencyText({ freq: "daily", interval: 3 }, "en-US")).toBe("Every 3 days");
    expect(recurrenceFrequencyText({ freq: "weekly", interval: 2 }, "en-US")).toBe("Every 2 weeks");
    expect(recurrenceFrequencyText({ freq: "monthly", interval: 6 }, "en-US")).toBe("Every 6 months");
    expect(recurrenceFrequencyText({ freq: "daily", interval: 3 }, "de")).toBe("Alle 3 Tage");
    expect(recurrenceFrequencyText({ freq: "weekly", interval: 2 }, "de")).toBe("Alle 2 Wochen");
    expect(recurrenceFrequencyText({ freq: "monthly", interval: 6 }, "de")).toBe("Alle 6 Monate");
  });
});

describe("recurrenceSummaryText", () => {
  it("adds the weekdays of a weekly rule", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: ["TU", "FR"] };
    expect(recurrenceSummaryText(rule, "en-US")).toBe("Weekly · Tue, Fri");
  });

  it("prints the frequency alone for a weekly rule with no weekdays", () => {
    expect(recurrenceSummaryText({ freq: "weekly", interval: 2, byDay: [] }, "en-US")).toBe("Every 2 weeks");
    expect(recurrenceSummaryText({ freq: "weekly", interval: 2 }, "en-US")).toBe("Every 2 weeks");
  });

  // The sanitizer always sets one of byDay/byMonthDay on a stored monthly
  // rule; a hand-built one with neither must not print a placeholder.
  it("prints the frequency alone for a monthly rule with neither day setting", () => {
    expect(recurrenceSummaryText({ freq: "monthly", interval: 1 }, "en-US")).toBe("Monthly");
  });

  it("prefers the nth weekday over the day of the month", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, byMonthDay: 9, byDay: { ordinal: 1, day: "MO" } };
    expect(recurrenceSummaryText(rule, "en-US")).toBe("Monthly · 1st Mon");
  });

  it("adds nothing for a daily rule", () => {
    expect(recurrenceSummaryText({ freq: "daily", interval: 2 }, "de")).toBe("Alle 2 Tage");
  });
});
