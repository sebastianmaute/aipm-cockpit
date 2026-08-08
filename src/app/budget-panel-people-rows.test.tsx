import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BucketPeopleRows } from "./budget-panel-people-rows";
import { DOT_COL_PX, TOTAL_COL_PX } from "./budget-panel-totals";
import type { PersonRow } from "./budget-bucket-people";

const PERIODS = [{ key: "2026-01", start: "2026-01-01", end: "2026-01-31" }];
const ROLE_WIDTH = 180;

const row = (over: Partial<PersonRow> = {}): PersonRow => ({
  resourceId: 1, name: "Adam", hasPlanLine: true,
  booked: { "2026-01": 6 }, planned: { "2026-01": 8 },
  bookedTotal: 6, plannedTotal: 8, ...over,
});

const renderRows = (rows: readonly PersonRow[], collapsed = false) =>
  render(
    <table>
      <BucketPeopleRows
        id="people-1-10" rows={rows} periods={PERIODS} collapsed={collapsed} roleWidth={ROLE_WIDTH}
      />
    </table>,
  );

// ★ The figure and its separator are separate spans, and Testing Library's text
//   matcher reads a node's DIRECT text children only — so no `getByText` can
//   ever see a whole "booked / planned" pair. Read the cells instead.
const cellTexts = (container: HTMLElement) =>
  [...container.querySelectorAll("#people-1-10 td")].map((td) => td.textContent);

describe("BucketPeopleRows", () => {
  it("renders booked / planned in the total column and per period", () => {
    const { container } = renderRows([row()]);
    expect(screen.getByText("Adam")).toBeInTheDocument();
    expect(cellTexts(container)).toEqual(["", "Adam", "6 / 8", "6 / 8"]);
    // The counterpart to the collapsed case below: `hidden` must TRACK the prop,
    // not simply be present.
    expect(container.querySelector("#people-1-10")).not.toHaveAttribute("hidden");
  });

  it("shows a dash for planned when the person has no plan line", () => {
    const { container } = renderRows([
      row({ hasPlanLine: false, planned: { "2026-01": null }, plannedTotal: null }),
    ]);
    expect(cellTexts(container)).toEqual(["", "Adam", "6 / —", "6 / —"]);
  });

  it("shows a dash — NOT a zero — when booked is unknown for a period", () => {
    const { container } = renderRows([row({ booked: { "2026-01": null }, bookedTotal: null })]);
    expect(screen.queryByText("0")).toBeNull();
    expect(cellTexts(container)).toEqual(["", "Adam", "— / 8", "— / 8"]);
  });

  it("stays in the DOM while collapsed so aria-controls resolves", () => {
    const { container } = renderRows([row()], true);
    const body = container.querySelector("#people-1-10");
    expect(body).not.toBeNull();
    expect(body?.tagName).toBe("TBODY");
    expect(body).toHaveAttribute("hidden");
    // The rows themselves must still be there — a hidden tbody with no children
    // would satisfy the id lookup while pointing at nothing.
    expect(body?.querySelectorAll("tr")).toHaveLength(1);
  });

  it("does not tint either figure", () => {
    renderRows([row()]);
    for (const el of screen.getAllByText("6")) {
      expect(el.className).not.toMatch(/(^|\s)text-(ui|rag)-/);
    }
  });

  // ★★ The three leading columns of this table are pinned BY ARITHMETIC: the
  //    role column sits at DOT_COL_PX and the Total column at DOT_COL_PX + the
  //    LIVE role width. These rows must mirror BucketRowLeadCells exactly or
  //    they slide out from under their own headers on horizontal scroll.
  //    jsdom has no layout — this pins the plumbing, not the geometry.
  it("pins its three leading cells at the same offsets as the role row", () => {
    const { container } = renderRows([row()]);
    const cells = [...container.querySelectorAll("#people-1-10 td")];
    expect(cells).toHaveLength(4); // dot, name, total, one period
    const [dot, name, total] = cells as HTMLElement[];
    expect(dot.style.left).toBe("0px");
    expect(name.style.left).toBe(`${DOT_COL_PX}px`);
    expect(name.style.maxWidth).toBe(`${ROLE_WIDTH}px`);
    expect(total.style.left).toBe(`${DOT_COL_PX + ROLE_WIDTH}px`);
    expect(total.style.minWidth).toBe(`${TOTAL_COL_PX}px`);
    for (const cell of [dot, name, total]) {
      // `sticky` rides the CLASS, never the inline style — an inline
      // `position: sticky` would leave the `print:static` beside it inert.
      expect(cell.style.position).toBe("");
      expect(cell.className).toMatch(/(^|\s)sticky(\s|$)/);
      expect(cell.className).toMatch(/(^|\s)bg-surface(\s|$)/);
      expect(cell.className).toMatch(/print:static/);
    }
  });
});
