import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TOOLTIP_SURFACE_CLASS, TooltipSurface } from "./tooltip-surface";

describe("TooltipSurface", () => {
  it("portals a positioned tooltip carrying the shared class", () => {
    render(<TooltipSurface top={12} left={34}>hello</TooltipSurface>);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("hello");
    expect(tip).toHaveStyle({ top: "12px", left: "34px" });
    expect(tip.getAttribute("class")).toContain(TOOLTIP_SURFACE_CLASS);
    expect(tip).toHaveAttribute("data-tooltip-portal");
  });

  it("appends a caller class without dropping the shared one", () => {
    render(<TooltipSurface top={0} left={0} className="max-w-[22rem]">x</TooltipSurface>);
    const cls = screen.getByRole("tooltip").getAttribute("class") ?? "";
    expect(cls).toContain("max-w-[22rem]");
    expect(cls).toContain("border-line");
  });
});
