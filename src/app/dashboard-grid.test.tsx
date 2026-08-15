import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { H_CLASS, W_CLASS } from "./dashboard-grid";
import { DashboardTile } from "./dashboard-tile";
import { DashboardTileMenu, TileAxisGroup, type TileMenuLabels } from "./dashboard-tile-menu";

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

// ★ The nine strings below are PROPS, not `t(lang, …)` calls: every i18n key the
// plan named for this menu is absent from `i18n.ts` and a later task owns the
// additions. See the module docstring on `dashboard-tile-menu.tsx`.
const MENU_LABELS: TileMenuLabels = {
  width: "Width",
  height: "Height",
  fixedAt: (n) => `Fixed at ${n}`,
  moveEarlier: "Move earlier",
  moveLater: "Move later",
  moveFirst: "Move to first",
  hide: "Hide",
};

function menuFor(
  id: "raid" | "trends",
  extra: { index?: number; count?: number; onResize?: (a: "w" | "h", v: number) => void } = {},
) {
  return render(
    <DashboardTileMenu
      lang="en-US"
      tileId={id}
      title={id === "raid" ? "RAID register" : "Trends"}
      w={2}
      h={2}
      index={extra.index ?? 1}
      count={extra.count ?? 3}
      labels={MENU_LABELS}
      onResize={extra.onResize ?? (() => {})}
      onMove={() => {}}
      onHide={() => {}}
      onClose={() => {}}
    />,
  );
}

describe("DashboardTileMenu", () => {
  it("renders one radiogroup per adjustable axis", () => {
    menuFor("raid");
    expect(screen.getByRole("radiogroup", { name: /width/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /height/i })).toBeInTheDocument();
  });

  it("marks exactly the current value checked on each axis", () => {
    menuFor("raid");
    for (const axis of [/width/i, /height/i]) {
      const group = screen.getByRole("radiogroup", { name: axis });
      const checked = within(group)
        .getAllByRole("radio")
        .filter((b) => b.getAttribute("aria-checked") === "true");
      expect(checked).toHaveLength(1);
      expect(checked[0]).toHaveTextContent("2");
    }
  });

  it("offers only the values inside THAT tile's own limits, never a global 1–4", () => {
    // ★★ `trends` is minW 1 / maxW 2 and minH 2 / maxH 3 — so the two axes must
    // offer DIFFERENT value sets. A fixture whose tile allows 1–4 on both axes
    // passes against a hard-coded [1,2,3,4] and is vacuous.
    menuFor("trends");
    const texts = (name: RegExp) =>
      within(screen.getByRole("radiogroup", { name }))
        .getAllByRole("radio")
        .map((b) => b.textContent);
    expect(texts(/width/i)).toEqual(["1", "2"]);
    expect(texts(/height/i)).toEqual(["2", "3"]);
  });

  it("renders NO chooser for an axis whose min equals its max", () => {
    // ★★ No tile in the catalogue pins an axis today, so this branch is
    // unreachable through `DashboardTileMenu` — it is exercised on the axis
    // component directly. A row of buttons with every value but one disabled
    // reads as a broken control, which is why nothing is rendered instead.
    render(
      <TileAxisGroup label="Height" tileTitle="RAID register" fixedLabel="Fixed at 2" value={2} lo={2} hi={2} onPick={() => {}} />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Fixed at 2")).toBeInTheDocument();
  });

  it("calls onResize with the axis and the picked value", () => {
    const onResize = vi.fn();
    menuFor("raid", { onResize });
    within(screen.getByRole("radiogroup", { name: /height/i }))
      .getByRole("radio", { name: /height 4/i })
      .click();
    expect(onResize).toHaveBeenCalledWith("h", 4);
  });

  it("disables Move earlier at the start and Move later at the end", () => {
    const { unmount } = menuFor("raid", { index: 0, count: 3 });
    expect(screen.getByRole("button", { name: /move earlier/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move later/i })).toBeEnabled();
    unmount();
    menuFor("raid", { index: 2, count: 3 });
    expect(screen.getByRole("button", { name: /move earlier/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /move later/i })).toBeDisabled();
  });

  it("gives every control in ONE menu a distinct accessible name", () => {
    // ★★★ The renderable collision is INSIDE a single menu: Width and Height
    // both offer a radio whose visible label is "2". Only `optionAriaLabel`
    // separates them, and axe cannot see the collision in any view at any seed
    // size — this assertion is the only possible detector.
    menuFor("raid");
    const names = screen
      .getAllByRole("button")
      .concat(screen.getAllByRole("radio"))
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    expect(names.length).toBeGreaterThan(4);
    expect(new Set(names).size).toBe(names.length);
  });

  it("qualifies each axis radio with the tile title", () => {
    // ★★ Two menus, or the cross-tile collision cannot render.
    menuFor("raid");
    menuFor("trends");
    const names = screen.getAllByRole("radio").map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => n && (n.includes("RAID register") || n.includes("Trends")))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
