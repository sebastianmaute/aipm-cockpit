import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Readout } from "./burndown-readout";
import { ChartReadout, readoutSentence } from "./chart-readout";

const fmt = (v: number) => `${v} EUR`;
const full: Readout = {
  date: "2026-02-01",
  today: true,
  rows: [
    { kind: "plan", value: 80 },
    { kind: "budget", value: 100 },
    { kind: "baseline", value: 90 },
    { kind: "actual", value: 70 },
    { kind: "ev", value: 65, partial: true },
    { kind: "evPoint", value: 64 },
    { kind: "pace", value: 60, forecast: true },
    { kind: "efficiency", value: 55, forecast: true },
    { kind: "change", value: -8, label: "Ops", removed: true },
    { kind: "runOut", value: 0 },
  ],
};

describe("ChartReadout", () => {
  it("lists every row in the legend's order with its value", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    // The box is aria-hidden (ruling 1 below), so these role queries need `hidden: true`
    // to see past that — otherwise Testing Library excludes them from the a11y tree.
    const rows = screen.getAllByRole("listitem", { hidden: true }).map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(10);
    // Every row asserts BOTH its label and its own formatted value — the fixture gives
    // each row a distinct number precisely so a value-mapping mutation on any one of
    // them (e.g. two rows swapping values) fails on a named row instead of hiding
    // behind a label-only check.
    expect(rows[0]).toContain("Planned");
    expect(rows[0]).toContain("80 EUR");
    expect(rows[1]).toContain("Budget");
    expect(rows[1]).toContain("100 EUR");
    expect(rows[2]).toContain("Budget at start of recording");
    expect(rows[2]).toContain("90 EUR");
    expect(rows[3]).toContain("Actual");
    expect(rows[3]).toContain("70 EUR");
    expect(rows[4]).toContain("Partial earned value");
    expect(rows[4]).toContain("65 EUR");
    // "Earned value (today)" (`burndownEv`), NOT "Earned value" (`burndownEvHistory`) — a bare
    // "Earned value" here is a substring of both and would pass against the wrong key.
    expect(rows[5]).toContain("Earned value (today)");
    expect(rows[5]).toContain("64 EUR");
    expect(rows[6]).toContain("At current pace");
    expect(rows[6]).toContain("60 EUR");
    expect(rows[7]).toContain("At current efficiency");
    expect(rows[7]).toContain("55 EUR");
    expect(rows[8]).toContain("Ops");
    expect(rows[8]).toContain("-8 EUR");
    expect(rows[9]).toContain("Runs out");
    expect(rows[9]).toContain("0 EUR");
  });

  // Every tip is asserted BY NAME. An earlier cut checked two of them, which left seven
  // strings written, read and never tested — the vacuous-coverage shape this repo keeps
  // being bitten by. One case per row kind, so a missing or mis-mapped tip fails here.
  it.each([
    ["What the plan expected to be spent by this date."],
    ["The budget at completion in force on this date."],
    ["The budget at completion before the first recorded change."],
    ["The value of all hours booked up to this date."],
    ["The budget value of the work finished by this date."],
    ["The budget value of all work finished so far."],
    ["Where spending lands if it continues at the recent daily average."],
    ["Where spending lands if the remaining work costs what finished work did."],
    ["A recorded change to the budget, summed over this period."],
    ["The day the budget is used up at the current pace."],
  ])("carries the explanation %s", (tip) => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    expect(screen.getByText(tip)).toBeInTheDocument();
  });

  it("marks the forecasts as forecasts and says when the date is today", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    // The marker's text node is literally "(forecast)" — the parens are the component's own
    // layout, not the i18n value, so the parens belong in the assertion.
    expect(screen.getAllByText("(forecast)")).toHaveLength(2);
    expect(screen.getByRole("tooltip")).toHaveTextContent("today");
  });

  it("signs a change amount and names a deletion", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    const change = screen.getAllByRole("listitem", { hidden: true })[8].textContent ?? "";
    expect(change).toContain("-8 EUR");
    expect(change).toContain("removed");
  });

  it("signs a positive change with a plus", () => {
    const plus: Readout = { date: "2026-02-01", today: false, rows: [{ kind: "change", value: 8, label: "Vendor", removed: false }] };
    render(<ChartReadout lang="en-US" readout={plus} anchor={{ top: 0, left: 0 }} fmt={fmt} locale="en-US" />);
    expect(screen.getAllByRole("listitem", { hidden: true })[0].textContent).toContain("+8 EUR");
  });

  it("positions the box at the anchor", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 33, left: 44 }} fmt={fmt} locale="en-US" />);
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "33px", left: "44px" });
  });

  // Pins the aria-hidden contract in BOTH directions: the box really is hidden from the
  // a11y tree (so Task 5's live region is the sole accessible channel — no double
  // announcement), AND an ordinary (non-`hidden: true`) role query really finds nothing,
  // so a later removal of `aria-hidden` cannot slip past unnoticed — every `{hidden: true}`
  // query above would stay green either way, which is exactly the silent-rot this closes.
  it("keeps the row list out of the accessibility tree", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});

describe("readoutSentence", () => {
  it("names the date and every row for the live region", () => {
    const text = readoutSentence("en-US", full, fmt, "en-US");
    // Literal, not derived from `formatDayMonthYear` — asserting via the same formatter the
    // function under test calls would pass no matter what that formatter does.
    // Intl.DateTimeFormat("en-US", ...) is month-day-year ("Feb 1, 2026"); "1 Feb 2026" is
    // the en-GB shape, asserted separately below.
    expect(text).toContain("Feb 1, 2026");
    expect(text).toContain("Planned: 80 EUR");
    expect(text).toContain("At current pace: 60 EUR");
    expect(text).toContain("Ops");
  });

  // The visual `(forecast)` marker is a WORD, not a shade, so the spoken sentence must
  // carry it too — both directions: it appears on both forecast rows (pace, efficiency),
  // and it appears on NEITHER of the other eight, so a version that stamps every row (or
  // drops it from both) passes neither half.
  it("announces the forecast flag for forecast rows only", () => {
    const text = readoutSentence("en-US", full, fmt, "en-US");
    expect(text).toContain("At current pace: 60 EUR, forecast");
    expect(text).toContain("At current efficiency: 55 EUR, forecast");
    expect(text).not.toContain("Planned: 80 EUR, forecast");
    // Exactly the two forecast rows carry the word — rules out it leaking onto any
    // of the other eight even if their own label/value text happened to differ.
    expect(text.split(", forecast").length - 1).toBe(2);
  });

  it("formats the date in day-month order for an en-GB locale", () => {
    const text = readoutSentence("en-US", full, fmt, "en-GB");
    expect(text).toContain("1 Feb 2026");
  });

  it("is empty for a readout with no rows", () => {
    expect(readoutSentence("en-US", { date: "2026-02-01", today: false, rows: [] }, fmt, "en-US")).toBe("");
  });
});
