// §715 E — the demo's Next-actions rows on each day of the video's week.
//
// Spec: docs/superpowers/specs/2026-10-16-demo-week-story-design.md, "Signals at T0" and "Friday".
// Every row the viewer sees must be one the story intends, and every intended row must fire.
// Rows are compared as the GROUPED rows the Next-actions page shows (`groupNextActions`), as a set
// per tier, because rows of equal score have no meaningful order; only the hero (row 1) is positional.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionGroup } from "./next-actions/group";
import { demoActionGroups, rowSignature } from "../test/demo-next-actions";
import { applyDemoWeek, DEMO_DPO, DEMO_LICENCE_RISK, DEMO_WEEK_DATES, type DemoDay } from "../test/demo-week";

const master = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

interface Rows { hero: string; now: string[]; soon: string[]; monitor: string[] }

function rowsOf(groups: readonly ActionGroup[]): Rows {
  const sigs = groups.map(rowSignature);
  return {
    hero: sigs[0] ?? "",
    now: sigs.filter((s) => s.startsWith("now ")),
    soon: sigs.filter((s) => s.startsWith("soon ")),
    monitor: sigs.filter((s) => s.startsWith("monitor ")),
  };
}

function expectRows(actual: Rows, expected: Rows) {
  expect(actual.hero, "the hero").toBe(expected.hero);
  for (const tier of ["now", "soon", "monitor"] as const) {
    expect(new Set(actual[tier]), `the ${tier} tier`).toEqual(new Set(expected[tier]));
  }
}

function idByName(rows: { id: number; [k: string]: unknown }[], key: string, name: string): number {
  const row = rows.find((r) => r[key] === name);
  if (!row) throw new Error(`no row with ${key} "${name}"`);
  return row.id;
}

// CRM task 36, the GDPR issue RAID 15 and Thursday's steering meeting 2 are created by the master.
const MONDAY: Rows = {
  hero: "now milestone milestones:5",
  now: ["now milestone milestones:5", "now committee steering-committee:2"],
  soon: [
    "soon task-due open-points:36",
    "soon task-due open-points:25 +task-attention:25:dep-blocked",
    "soon workload workload:4",
    "soon raid raid:15",
    "soon change-pending changes:1",
    "soon milestone milestones:2",
    "soon stakeholder-comms stakeholders:1",
    "soon stakeholder-comms stakeholders:5",
    "soon task-attention open-points:5",
    "soon task-attention open-points:7",
    "soon task-attention open-points:8",
    "soon task-attention open-points:10",
  ],
  monitor: [
    "monitor schedule gantt:0",
    "monitor raid raid:2",
    "monitor raid raid:4",
    "monitor raid raid:11",
  ],
};

function fridayRows(friday: { stakeholders: { id: number }[]; raid: { id: number }[] }): Rows {
  const dpo = `soon stakeholder-comms stakeholders:${idByName(friday.stakeholders, "name", DEMO_DPO)}`;
  return {
    hero: dpo,
    now: [],
    soon: [
      dpo,
      "soon milestone milestones:2",
      "soon task-attention open-points:5",
      "soon task-attention open-points:7",
      "soon task-attention open-points:8",
      "soon task-attention open-points:10",
      "soon task-due open-points:25",
      "soon task-due open-points:4",
    ],
    monitor: [
      "monitor raid raid:2",
      "monitor raid raid:4",
      "monitor raid raid:11",
      `monitor raid raid:${idByName(friday.raid, "title", DEMO_LICENCE_RISK)}`,
    ],
  };
}

describe("the demo week's next actions (§715)", () => {
  it("Monday 2026-09-21: every row is intended and every intended row fires", () => {
    expectRows(rowsOf(demoActionGroups(master, DEMO_WEEK_DATES.mon)), MONDAY);
  });

  it("Friday 2026-09-25 after the week: the DPO update leads", () => {
    const friday = applyDemoWeek(master, "fri") as Parameters<typeof fridayRows>[0];
    expectRows(rowsOf(demoActionGroups(friday, DEMO_WEEK_DATES.fri)), fridayRows(friday));
  });

  // The morning of each day, before its own steps. A row is identified by source and entity: its tier
  // and extra reasons may move during the week (a reminder comes due, a reason clears), its subject may
  // not. A row that belongs to the story but to neither Monday nor Friday goes in DAY_EXTRAS with why.
  const DAY_EXTRAS: Record<"tue" | "wed" | "thu", string[]> = { tue: [], wed: [], thu: [] };
  const PREVIOUS: Record<"tue" | "wed" | "thu", DemoDay> = { tue: "mon", wed: "tue", thu: "wed" };
  const subject = (sig: string) => sig.split(" ").slice(1, 3).join(" ");

  for (const day of ["tue", "wed", "thu"] as const) {
    it(`${day} ${DEMO_WEEK_DATES[day]}: stays on the story`, () => {
      const morning = applyDemoWeek(master, PREVIOUS[day]);
      const groups = demoActionGroups(morning, DEMO_WEEK_DATES[day]);
      const friday = applyDemoWeek(master, "fri") as Parameters<typeof fridayRows>[0];
      const f = fridayRows(friday);
      const allowed = new Set(
        [...MONDAY.now, ...MONDAY.soon, ...MONDAY.monitor, ...f.soon, ...f.monitor].map(subject).concat(DAY_EXTRAS[day]),
      );
      const stray = groups.map(rowSignature).filter((s) => !allowed.has(subject(s)));
      expect(stray, "rows outside the story").toEqual([]);
      const ids = groups.flatMap((g) => [g.primary, ...g.extra]).map((a) => a.id);
      expect(ids.filter((id) => /^raid:\d+:overdue$/.test(id)), "overdue RAID reviews").toEqual([]);
      expect(ids.filter((id) => /^task-attention:\d+:(stale|unassigned)$/.test(id)), "stale or unassigned tasks").toEqual([]);
    });
  }
});
