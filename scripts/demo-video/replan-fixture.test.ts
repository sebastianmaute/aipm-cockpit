// §715 E — the team's re-plan spreadsheet Tuesday imports into "Identity Platform – T&M".
// Its headers must defeat Detect columns, or the take's "Ask Claude" step maps nothing worth showing.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDelimited } from "../../src/app/budget-import/sheet-grid";
import { detectLayout } from "../../src/app/budget-import/layout-detect";
import { gridToForecastRows } from "../../src/app/budget-import/forecast-rows";

const here = import.meta.dirname;
const rows = parseDelimited(readFileSync(join(here, "fixtures", "replan-forecast.csv"), "utf8"));
const master = JSON.parse(readFileSync(join(here, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("the re-plan fixture (§715)", () => {
  // As `use-forecast-import.ts` detects: a CSV's numbers are text, and a header without a year is read in
  // the target bucket's start year (2026).
  it("defeats Detect columns", () => {
    expect(rows.length).toBeGreaterThan(2);
    expect(detectLayout(rows, { numbers: "text", defaultYear: 2026 }).kind).toBe("unknown");
  });

  // The other half: Claude's mapping only says WHERE the fields are; periods are still read from the header
  // text. So the mapping the take expects Claude to propose must import every planned hour, or the step
  // imports nothing whatever Claude answers.
  it("imports all its hours under the mapping Claude is expected to propose", () => {
    const headerRow = rows.findIndex((r) => r[0] === "Who");
    expect(headerRow, "the header sits below Detect columns' scan window").toBeGreaterThanOrEqual(10);
    const out = gridToForecastRows(rows, { layout: "wide", headerRow, person: 0, periodCols: [2, 3], year: 2026 }, "Sheet1");
    expect(out.rows.map((r) => [r.person, r.period, r.hours])).toEqual([
      ["Sofia Ramirez", "2026-09", 60], ["Sofia Ramirez", "2026-10", 150],
      ["Ava Thompson", "2026-09", 40], ["Ava Thompson", "2026-10", 96],
      ["Maya Patel", "2026-09", 48], ["Maya Patel", "2026-10", 120],
    ]);
  });

  it("names only the bucket's people from the master", () => {
    const bucket = master.budgets.find((b: { name: string }) => b.name === "Identity Platform – T&M");
    const ids = new Set<number>(bucket.allocations.flatMap((a: { resourceIds: number[] }) => a.resourceIds));
    const names = new Set<string>(
      master.resources.filter((r: { id: number }) => ids.has(r.id)).map((r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`),
    );
    const people = rows.slice(rows.findIndex((r) => r[0] === "Who") + 1).map((r) => r[0]).filter((c) => c !== "");
    expect(people.length).toBeGreaterThan(0);
    expect(people.filter((p) => !names.has(p))).toEqual([]);
  });
});
