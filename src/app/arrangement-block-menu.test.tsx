import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ArrangementBlockMenu, AxisGroup } from "./arrangement-block-menu";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { BlockSpan } from "./arrangement-layout";

type Bounds = { minW?: BlockSpan; maxW?: BlockSpan; minH?: BlockSpan; maxH?: BlockSpan };

function menu(
  opts: Bounds & {
    title?: string;
    index?: number;
    count?: number;
    onResize?: (a: "w" | "h", v: BlockSpan) => void;
    onMove?: (d: -1 | 1 | "first") => void;
    onHide?: () => void;
    onClose?: () => void;
  } = {},
) {
  return render(
    <ArrangementBlockMenu
      lang="en-US"
      title={opts.title ?? "Alpha board"}
      w={2}
      h={2}
      minW={opts.minW ?? 1}
      maxW={opts.maxW ?? 4}
      minH={opts.minH ?? 1}
      maxH={opts.maxH ?? 4}
      index={opts.index ?? 1}
      count={opts.count ?? 3}
      onResize={opts.onResize ?? (() => {})}
      onMove={opts.onMove ?? (() => {})}
      onHide={opts.onHide ?? (() => {})}
      onClose={opts.onClose ?? (() => {})}
    />,
  );
}

const texts = (name: RegExp) =>
  within(screen.getByRole("radiogroup", { name }))
    .getAllByRole("radio")
    .map((b) => b.textContent);

describe("ArrangementBlockMenu — the axes", () => {
  it("renders one radiogroup per adjustable axis", () => {
    menu();
    expect(screen.getByRole("radiogroup", { name: /width/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /height/i })).toBeInTheDocument();
  });

  it("marks exactly the current value checked on each axis", () => {
    menu();
    for (const axis of [/width/i, /height/i]) {
      const group = screen.getByRole("radiogroup", { name: axis });
      const checked = within(group)
        .getAllByRole("radio")
        .filter((b) => b.getAttribute("aria-checked") === "true");
      expect(checked).toHaveLength(1);
      expect(checked[0]).toHaveTextContent("2");
    }
  });

  it("offers exactly the values inside the BOUNDS IT WAS PASSED, per axis", () => {
    // ★★★ THIS IS THE PROPS-NOT-LOOKUP PATH, and it is the reason the extraction
    // removed `tileById`. The two axes must offer DIFFERENT sets, or a fixture
    // allowing 1–4 on both passes against a hard-coded [1,2,3,4] and is vacuous.
    // A bound that goes missing on the way in used to make the whole menu
    // `return null`; now it can only narrow or widen a row, which is visible.
    menu({ minW: 1, maxW: 2, minH: 2, maxH: 3 });
    expect(texts(/width/i)).toEqual(["1", "2"]);
    expect(texts(/height/i)).toEqual(["2", "3"]);
  });

  it("renders NO chooser for an axis whose min equals its max", () => {
    // ★★ Unreachable through the Dashboard catalogue, which pins no axis — so it
    // is exercised on the axis component directly. A row of buttons with every
    // value but one disabled reads as a broken control, which is why nothing is
    // rendered instead.
    render(<AxisGroup lang="en-US" axis="h" blockTitle="Alpha board" value={2} lo={2} hi={2} onPick={() => {}} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Fixed at 2")).toBeInTheDocument();
  });

  it("calls onResize with the axis and the picked value", () => {
    const onResize = vi.fn();
    menu({ onResize });
    within(screen.getByRole("radiogroup", { name: /height/i }))
      .getByRole("radio", { name: /height 4/i })
      .click();
    expect(onResize).toHaveBeenCalledWith("h", 4);
  });
});

describe("ArrangementBlockMenu — accessible names", () => {
  it("gives every control in ONE menu a distinct accessible name", () => {
    // ★★★ The renderable clash is INSIDE a single menu: Width and Height both
    // offer a radio whose VISIBLE label is "2". Only `optionAriaLabel` separates
    // them, and axe cannot see it in any view at any seed size.
    //
    // ★★ `requireCollisionSeed` is OFF, and NOT because this is a distinct-name
    // pin — it is a genuine clash test. The guard strips the ` (N)` occurrence
    // suffix that `buildRowTokens` emits, and this surface disambiguates by an
    // axis-name PREFIX instead, so no two names collapse to the same string and
    // the guard would throw against correct code. It certifies one
    // disambiguation shape, not the property.
    const { container } = menu();
    expectRowUniqueNames({
      // MEASURED: 4 width radios + 4 height radios + 3 move buttons + Hide = 12.
      minControls: 12,
      scope: container,
      roles: ["button", "radio"],
    });
  });

  it("puts BOTH the axis and the block title in each option's name", () => {
    // ★ The uniqueness assertion above would also pass if only the axis were
    // present; the title is what keeps TWO menus apart, which is the cross-block
    // half of 2.4.6.
    menu({ title: "Alpha board" });
    const names = screen.getAllByRole("radio").map((b) => b.getAttribute("aria-label"));
    expect(names).toContain("Width 2 – Alpha board");
    expect(names).toContain("Height 2 – Alpha board");
    expect(names.every((n) => n!.includes("Alpha board"))).toBe(true);
  });

  it("names each radiogroup with its axis and the block title", () => {
    menu({ title: "Alpha board" });
    expect(screen.getByRole("radiogroup", { name: "Width – Alpha board" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Height – Alpha board" })).toBeInTheDocument();
  });

  it("puts NO aria-label on the unroled container", () => {
    // ★★ The wrapper div has no role, so it maps to `generic`, on which ARIA
    // PROHIBITS a name — and the caller already names the `role="dialog"` that
    // wraps this content. axe cannot see the prohibited attribute: a div WITH
    // content lands in `incomplete`, and the gate reads `violations` only.
    // ★ `:not([role])` is load-bearing. A bare `div[aria-label]` also matches
    // each `SegmentedControl`'s `role="radiogroup"` wrapper, which SHOULD carry
    // a name — so the unscoped selector fails against correct code. The rule is
    // about UNROLED elements only.
    const { container } = menu();
    expect(container.querySelector("div[aria-label]:not([role])")).toBeNull();
    // Positive control: the roled ones are present and named, so the selector
    // above is not passing merely because nothing has an aria-label.
    expect(container.querySelectorAll("div[role='radiogroup'][aria-label]")).toHaveLength(2);
  });
});

describe("ArrangementBlockMenu — the move and hide commands", () => {
  it("disables Move earlier and Move first at the start", () => {
    menu({ index: 0, count: 3 });
    expect(screen.getByRole("button", { name: /move earlier/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move to start/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move later/i })).toBeEnabled();
  });

  it("disables Move later at the end", () => {
    menu({ index: 2, count: 3 });
    expect(screen.getByRole("button", { name: /move earlier/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /move later/i })).toBeDisabled();
  });

  it("closes the menu after a move, but NOT after a resize", () => {
    // ★★ A resize is a repeated adjustment — closing on each pick would make
    // "try 3, then 4" impossible. A move re-renders the board underneath, so the
    // popover's anchor is gone and it must close.
    const onMove = vi.fn();
    const onClose = vi.fn();
    const onResize = vi.fn();
    menu({ onMove, onClose, onResize });
    within(screen.getByRole("radiogroup", { name: /width/i }))
      .getByRole("radio", { name: /width 3/i })
      .click();
    expect(onResize).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /move later/i }).click();
    expect(onMove).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides and closes", () => {
    const onHide = vi.fn();
    const onClose = vi.fn();
    menu({ onHide, onClose });
    screen.getByRole("button", { name: /hide/i }).click();
    expect(onHide).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
