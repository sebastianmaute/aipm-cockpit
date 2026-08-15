import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { H_CLASS, W_CLASS } from "./dashboard-grid";
import { DashboardTile } from "./dashboard-tile";
import { DashboardTileMenu, TileAxisGroup } from "./dashboard-tile-menu";
import { DashboardShelf } from "./dashboard-shelf";
import type { DashboardTileId } from "./dashboard-tiles";

describe("span class tables", () => {
  it("resolves to the class strings the grid expects at runtime", () => {
    // ★★★ THIS CANNOT SEE AN INTERPOLATION, and it used to claim it could
    // ("emits literal class strings, never interpolated ones"). A runtime
    // assertion reads the PRODUCED string, and `col-span-1 lg:col-span-${2}`
    // produces a byte-identical one — the test stays green while Tailwind, which
    // scans SOURCE for candidates, emits no rule at all and every tile silently
    // renders one column wide. The real detectors are the SOURCE scan below (the
    // source form) and `e2e/dashboard-grid.spec.ts` (the resulting geometry).
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

/**
 * The SOURCE FORM of the two span tables — the one property no runtime
 * assertion can reach.
 *
 * ★★★ TAILWIND v4 SCANS SOURCE, NOT VALUES. An interpolated `col-span-${w}`
 * emits no CSS, so every tile falls back to one implicit column — and because
 * the resulting STRING is identical, every runtime assertion above stays green
 * and jsdom has no layout to notice. Reading the file back and scanning the
 * table bodies is the only unit-layer detector; `e2e/dashboard-grid.spec.ts`
 * catches the same defect one layer down, by measuring the geometry.
 *
 * Same pattern as the DOM-free guards in `rich-text-plain.test.ts` and
 * `document-model.test.ts`: strip comments first, then scan CODE — this file's
 * own docstring says `col-span-${w}` twice, and an unstripped scan would fail
 * against perfectly correct source.
 */
describe("span class tables (source form)", () => {
  const code = readFileSync(join(import.meta.dirname, "dashboard-grid.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("strips comments before scanning", () => {
    // ★ Not ceremony: `dashboard-grid.tsx`'s own header warns against
    // `col-span-${w}` in prose. Without the strip every assertion below would
    // fail on correct code — and a scan tuned to pass ANYWAY would be blind.
    expect(code).not.toContain("col-span-${w}");
    expect(code).toMatch(/export const W_CLASS/);
    expect(code).toMatch(/export const H_CLASS/);
  });

  /** The `{...}` body of one exported table, from the stripped source. */
  const tableBody = (name: string): string => {
    const m = code.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([^}]*)\\}`));
    expect(m, `${name} is not an object literal in the source`).not.toBeNull();
    return m![1];
  };

  for (const name of ["W_CLASS", "H_CLASS"]) {
    it(`holds ${name} as whole double-quoted literals, never a template`, () => {
      const body = tableBody(name);
      expect(body).not.toContain("${");
      expect(body).not.toContain("`");
      const values = [...body.matchAll(/^\s*\d\s*:\s*(.+?),\s*$/gm)].map((m) => m[1]);
      expect(values).toHaveLength(4);          // one per TileSpan; a miss means the regex drifted
      // Only class characters between the quotes — an interpolation cannot pass.
      for (const v of values) expect(v).toMatch(/^"[a-z0-9:\- ]+"$/);
    });
  }
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
      <TileAxisGroup lang="en-US" axis="h" tileTitle="RAID register" value={2} lo={2} hi={2} onPick={() => {}} />,
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

const HIDDEN: { id: DashboardTileId; title: string }[] = [
  { id: "raid", title: "RAID register" },
  { id: "burn", title: "Budget burn" },
];

function shelf(
  opts: {
    hidden?: { id: DashboardTileId; title: string }[];
    isDragging?: boolean;
    onRestore?: (id: DashboardTileId) => void;
  } = {},
) {
  return render(
    <DashboardShelf
      lang="en-US"
      hidden={opts.hidden ?? HIDDEN}
      onRestore={opts.onRestore ?? (() => {})}
      dropProps={{}}
      isDragging={opts.isDragging ?? false}
    />,
  );
}

const toggle = () => screen.getByRole("button", { name: /hidden/i });

describe("DashboardShelf", () => {
  it("summarises the hidden count on a collapsed disclosure", () => {
    shelf();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveTextContent("2");
  });

  it("opens the tray on click", () => {
    shelf();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the tray when a drag enters the collapsed button", () => {
    // ★ Without this the user must open the tray BEFORE picking a tile up — a
    // sequence that cannot be discovered mid-drag.
    shelf({ isDragging: true });
    fireEvent.dragEnter(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the tray shut when a pointer wanders in with nothing being dragged", () => {
    // ★★ Pins the `isDragging` guard. Without it this test is the only thing
    // between the shelf and a tray that pops open on a stray dragEnter, and the
    // happy-path test above passes either way — it is vacuous on its own.
    shelf({ isDragging: false });
    fireEvent.dragEnter(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("gives every Restore button a tile-unique accessible name", () => {
    // ★★ Two chips minimum, or the collision cannot render. axe cannot detect
    // duplicate accessible names in any view at any seed size.
    shelf();
    fireEvent.click(toggle());
    const names = screen.getAllByRole("button", { name: /restore/i }).map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("restores a tile from the tray through a keyboard-reachable button", () => {
    // ★★ The button IS the keyboard path. Dragging a chip back is the mouse
    // shortcut; without this a keyboard user who hid a tile could never get it
    // back.
    const onRestore = vi.fn();
    shelf({ onRestore });
    fireEvent.click(toggle());
    fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);
    expect(onRestore).toHaveBeenCalledWith("raid");
  });

  it("keeps the aria-controls target mounted while collapsed", () => {
    // ★★ `hidden`-toggled, never conditionally rendered: an aria-controls that
    // points at nothing is a dangling reference. Same shape as
    // `action-reasons.tsx`.
    shelf();
    const target = document.getElementById(toggle().getAttribute("aria-controls")!);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("hidden");
  });

  it("still offers the disclosure when nothing is hidden, so a drag has a target", () => {
    shelf({ hidden: [] });
    expect(toggle()).toHaveTextContent("0");
    fireEvent.click(toggle());
    expect(screen.getByText("Nothing hidden")).toBeInTheDocument();
  });
});
