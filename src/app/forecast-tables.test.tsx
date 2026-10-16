import { beforeAll, describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CostTable, MilestoneTable, formatAmount, formatChance } from "./forecast-tables";
import { loadI18n, t } from "./i18n";
import type { MilestoneChance } from "./forecast/milestones";
import type { CostAtFinish } from "./forecast/cost";
import { formatCurrency } from "./resource-cost";
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

  test("a one-point gap reads in the singular, either sign (M7)", () => {
    render(
      <MilestoneTable
        lang="en-US"
        milestones={[ms(1, "Up"), ms(2, "Down"), ms(3, "Flat"), ms(4, "Wide")]}
        chances={[chance(1, 0.5, 0.51), chance(2, 0.51, 0.5), chance(3, 0.5, 0.5), chance(4, 0.5, 0.62)]}
        whatIf={false}
      />,
    );
    const gap = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) })).getAllByRole("cell").at(-1)?.textContent;
    expect(gap("Up")).toBe("+1 pt");
    expect(gap("Down")).toBe("-1 pt");
    expect(gap("Flat")).toBe("0 pts");
    expect(gap("Wide")).toBe("+12 pts");
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

describe("formatAmount", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  test("tasks carry the unit word with a real singular, effort its hours (EN and DE)", () => {
    expect(formatAmount(1, "tasks", "en-US")).toBe("1 task");
    expect(formatAmount(0, "tasks", "en-US")).toBe("0 tasks");
    expect(formatAmount(1200, "tasks", "en-US")).toBe("1,200 tasks");
    expect(formatAmount(1, "tasks", "de")).toBe("1 Aufgabe");
    expect(formatAmount(1200, "tasks", "de")).toBe("1.200 Aufgaben");
    expect(formatAmount(720, "effort", "en-US")).toBe("12 h");
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

// ---- §502 part 3: the Forecast view's cost-at-finish card ----
describe("CostTable", () => {
  const SIM: CostAtFinish = { kind: "sim", p50: 250000, p80: 262000, p95: 281000, chanceOverBudget: 0.8, spendDays: 60 };
  const money = (n: number) => formatCurrency(n, "EUR", "en-US");
  const card = () => screen.getByRole("group", { name: "Cost at finish, simulated" });

  test("shows P50/P80/P95 and the chance over budget, each figure marked simulated", () => {
    render(<CostTable lang="en-US" cost={SIM} currency="EUR" bac={240000} />);
    const box = within(card());
    expect(box.getByRole("heading", { name: "Cost at finish" })).toBeTruthy();
    expect(within(box.getByRole("row", { name: /^Even odds \(P50\)/ })).getByText(money(250000))).toBeTruthy();
    expect(within(box.getByRole("row", { name: /^Safe to commit \(P80\)/ })).getByText(money(262000))).toBeTruthy();
    expect(within(box.getByRole("row", { name: /^Worst likely \(P95\)/ })).getByText(money(281000))).toBeTruthy();
    expect(within(box.getByRole("row", { name: /^Chance over budget/ })).getByText("80%")).toBeTruthy();
    expect(card().getAttribute("data-sim")).toBe("true");
    expect(box.getAllByText("sim").length).toBeGreaterThan(0);
  });

  test("reads a beyond percentile as beyond the horizon", () => {
    render(<CostTable lang="en-US" cost={{ ...SIM, p95: "beyond" }} currency="EUR" bac={240000} />);
    const row = within(card()).getByRole("row", { name: /^Worst likely \(P95\)/ });
    expect(within(row).getByText(t("en-US", "simHistogramBeyond"))).toBeTruthy();
  });

  test("uses the baseline currency", () => {
    render(<CostTable lang="en-US" cost={SIM} currency="USD" bac={240000} />);
    expect(within(card()).getByText(formatCurrency(262000, "USD", "en-US"))).toBeTruthy();
  });

  test("no budget shows the add-a-budget line and no figures", () => {
    render(<CostTable lang="en-US" cost={null} currency="EUR" bac={0} />);
    expect(within(card()).getByText("Add a budget to see the cost at finish.")).toBeTruthy();
    expect(screen.queryByRole("row")).toBeNull();
  });

  test("a zero budget is no budget", () => {
    render(<CostTable lang="en-US" cost={{ ...SIM, chanceOverBudget: null }} currency="EUR" bac={0} />);
    expect(within(card()).getByText("Add a budget to see the cost at finish.")).toBeTruthy();
    expect(screen.queryByText(money(262000))).toBeNull();
  });

  test("below the spend floor names both counts", () => {
    render(<CostTable lang="en-US" cost={{ kind: "unavailable", reason: "spend-history", spendDays: 7, neededSpendDays: 10 }} currency="EUR" bac={240000} />);
    expect(within(card()).getByText("Needs 10 working days with bookings in the window (has 7).")).toBeTruthy();
  });

  test("below the schedule floor says so", () => {
    render(<CostTable lang="en-US" cost={{ kind: "unavailable", reason: "schedule-floor", spendDays: 0, neededSpendDays: 10 }} currency="EUR" bac={240000} />);
    expect(within(card()).getByText("Not enough finished tasks to simulate the finish yet.")).toBeTruthy();
  });

  test("reads in German", async () => {
    await loadI18n("de");
    render(<CostTable lang="de" cost={null} currency="EUR" bac={0} />);
    expect(screen.getByRole("group", { name: t("de", "simValueSr", t("de", "budgetSimCostAtFinish")) })).toBeTruthy();
    expect(screen.getByText(t("de", "budgetSimAddBudget"))).toBeTruthy();
    expect(t("de", "budgetSimAddBudget")).not.toBe("Add a budget to see the cost at finish.");
  });
});
