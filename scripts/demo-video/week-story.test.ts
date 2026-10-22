// §715 A — the recorder and E's tests read the demo week's names from one module, and the facts the
// recorder's replay must reach each day agree with E's `applyDemoWeek`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as story from "./week-story.mjs";
import * as week from "../../src/test/demo-week";

const NAMES = [
  "DEMO_WEEK_DATES", "DEMO_DUPLICATE_PAIRS", "DEMO_CRM_TASK", "DEMO_GDPR_ISSUE",
  "DEMO_NEW_MEMBER", "DEMO_DPO", "DEMO_LICENCE_RISK", "DEMO_MAYA_RELIEVED_HOURS",
] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

type Fact = { collection: string; key: string; value: string; field: string; expected: string | number | null; recorderOnly?: boolean };
const master = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const facts = (story as unknown as { DAY_FACTS: Record<(typeof DAYS)[number], Fact[]> }).DAY_FACTS;

describe("the demo week's story (§715)", () => {
  it("E's fixture and the recorder share one set of names", () => {
    for (const name of NAMES) {
      expect((week as Record<string, unknown>)[name], name).toBe((story as Record<string, unknown>)[name]);
    }
  });

  it("every replay fact holds in applyDemoWeek on its day", () => {
    const wrong: string[] = [];
    for (const day of DAYS) {
      const ws = week.applyDemoWeek(master, day) as Record<string, Record<string, unknown>[]>;
      for (const f of facts[day]) {
        if (f.recorderOnly) continue;
        const row = ws[f.collection]?.find((r) => r[f.key] === f.value);
        const got = row ? (row[f.field] ?? null) : "<no row>";
        if (got !== f.expected) wrong.push(`${day} ${f.collection} ${f.value}.${f.field}: ${String(got)} ≠ ${String(f.expected)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("Friday checks the split task's assignee, a fact only the recording makes", () => {
    const f = facts.fri.find((x) => x.field === "assignee");
    expect(f).toMatchObject({ value: "Pilot feedback fixes – registration flow", expected: "Sofia Ramirez", recorderOnly: true });
  });

  it("each day carries at least one fact", () => {
    for (const day of DAYS) expect(facts[day].length, day).toBeGreaterThan(0);
  });
});
