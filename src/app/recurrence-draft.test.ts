import { describe, expect, it } from "vitest";
import {
  EMPTY_RECURRENCE_DRAFT,
  buildRecurrenceRule,
  recurrenceDraftFrom,
  type RecurrenceDraft,
} from "./recurrence-draft";
import type { RecurrenceRule } from "./calendar-event";

describe("recurrenceDraftFrom -> buildRecurrenceRule round-trips", () => {
  it("undefined (no recurrence) round-trips to undefined", () => {
    const draft = recurrenceDraftFrom(undefined);
    expect(draft).toEqual(EMPTY_RECURRENCE_DRAFT);
    expect(buildRecurrenceRule(draft)).toBeUndefined();
  });

  it("daily, no range", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 3 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("daily, until", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-03-01" };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("daily, count", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 2, count: 10 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("weekly, no byDay (recurs on the start weekday), no range", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("weekly, byDay set, until", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 2, byDay: ["MO", "WE", "FR"], until: "2026-06-01" };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("weekly, byDay set, count", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, byDay: ["TU"], count: 8 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("monthly, byMonthDay, no range", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, byMonthDay: 31 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("monthly, byMonthDay, until", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 3, byMonthDay: 1, until: "2027-01-01" };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("monthly, byMonthDay, count", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, byMonthDay: 15, count: 6 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  // Every ordinal value, exhaustively — not just the one the form happens to exercise.
  const ordinals = [1, 2, 3, 4, -1] as const;
  for (const ordinal of ordinals) {
    it(`monthly, nth-weekday ordinal=${ordinal}, no range`, () => {
      const rule: RecurrenceRule = { freq: "monthly", interval: 1, byDay: { ordinal, day: "TU" } };
      expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
    });
  }

  it("monthly, nth-weekday, until", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, byDay: { ordinal: 2, day: "FR" }, until: "2026-12-31" };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });

  it("monthly, nth-weekday, count", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2, byDay: { ordinal: -1, day: "SU" }, count: 4 };
    expect(buildRecurrenceRule(recurrenceDraftFrom(rule))).toEqual(rule);
  });
});

describe("freq × monthlyMode × ends combination matrix", () => {
  const freqs = ["daily", "weekly", "monthly"] as const;
  const endsModes = ["never", "date", "count"] as const;

  function draftFor(
    freq: (typeof freqs)[number],
    ends: (typeof endsModes)[number],
    monthlyMode: "dom" | "nth",
  ): RecurrenceDraft {
    return {
      ...EMPTY_RECURRENCE_DRAFT,
      freq,
      interval: 1,
      monthlyMode,
      monthlyDom: 15,
      monthlyOrdinal: 2,
      monthlyWeekday: "WE",
      ends,
      until: "2026-05-01",
      count: 7,
    };
  }

  for (const freq of freqs) {
    for (const ends of endsModes) {
      const monthlyModes: ("dom" | "nth")[] = freq === "monthly" ? ["dom", "nth"] : ["dom"];
      for (const monthlyMode of monthlyModes) {
        it(`freq=${freq} monthlyMode=${monthlyMode} ends=${ends} produces the expected rule`, () => {
          const rule = buildRecurrenceRule(draftFor(freq, ends, monthlyMode));
          expect(rule).toBeDefined();
          expect(rule!.freq).toBe(freq);
          if (freq === "monthly") {
            if (monthlyMode === "dom") {
              expect(rule).toMatchObject({ byMonthDay: 15 });
              expect(rule).not.toHaveProperty("byDay");
            } else {
              expect(rule).toMatchObject({ byDay: { ordinal: 2, day: "WE" } });
              expect(rule).not.toHaveProperty("byMonthDay");
            }
          }
          if (ends === "date") expect(rule).toMatchObject({ until: "2026-05-01" });
          if (ends === "count") expect(rule).toMatchObject({ count: 7 });
          if (ends === "never") {
            expect(rule).not.toHaveProperty("until");
            expect(rule).not.toHaveProperty("count");
          }
        });
      }
    }
  }

  it("freq=none produces undefined regardless of monthlyMode/ends", () => {
    for (const ends of endsModes) {
      for (const monthlyMode of ["dom", "nth"] as const) {
        const draft = draftFor("daily", ends, monthlyMode);
        expect(buildRecurrenceRule({ ...draft, freq: "none" })).toBeUndefined();
      }
    }
  });
});

describe("weekly -> monthly -> weekly preservation (the reason RecurrenceDraft is a flat superset bag)", () => {
  it("weeklyByDay survives a detour through monthly mode", () => {
    const original = recurrenceDraftFrom({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] });
    // Mirrors the modal's own freq-switch handler exactly: spread-and-overwrite
    // `freq` alone, nothing else cleared — see calendar-event-modal.tsx's
    // `onChange={(freq) => setRecurrence((prev) => ({ ...prev, freq }))}`.
    const switchedToMonthly = { ...original, freq: "monthly" as const };
    const switchedBackToWeekly = { ...switchedToMonthly, freq: "weekly" as const };
    expect(switchedBackToWeekly.weeklyByDay).toEqual(["MO", "WE"]);
    expect(buildRecurrenceRule(switchedBackToWeekly)).toEqual({
      freq: "weekly", interval: 1, byDay: ["MO", "WE"],
    });
  });

  it("monthly nth-weekday selection survives a detour through weekly mode", () => {
    const original = recurrenceDraftFrom({ freq: "monthly", interval: 1, byDay: { ordinal: 3, day: "TH" } });
    const switchedToWeekly = { ...original, freq: "weekly" as const };
    const switchedBackToMonthly = { ...switchedToWeekly, freq: "monthly" as const };
    expect(switchedBackToMonthly.monthlyOrdinal).toBe(3);
    expect(switchedBackToMonthly.monthlyWeekday).toBe("TH");
    expect(switchedBackToMonthly.monthlyMode).toBe("nth");
    expect(buildRecurrenceRule(switchedBackToMonthly)).toEqual({
      freq: "monthly", interval: 1, byDay: { ordinal: 3, day: "TH" },
    });
  });
});

describe("byDay sparse-emit (matches sanitizeRecurrence's convention)", () => {
  it("omits byDay from the built weekly rule when weeklyByDay is empty", () => {
    const draft: RecurrenceDraft = { ...EMPTY_RECURRENCE_DRAFT, freq: "weekly", interval: 1, weeklyByDay: [] };
    const rule = buildRecurrenceRule(draft);
    expect(rule).toEqual({ freq: "weekly", interval: 1 });
    expect(rule).not.toHaveProperty("byDay");
  });

  it("recurrenceDraftFrom mirrors the same sparse convention on the way in", () => {
    const draft = recurrenceDraftFrom({ freq: "weekly", interval: 1 }); // no byDay at all
    expect(draft.weeklyByDay).toEqual([]);
  });
});

describe("until/count mutual exclusivity — buildRecurrenceRule only ever emits ONE", () => {
  it("ends=date emits until only", () => {
    const draft: RecurrenceDraft = {
      ...EMPTY_RECURRENCE_DRAFT, freq: "daily", ends: "date", until: "2026-02-01", count: 5,
    };
    const rule = buildRecurrenceRule(draft);
    expect(rule).toMatchObject({ until: "2026-02-01" });
    expect(rule).not.toHaveProperty("count");
  });

  it("ends=count emits count only", () => {
    const draft: RecurrenceDraft = {
      ...EMPTY_RECURRENCE_DRAFT, freq: "daily", ends: "count", until: "2026-02-01", count: 5,
    };
    const rule = buildRecurrenceRule(draft);
    expect(rule).toMatchObject({ count: 5 });
    expect(rule).not.toHaveProperty("until");
  });

  it("ends=never emits neither, even when both until and count are populated in the draft", () => {
    const draft: RecurrenceDraft = {
      ...EMPTY_RECURRENCE_DRAFT, freq: "daily", ends: "never", until: "2026-02-01", count: 5,
    };
    const rule = buildRecurrenceRule(draft);
    expect(rule).not.toHaveProperty("until");
    expect(rule).not.toHaveProperty("count");
  });

  // Because this path can never emit both, sanitizeRecurrence's own until-wins
  // tie-break (for a raw object that DOES carry both) never fires from here.
  it("never produces an object with both until and count set, across the full ends matrix", () => {
    for (const ends of ["never", "date", "count"] as const) {
      const draft: RecurrenceDraft = {
        ...EMPTY_RECURRENCE_DRAFT, freq: "weekly", ends, until: "2026-02-01", count: 5,
      };
      const rule = buildRecurrenceRule(draft)!;
      const hasBoth = "until" in rule && "count" in rule;
      expect(hasBoth).toBe(false);
    }
  });
});
