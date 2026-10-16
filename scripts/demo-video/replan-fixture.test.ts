// §715 E — the team's re-plan spreadsheet Tuesday imports into "Identity Platform – T&M".
// Its headers must defeat Detect columns, or the take's "Ask Claude" step maps nothing worth showing.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDelimited } from "../../src/app/budget-import/sheet-grid";
import { detectLayout } from "../../src/app/budget-import/layout-detect";

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

  it("names only the bucket's people from the master", () => {
    const bucket = master.budgets.find((b: { name: string }) => b.name === "Identity Platform – T&M");
    const ids = new Set<number>(bucket.allocations.flatMap((a: { resourceIds: number[] }) => a.resourceIds));
    const names = new Set<string>(
      master.resources.filter((r: { id: number }) => ids.has(r.id)).map((r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`),
    );
    const people = rows.slice(2).map((r) => r[0]).filter((c) => c !== "");
    expect(people.length).toBeGreaterThan(0);
    expect(people.filter((p) => !names.has(p))).toEqual([]);
  });
});
