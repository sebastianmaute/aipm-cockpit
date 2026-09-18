import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoTooltip } from "./info-tooltip";
import { TOOLTIP_SURFACE_CLASS, TooltipSurface } from "./tooltip-surface";

describe("TooltipSurface", () => {
  it("portals a positioned tooltip carrying the shared class", () => {
    render(<TooltipSurface top={12} left={34}>hello</TooltipSurface>);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("hello");
    expect(tip).toHaveStyle({ top: "12px", left: "34px" });
    expect(tip.getAttribute("class")).toContain(TOOLTIP_SURFACE_CLASS);
    expect(tip).toHaveAttribute("data-tooltip-portal");
    expect(tip.style.transform).toBe("translateX(-50%)");
  });

  it("appends a caller class without dropping the shared one", () => {
    render(<TooltipSurface top={0} left={0} className="max-w-[22rem]">x</TooltipSurface>);
    const cls = screen.getByRole("tooltip").getAttribute("class") ?? "";
    expect(cls).toContain("max-w-[22rem]");
    expect(cls).toContain("border-line");
  });

  // The shared class carries NO `max-w` of its own (two same-specificity `max-w-*`
  // utilities on one element are resolved by generated stylesheet order, not by
  // attribute order, and jsdom cannot see which one would win). Each caller supplies
  // exactly one. This pins InfoTooltip's half of that contract — its own test file
  // is left untouched, so this is the only place that would notice a regression.
  it("InfoTooltip supplies its own max-w, not the shared one", () => {
    render(<InfoTooltip text="explains the field" label="info" />);
    fireEvent.focus(screen.getByRole("button", { name: "info" }));
    const cls = screen.getByRole("tooltip").getAttribute("class") ?? "";
    expect(cls).toContain("max-w-[16rem]");
  });

  // `decorative` takes the WHOLE node out of the accessibility tree, not just
  // its content: no `role`, so an ordinary role query — even a `hidden: true`
  // one, which only bypasses the ancestor check, not a missing role — finds
  // nothing, and the query must fall back to the `data-tooltip-portal` hook
  // every caller already relies on.
  it("renders a decorative surface with aria-hidden and no tooltip role", () => {
    render(<TooltipSurface top={0} left={0} decorative>hidden</TooltipSurface>);
    const tip = document.querySelector("[data-tooltip-portal]")!;
    expect(tip).toHaveAttribute("aria-hidden", "true");
    expect(tip).not.toHaveAttribute("role");
    expect(tip).toHaveTextContent("hidden");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
  });
});
