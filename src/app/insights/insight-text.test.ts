import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n } from "../i18n";
import { insightDetail, insightTitle } from "./insight-text";
import type { Insight, InsightType } from "./insight";

// ★★★ THE THREE NUMBERS MUST ALL DIFFER, and that is the whole reason this file
// exists. `insightDetail` passes count, worstHours and threshold positionally as
// {1}, {2} and {3}, and two of the four guardrail sentences render {3} BEFORE
// {2} ("over the 8 h cap — the largest is 12 h"). A transposed index there
// yields a perfectly fluent sentence carrying the WRONG numbers, which no other
// gate can see. So a fixture where any two of these are equal is VACUOUS against
// exactly the defect this file is here to catch — keep them distinct.
const COUNT = 2;
const WORST_HOURS = 12;
const THRESHOLD = 8;

function ins(type: InsightType): Insight {
  return {
    id: 1,
    key: `timelog:${type}:7`,
    type,
    severity: "medium",
    data: { person: "Ada", count: COUNT, worstHours: WORST_HOURS, threshold: THRESHOLD },
    status: "active",
    firstSeenAt: "2026-09-01",
    lastSeenAt: "2026-09-04",
    occurrences: 2,
  };
}

interface Case {
  readonly type: InsightType;
  readonly title: string;
  readonly detail: string;
}

// ★ Whole rendered sentences, never substrings — a substring match on "12 h"
// cannot tell {2} from {3}, so it would pass against the transposition above.
const EN: readonly Case[] = [
  {
    type: "timelogCapPerEntry",
    title: "Time entry over the cap",
    detail: "Ada has 2 day(s) with a single entry over the 8 h cap — the largest is 12 h.",
  },
  {
    type: "timelogCapPerDay",
    title: "Day over the booking cap",
    detail:
      "Ada has 2 day(s) over the 8 h daily cap — the highest is 12 h. Only the fetched projects are counted, so this can under-report but never over-report.",
  },
  {
    type: "timelogNonWorkingDay",
    title: "Time booked on a non-working day",
    detail: "Ada booked time on 2 non-working day(s) — the largest is 12 h.",
  },
  {
    type: "timelogWorkingHours",
    title: "Time over defined working hours",
    detail:
      "Ada booked more than the defined hours on 2 day(s) — the highest is 12 h. People with no TimeLog link are not checked.",
  },
];

const DE: readonly Case[] = [
  {
    type: "timelogCapPerEntry",
    title: "Zeiteintrag über dem Limit",
    detail: "Ada hat 2 Tag(e) mit einem Einzeleintrag über dem Limit von 8 h — der größte beträgt 12 h.",
  },
  {
    type: "timelogCapPerDay",
    title: "Tag über dem Buchungslimit",
    detail:
      "Ada hat 2 Tag(e) über dem Tageslimit von 8 h — der höchste beträgt 12 h. Nur die abgerufenen Projekte werden gezählt, daher kann dies zu niedrig, nie zu hoch ausfallen.",
  },
  {
    type: "timelogNonWorkingDay",
    title: "Zeit an einem arbeitsfreien Tag gebucht",
    detail: "Ada hat an 2 arbeitsfreien Tag(en) Zeit gebucht — der größte Wert beträgt 12 h.",
  },
  {
    type: "timelogWorkingHours",
    title: "Zeit über den definierten Arbeitsstunden",
    detail:
      "Ada hat an 2 Tag(en) mehr als die definierten Stunden gebucht — der höchste Wert beträgt 12 h. Personen ohne TimeLog-Verknüpfung werden nicht geprüft.",
  },
];

describe("guardrail insight text", () => {
  beforeAll(async () => {
    // ★★★ THE DE DICTIONARY IS LAZY. Without this await, `t("de", key)` silently
    // falls back to en-US, so the DE cases below would assert English, pass, and
    // pin nothing. What makes the omission DETECTABLE rather than silent is that
    // the expectations below are real German: the EN fallback cannot produce
    // them, so dropping this line turns all four DE cases red.
    await loadI18n("de");
  });

  for (const c of EN) {
    it(`renders ${c.type} in en-US`, () => {
      expect(insightTitle(ins(c.type), "en-US")).toBe(c.title);
      expect(insightDetail(ins(c.type), "en-US")).toBe(c.detail);
    });
  }

  for (const c of DE) {
    it(`renders ${c.type} in de`, () => {
      expect(insightTitle(ins(c.type), "de")).toBe(c.title);
      expect(insightDetail(ins(c.type), "de")).toBe(c.detail);
    });
  }
});
