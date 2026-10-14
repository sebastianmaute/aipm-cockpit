import { beforeAll, describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MilestoneTable, formatChance } from "./forecast-tables";
import { loadI18n } from "./i18n";
import type { MilestoneChance } from "./forecast/milestones";
import type { Milestone } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

function ms(id: number, name: string, date = "2026-11-02"): Milestone {
  return { id, name, date, linkedTaskIds: [] };
}
const chance = (id: number, c: number, p = c): MilestoneChance => ({ id, state: "chance", chance: c, chancePrioritised: p });

describe("MilestoneTable", () => {
  test("milestone rows have unique accessible names", () => {
    render(
      <MilestoneTable
        lang="en-US"
        milestones={[ms(1, "Launch"), ms(2, "Launch"), ms(3, "Beta")]}
        chances={[chance(1, 0.5), chance(2, 0.6), chance(3, 0.7)]}
        whatIf={false}
      />,
    );
    expectRowUniqueNames({ minControls: 3, roles: ["rowheader"], requireCollisionSeed: true });
    expect(screen.getByRole("rowheader", { name: "Launch (1)" })).toBeTruthy();
  });

  test("overdue and no-linked-tasks show text, not a percent", () => {
    render(
      <MilestoneTable
        lang="en-US"
        milestones={[ms(1, "Late", "2026-09-01"), ms(2, "Orphan")]}
        chances={[
          { id: 1, state: "overdue" },
          { id: 2, state: "no-linked-tasks" },
        ]}
        whatIf={false}
      />,
    );
    const late = screen.getByRole("row", { name: /Late/ });
    expect(within(late).getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(late.textContent).not.toMatch(/%/);
    const orphan = screen.getByRole("row", { name: /Orphan/ });
    expect(within(orphan).getAllByText("No linked tasks").length).toBeGreaterThan(0);
    expect(orphan.textContent).not.toMatch(/%/);
  });

  test("a 0.996 chance renders as ≥ 99%", () => {
    render(<MilestoneTable lang="en-US" milestones={[ms(1, "Go-live")]} chances={[chance(1, 0.996, 1)]} whatIf={false} />);
    const row = screen.getByRole("row", { name: /Go-live/ });
    expect(within(row).getByText("≥ 99%")).toBeTruthy();
    expect(within(row).getByText("100%")).toBeTruthy();
  });

  test("a row whose date is not a valid day renders a blank date, never throws (R16)", () => {
    // The engine omits such a milestone; the table still must not format "" (RangeError: Invalid time value).
    render(
      <MilestoneTable
        lang="en-US"
        milestones={[ms(1, "Blank", ""), ms(2, "Feb30", "2026-02-30")]}
        chances={[{ id: 1, state: "overdue" }, chance(2, 0.5)]}
        whatIf={false}
      />,
    );
    for (const name of [/Blank/, /Feb30/]) {
      const [dateCell] = within(screen.getByRole("row", { name })).getAllByRole("cell");
      expect(dateCell.textContent).toBe("");
    }
  });

  test("shows the scope note only in What-if", () => {
    const { rerender } = render(<MilestoneTable lang="en-US" milestones={[ms(1, "M")]} chances={[chance(1, 0.5)]} whatIf={false} />);
    expect(screen.queryByText(/does not change milestone chances/)).toBeNull();
    rerender(<MilestoneTable lang="en-US" milestones={[ms(1, "M")]} chances={[chance(1, 0.5)]} whatIf />);
    expect(screen.getByText(/does not change milestone chances/)).toBeTruthy();
  });
});

describe("formatChance", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  test("whole percent, and a sub-certain 100 reads ≥ 99% (EN: no space, R10)", () => {
    expect(formatChance(0.424, "en-US")).toBe("42%");
    expect(formatChance(0.996, "en-US")).toBe("≥ 99%");
    expect(formatChance(1, "en-US")).toBe("100%");
    expect(formatChance(0, "en-US")).toBe("0%");
  });

  test("German puts a space before the percent sign (R10)", () => {
    expect(formatChance(0.424, "de")).toBe("42 %");
    expect(formatChance(0.996, "de")).toBe("≥ 99 %");
  });
});
