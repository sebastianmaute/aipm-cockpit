import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardStatusRow } from "./dashboard-rows";
import { densityClasses } from "./dashboard-density";

const dc = densityClasses("comfortable");

describe("DashboardStatusRow (spec C row 2)", () => {
  it("puts the hero first and Overall status beside it, stacking below lg", () => {
    render(<DashboardStatusRow dc={dc} hero={<p>hero</p>} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("lg:flex-row");
    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toHaveTextContent("hero");
    expect(row.children[1]).toHaveTextContent("status");
  });

  it("gives Overall status the whole row when there is no hero", () => {
    render(<DashboardStatusRow dc={dc} hero={null} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.children).toHaveLength(1);
    expect(screen.queryByTestId("dashboard-row-status-hero")).toBeNull();
    expect(screen.getByTestId("dashboard-row-status-overall").className).toContain("lg:flex-1");
  });

  it("makes the two cards equal height by stretch, never a pixel height", () => {
    render(<DashboardStatusRow dc={dc} hero={<p>hero</p>} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.className).toContain("lg:items-stretch");
    for (const el of [row, ...Array.from(row.children)]) {
      expect(el.className, el.getAttribute("data-testid") ?? "").not.toMatch(/(^|\s)(h|min-h|max-h)-\[/);
    }
    // Each column is a grid cell, so its one child stretches to the row height.
    for (const col of Array.from(row.children)) expect(col.className).toMatch(/(^|\s)grid(\s|$)/);
  });

  it("spaces the row with the density class, not a literal gap", () => {
    render(<DashboardStatusRow dc={densityClasses("compact")} hero={<p>hero</p>} status={<p>status</p>} />);
    expect(screen.getByTestId("dashboard-row-status").className).toContain(densityClasses("compact").sectionGap);
  });
});
