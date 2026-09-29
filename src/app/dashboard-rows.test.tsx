import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardStatusRow, DashboardTopRow } from "./dashboard-rows";
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

/** rem value of a Tailwind spacing class suffix (`2` → 0.5), at the 0.25rem unit. */
const rem = (step: string) => Number(step) * 0.25;

describe("DashboardTopRow (spec C row 1)", () => {
  it("sizes the delta strip like the hero column and lets the digest take the rest, controls on the far right", () => {
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<p>digest</p>} controls={<div data-testid="controls" />} />);
    const row = screen.getByTestId("dashboard-row-top");
    const delta = screen.getByTestId("dashboard-row-top-delta");
    const slot = screen.getByTestId("dashboard-row-top-digest");
    expect(delta).toHaveTextContent("delta");
    expect(slot).toHaveTextContent("digest");
    expect(delta.className).toContain(dc.topRowSplit);
    expect(delta.className).toContain("flex-1");
    // The digest grows into whatever the split leaves; no fixed fraction any more.
    expect(slot.className).toContain("flex-1");
    expect(slot.className).not.toMatch(/lg:w-/);
    expect(row.lastElementChild).toBe(screen.getByTestId("controls"));
  });

  it("uses the compact split under compact density", () => {
    const compact = densityClasses("compact");
    render(<DashboardTopRow dc={compact} delta={<p>delta</p>} digest={<p>digest</p>} controls={<div />} />);
    expect(screen.getByTestId("dashboard-row-top-delta").className).toContain(compact.topRowSplit);
  });

  it("stacks the delta strip and the digest below lg, and flattens into the row at lg", () => {
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<p>digest</p>} controls={<div />} />);
    const inner = screen.getByTestId("dashboard-row-top-digest").parentElement!;
    expect(inner.className).toContain("flex-col");
    // `contents` makes the split's 50% resolve against the whole row, as row 2's does.
    expect(inner.className).toContain("lg:contents");
  });

  it.each(["comfortable", "compact"] as const)(
    "starts the digest where Overall status starts (%s): split width + margin + row gap = 50% + half the section gap",
    (density) => {
      const d = densityClasses(density);
      const split = d.topRowSplit;
      // Every split class applies only while the digest beside it is showing.
      for (const cls of split.split(" ")) expect(cls.startsWith("lg:[&:has(+:not(:empty))]:")).toBe(true);
      expect(split).toContain("flex-none");
      const width = /w-\[calc\(50%_-_([\d.]+)rem\)\]/.exec(split);
      expect(width).not.toBeNull();
      const margin = /:mr-(\d+)(\s|$)/.exec(split);
      const rowGap = rem("2"); // DashboardTopRow's own `gap-2`
      const sectionGap = rem(/gap-(\d+)/.exec(d.sectionGap)![1]);
      // Row 2's hero is 50% − sectionGap/2 wide; the delta strip matches it …
      expect(Number(width![1])).toBe(sectionGap / 2);
      // … and the digest's left edge lands at 50% + sectionGap/2, like Overall status.
      const digestStart = -Number(width![1]) + (margin ? rem(margin[1]) : 0) + rowGap;
      expect(digestStart).toBe(sectionGap / 2);
    },
  );

  it("collapses the digest slot when the digest renders nothing, so the delta strip takes the width", () => {
    function NoDigest() { return null; }
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<NoDigest />} controls={<div />} />);
    const slot = screen.getByTestId("dashboard-row-top-digest");
    expect(slot.matches(":empty")).toBe(true);
    expect(slot.className).toContain("empty:hidden");
  });
});
