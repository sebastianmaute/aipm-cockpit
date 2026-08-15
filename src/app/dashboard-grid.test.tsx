import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { H_CLASS, W_CLASS } from "./dashboard-grid";
import { DashboardTile } from "./dashboard-tile";

describe("span class tables", () => {
  it("emits literal class strings, never interpolated ones", () => {
    // ★ Tailwind v4 scans SOURCE for class candidates. `col-span-${w}` emits no
    // CSS at all, so these tables must hold whole literal strings.
    for (const v of Object.values(W_CLASS)) expect(v).toMatch(/^col-span-1( lg:col-span-\d)?( xl:col-span-\d)?$/);
    for (const v of Object.values(H_CLASS)) expect(v).toMatch(/^row-span-\d$/);
  });

  it("carries the whole responsive clamp on the width axis", () => {
    expect(W_CLASS[4]).toBe("col-span-1 lg:col-span-2 xl:col-span-4");
    expect(W_CLASS[1]).toBe("col-span-1");
  });

  it("does not clamp height", () => {
    expect(H_CLASS[3]).toBe("row-span-3");
  });
});

function twoTiles(readOnly = false) {
  return render(
    <>
      <DashboardTile id="raid" title="RAID register" w={2} h={2} lang="en-US" readOnly={readOnly}
        dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </DashboardTile>
      <DashboardTile id="upcoming" title="Upcoming" w={2} h={2} lang="en-US" readOnly={readOnly}
        dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </DashboardTile>
    </>,
  );
}

describe("DashboardTile", () => {
  it("applies the literal span classes for its size", () => {
    twoTiles();
    const tile = screen.getByTestId("tile-raid");
    expect(tile.className).toContain("lg:col-span-2");
    expect(tile.className).toContain("row-span-2");
  });

  it("gives every per-tile control a TILE-UNIQUE accessible name", () => {
    // ★★★ Two tiles minimum, or the collision cannot render and this test is
    // vacuous. axe CANNOT detect duplicate accessible names at any seed size —
    // this test is the only possible detector, in either layer.
    twoTiles();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThan(2);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains the tile title in each control's accessible name", () => {
    twoTiles();
    const raidNames = screen.getAllByRole("button")
      .map((b) => b.getAttribute("aria-label")!)
      .filter((n) => n.includes("RAID register"));
    expect(raidNames.length).toBe(2);   // grip + menu button
  });

  it("renders no grip or menu button when read-only", () => {
    twoTiles(true);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("hands the menu trigger itself to onOpenMenu as the popover anchor", () => {
    // ★ The menu lives ABOVE the tile, so the tile owes its caller the element
    // to anchor against. Passing anything else (or nothing) puts the popover in
    // the wrong place, which jsdom cannot see — only this identity check can.
    const seen: HTMLElement[] = [];
    render(
      <DashboardTile id="raid" title="RAID register" w={2} h={2} lang="en-US" readOnly={false}
        dragProps={{}} handleProps={{}} onOpenMenu={(el) => seen.push(el)}>
        <p>body</p>
      </DashboardTile>,
    );
    const trigger = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu");
    expect(trigger).toBeDefined();
    trigger!.click();
    expect(seen).toEqual([trigger]);
  });
});
